import type { AxiosResponse } from 'axios'
import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import type Stream from 'node:stream'
import { exec, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { env } from 'node:process'
import axios from 'axios'
import * as vscode from 'vscode'

let gimOutputChannel: vscode.OutputChannel

let childProcesses: ChildProcess[] = []
const availableModels = ['gemma:7b', 'gemma:13b', 'qwen2.5-coder:3b', 'qwen2.5-coder:7b', 'gpt-oss:latest']
let currentModel = availableModels[0]

class GimCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
    const docstringAction = new vscode.CodeAction('GIM: Generate Docstring', vscode.CodeActionKind.RefactorRewrite)
    docstringAction.command = {
      command: 'gim.selection.docstring',
      title: 'GIM: Generate Docstring',
      tooltip: 'Generates a C# XML docstring for the selected code.',
      arguments: [range],
    }

    const analyzeAction = new vscode.CodeAction('GIM: Analyze Code', vscode.CodeActionKind.RefactorRewrite)
    analyzeAction.command = {
      command: 'gim.selection.analyze',
      title: 'GIM: Analyze Code',
      tooltip: 'Analyzes the selected code for potential issues.',
      arguments: [range],
    }

    const explainAction = new vscode.CodeAction('GIM: Explain Code', vscode.CodeActionKind.RefactorRewrite)
    explainAction.command = {
      command: 'gim.selection.explain',
      title: 'GIM: Explain Code',
      tooltip: 'Explains the selected code.',
      arguments: [range],
    }

    if (range.isEmpty) {
      console.log('CODE_ACTION: No selection, providing file-level actions')
      return [docstringAction, analyzeAction, explainAction]
    }

    const docstringSelectedAction = new vscode.CodeAction('GIM: Generate Docstring', vscode.CodeActionKind.RefactorRewrite)
    docstringSelectedAction.command = {
      command: 'gim.selection.docstring',
      title: 'GIM: Generate Docstring',
      tooltip: 'Generates a C# XML docstring for the selected code.',
      arguments: [range],
    }

    const analyzeSelectedAction = new vscode.CodeAction('GIM: Analyze Selection', vscode.CodeActionKind.Refactor)
    analyzeSelectedAction.command = {
      command: 'gim.selection.analyze',
      title: 'GIM: Analyze Selection',
      tooltip: 'Analyzes the selected code for potential issues.',
      arguments: [range],

    }

    const explainSelectedAction = new vscode.CodeAction('GIM: Explain Selection', vscode.CodeActionKind.Refactor)
    explainSelectedAction.command = {
      command: 'gim.selection.explain',
      title: 'GIM: Explain Selection',
      tooltip: 'Explains the selected code.',
      arguments: [range],

    }

    return [docstringSelectedAction, analyzeSelectedAction, explainSelectedAction]
  }
}

interface PendingDocstring {
  decorationType: vscode.TextEditorDecorationType
  range: vscode.Range
  editor: vscode.TextEditor
}

const pendingDocstrings = new Map<string, PendingDocstring>()

class DocstringCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>()
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event

  refresh(): void {
    this._onDidChangeCodeLenses.fire()
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = []

    for (const [key, pending] of pendingDocstrings.entries()) {
      if (pending.editor.document.uri.toString() === document.uri.toString()) {
        const range = new vscode.Range(pending.range.start, pending.range.start)

        const acceptLens = new vscode.CodeLens(range, {
          title: '✓ Accept Docstring',
          command: 'gim.acceptDocstring',
          arguments: [key],
        })

        const discardLens = new vscode.CodeLens(range, {
          title: '✗ Discard Docstring',
          command: 'gim.discardDocstring',
          arguments: [key],
        })

        codeLenses.push(acceptLens, discardLens)
      }
    }

    return codeLenses
  }
}

export function activate(context: vscode.ExtensionContext) {
  gimOutputChannel = vscode.window.createOutputChannel('GIM')

  gimOutputChannel.appendLine('Starting AI Server...')
  gimOutputChannel.show(true)
  const extensionPath = context.extensionPath

  exec('uv sync')

  setupAiServer(extensionPath)
  setupSqliteServer(extensionPath)
  setupRoslyn(extensionPath)

  const codeLensProvider = new DocstringCodeLensProvider()

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', language: 'csharp' },
      codeLensProvider,
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gim.acceptDocstring',
      (key: string) => {
        const pending = pendingDocstrings.get(key)
        if (pending) {
          pending.editor.setDecorations(pending.decorationType, [])
          pendingDocstrings.delete(key)
          codeLensProvider.refresh()
          gimOutputChannel.appendLine(`Accepted docstring: ${key}`)
        }
      },
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gim.selectModel',
      async () => {
        const selected = await vscode.window.showQuickPick(availableModels, {
          placeHolder: `Current model: ${currentModel}`,
          title: 'Select AI Model',
        })

        if (selected) {
          currentModel = selected
          vscode.window.showInformationMessage(`Model changed to: ${currentModel}`)
          gimOutputChannel.appendLine(`[MODEL] Switched to ${currentModel}`)
        }
      },
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gim.discardDocstring',
      async (key: string) => {
        const pending = pendingDocstrings.get(key)
        if (pending) {
          await pending.editor.edit((editBuilder) => {
            editBuilder.delete(pending.range)
          })
          pending.editor.setDecorations(pending.decorationType, [])
          pendingDocstrings.delete(key)
          codeLensProvider.refresh()
          gimOutputChannel.appendLine(`Discarded docstring: ${key}`)
        }
      },
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gim.update-indexes',
      updateIndexes,
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gim.selection.docstring',
      docstringFromSelection,
    ),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gim.selection.analyze',
      analyzeSelection,
    ),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gim.file.analyze',
      analyzeFile,
    ),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gim.selection.explain',
      explainFromSelection,
    ),
  )

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'csharp', pattern: '**/*.{cs,csx}' },
      new GimCodeActionProvider(),
    ),
  )
}
interface MethodResult {
  symbol: vscode.DocumentSymbol
  signature: string
}

interface DbMethodResult {
  method_id: number
  method_name: string
  method_signature: string
  method_start_line: number
  method_end_line: number
  method_body: string
  class_name: string
  document_path: string
}

function getSelectedMethods(params: {
  symbols: vscode.DocumentSymbol[]
  selection: vscode.Range
  document: vscode.TextDocument
}): MethodResult[] {
  const { symbols, selection, document } = params
  const selectedMethods: MethodResult[] = []

  for (const symbol of symbols) {
    const overlaps = selection.intersection(symbol.range)

    if (overlaps) {
      if (symbol.kind === vscode.SymbolKind.Method) {
        const signature = document.getText(symbol.range)
        selectedMethods.push({
          symbol,
          signature: signature.trim(),
        })
      }

      if (symbol.children.length > 0) {
        const childMethods = getSelectedMethods({ symbols: symbol.children, selection, document })
        selectedMethods.push(...childMethods)
      }
    }
  }
  return selectedMethods
}

async function getSelectedMethodsFromDb(params: {
  filePath: string
  startLine: number
  endLine: number
}): Promise<DbMethodResult[]> {
  const { filePath, startLine, endLine } = params

  try {
    const response = await axios.get<{ data: DbMethodResult[] }>(
      'http://127.0.0.1:8000/fetch-all',
    )

    const allMethods = response.data.data
    gimOutputChannel.appendLine(`[DEBUG] Total methods in database: ${allMethods.length}`)
    gimOutputChannel.appendLine(`[DEBUG] Looking for methods in file: ${filePath}`)
    gimOutputChannel.appendLine(`[DEBUG] Selection range: lines ${startLine}-${endLine}`)

    const normalizePathForComparison = (p: string): string => p.replace(/\\/g, '/')

    const normalizedFilePath = normalizePathForComparison(filePath)

    const selectedMethods = allMethods.filter((method) => {
      const normalizedDbPath = normalizePathForComparison(method.document_path)
      const documentMatch = normalizedDbPath === normalizedFilePath
        || normalizedDbPath.endsWith(normalizedFilePath.split('/').pop() || '')

      const methodStart = method.method_start_line
      const methodEnd = method.method_end_line
      const overlaps = !(methodEnd < startLine || methodStart > endLine)

      if (normalizePathForComparison(method.document_path).includes(normalizedFilePath.split('/').pop() || '')) {
        gimOutputChannel.appendLine(
          `[DEBUG] Found method in matching file: ${method.method_signature} (lines ${methodStart}-${methodEnd}, db_path: ${method.document_path})`,
        )
      }

      return documentMatch && overlaps
    })

    gimOutputChannel.appendLine(`[DEBUG] Selected ${selectedMethods.length} methods matching selection range`)

    const uniqueFiles = Array.from(new Set(allMethods.map(m => m.document_path)))
    gimOutputChannel.appendLine(`[DEBUG] Files in database: ${uniqueFiles.slice(0, 10).join(', ')}${uniqueFiles.length > 10 ? '...' : ''}`)

    return selectedMethods
  }
  catch (error) {
    if (axios.isAxiosError(error)) {
      gimOutputChannel.appendLine(`Error fetching methods from database: ${error.message}`)
    }
    else {
      gimOutputChannel.appendLine(`Unexpected error fetching methods: ${String(error)}`)
    }
    return []
  }
}

async function docstringFromSelection() {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showInformationMessage('No active editor found.')
    return
  }

  const document = editor.document
  const selection = editor.selection

  if (selection.isEmpty) {
    vscode.window.showErrorMessage('GIM: Nothing is selected')
    return
  }

  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    document.uri,
  )

  if (!symbols) {
    vscode.window.showErrorMessage('GIM: Nothing here')
    return
  }

  const methods = getSelectedMethods({ symbols, selection, document })

  const dbMethods = await getSelectedMethodsFromDb({
    filePath: editor.document.fileName,
    startLine: selection.start.line,
    endLine: selection.end.line,
  })

  gimOutputChannel.appendLine(`Found ${methods.length} methods from VSCode symbols`)
  gimOutputChannel.appendLine(`Found ${dbMethods.length} methods from database`)

  if (dbMethods.length > 0) {
    gimOutputChannel.appendLine(`Selected methods from DB: ${dbMethods.map(m => m.method_signature).join(', ')}`)
  }

  if (dbMethods.length === 0 && methods.length === 0) {
    vscode.window.showErrorMessage('GIM: Could not find any methods')
    return
  }

  for (let i = dbMethods.length - 1; i >= 0; i--) {
    const dbMethod = dbMethods[i]
    gimOutputChannel.appendLine(`\n--- Processing method ${dbMethods.length - i}/${dbMethods.length}: ${dbMethod.method_signature} ---`)

    await generateDocstringForMethod(editor, dbMethod)
  }
}

async function generateDocstringForMethod(editor: vscode.TextEditor, dbMethod: DbMethodResult): Promise<void> {
  const requestBody = {
    file_name: editor.document.fileName,
    signature: dbMethod.method_signature,
    model_name: currentModel,
  }

  gimOutputChannel.appendLine(`Requesting docstring for: ${JSON.stringify(requestBody)}`)

  try {
    const response: AxiosResponse<Stream> = await axios.post(
      'http://127.0.0.1:9999/docstring',
      requestBody,
      {
        responseType: 'stream',
        timeout: 30000,
      },
    )

    const stream = response.data

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Generating docstring for ${dbMethod.method_signature}...`,
      cancellable: true,
    }, async (progress, token) => {
      let fullResponse = ''
      const onData = (chunk: Buffer) => {
        const data = chunk.toString('utf-8').replaceAll('data: ', '').trim()
        gimOutputChannel.appendLine(`Received chunk: ${data}`)
        try {
          if (data) {
            fullResponse += JSON.parse(data).token
          }
          progress.report({ message: 'Generating...' })
        }
        catch (e) {
          gimOutputChannel.appendLine(`Failed to parse SSE JSON data: ${data}`)
          gimOutputChannel.appendLine(`Parse error: ${String(e)}`)
        }
      }
      stream.on('data', onData)

      token.onCancellationRequested(() => {
        stream.off('data', onData)
        gimOutputChannel.appendLine('User canceled the streaming operation.')
      })

      return new Promise<void>((resolve, reject) => {
        stream.on('end', async () => {
          gimOutputChannel.appendLine('Stream ended.')
          stream.off('data', onData)

          if (fullResponse.trim()) {
            const document = editor.document

            let lineIndex = dbMethod.method_start_line - 1
            gimOutputChannel.appendLine(`[DEBUG] Database reported method starts at line ${dbMethod.method_start_line} (0-indexed: ${lineIndex})`)

            if (lineIndex < 0 || lineIndex >= document.lineCount) {
              gimOutputChannel.appendLine(`[ERROR] Line index ${lineIndex} is out of bounds (document has ${document.lineCount} lines)`)
              vscode.window.showErrorMessage(`Could not insert docstring: line ${lineIndex} not found`)
              resolve()
              return
            }

            gimOutputChannel.appendLine(`[DEBUG] Line ${lineIndex - 1}: ${document.lineAt(Math.max(0, lineIndex - 1)).text}`)
            gimOutputChannel.appendLine(`[DEBUG] Line ${lineIndex}: ${document.lineAt(lineIndex).text}`)
            gimOutputChannel.appendLine(`[DEBUG] Line ${lineIndex + 1}: ${document.lineAt(Math.min(document.lineCount - 1, lineIndex + 1)).text}`)

            let methodSignatureLine = lineIndex
            const methodLineContent = document.lineAt(lineIndex).text.trim()

            if (!methodLineContent.match(/\b(public|private|protected|internal|static|async|void|int|string|bool|var)\b/)) {
              gimOutputChannel.appendLine(`[DEBUG] Line ${lineIndex} doesn't look like a method signature, scanning upward...`)
              for (let i = lineIndex; i < Math.min(lineIndex + 10, document.lineCount); i++) {
                const line = document.lineAt(i).text.trim()
                if (line.match(/\b(public|private|protected|internal|static|async|void|int|string|bool|var)\b/) && line.includes('(')) {
                  methodSignatureLine = i
                  gimOutputChannel.appendLine(`[DEBUG] Found method signature at line ${i}: ${line.substring(0, 60)}...`)
                  break
                }
              }
            }

            const methodStartLine = document.lineAt(methodSignatureLine)
            const insertPosition = methodStartLine.range.start

            const formattedDocstring = fullResponse
              .split('\n')
              .filter(line => line.trim().length > 0)
              .map(line => `/// ${line}`)
              .join('\n')

            const docstringWithNewline = `${formattedDocstring}\n`

            gimOutputChannel.appendLine(`[DEBUG] Final insertion at line ${methodSignatureLine}, position ${insertPosition.character}`)

            await editor.edit((editBuilder) => {
              editBuilder.insert(insertPosition, docstringWithNewline)
            })

            const updatedDocument = editor.document
            const docstringLines = formattedDocstring.split('\n').length

            const decorationType = vscode.window.createTextEditorDecorationType({
              backgroundColor: 'rgba(100, 200, 100, 0.2)',
              borderColor: 'rgba(100, 200, 100, 0.5)',
              borderWidth: '1px',
              borderStyle: 'solid',
              isWholeLine: true,
            })

            const docstringRange = new vscode.Range(
              new vscode.Position(lineIndex, 0),
              new vscode.Position(lineIndex + docstringLines, 0),
            )

            editor.setDecorations(decorationType, [docstringRange])

            // Store the pending docstring with a unique key
            const key = `${dbMethod.method_signature}-${Date.now()}`
            pendingDocstrings.set(key, {
              decorationType,
              range: docstringRange,
              editor,
            })

            // Trigger CodeLens refresh to show Accept/Discard buttons
            vscode.commands.executeCommand('vscode.executeCodeLensProvider', updatedDocument.uri)

            gimOutputChannel.appendLine(`Docstring inserted with inline actions for ${dbMethod.method_signature}`)
          }
          else {
            gimOutputChannel.appendLine('Warning: Stream ended but no response content received')
            vscode.window.showWarningMessage(`No docstring generated for ${dbMethod.method_signature}`)
          }
          resolve()
        })

        stream.on('error', (err) => {
          gimOutputChannel.appendLine(`Stream error: ${String(err)}`)
          gimOutputChannel.appendLine(`Partial response collected: ${fullResponse.length} characters`)
          vscode.window.showErrorMessage('Error streaming response from AI server.')
          reject(err)
        })

        stream.on('close', () => {
          gimOutputChannel.appendLine('Stream closed')
        })
      })
    })
  }
  catch (error) {
    if (axios.isAxiosError(error)) {
      gimOutputChannel.appendLine(`Axios error: ${error.message}`)
      vscode.window.showErrorMessage(`Failed to connect to AI server: ${error.message}`)
    }
    else {
      gimOutputChannel.appendLine(`Unexpected error: ${String(error)}`)
      vscode.window.showErrorMessage('An unexpected error occurred.')
    }
  }
}

function analyzeSelection() {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showInformationMessage('No active editor found.')
    return
  }

  const document = editor.document
  const selection = editor.selection

  if (selection.isEmpty) {
    vscode.window.showErrorMessage('GIM: Nothing is selected')
    return
  }

  vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    document.uri,
  ).then(async (symbols) => {
    if (!symbols) {
      vscode.window.showErrorMessage('GIM: Nothing here')
      return
    }

    const dbMethods = await getSelectedMethodsFromDb({
      filePath: editor.document.fileName,
      startLine: selection.start.line,
      endLine: selection.end.line,
    })

    gimOutputChannel.appendLine(`Found ${dbMethods.length} methods for analysis`)

    if (dbMethods.length === 0) {
      vscode.window.showErrorMessage('GIM: Could not find any methods')
      return
    }

    for (let i = dbMethods.length - 1; i >= 0; i--) {
      const dbMethod = dbMethods[i]
      gimOutputChannel.appendLine(`\n--- Analyzing method ${dbMethods.length - i}/${dbMethods.length}: ${dbMethod.method_signature} ---`)

      await generateAnalysisForMethod(editor, dbMethod)
    }
  })
}

async function generateAnalysisForMethod(editor: vscode.TextEditor, dbMethod: DbMethodResult): Promise<void> {
  const requestBody = {
    file_name: editor.document.fileName,
    signature: dbMethod.method_signature,
    model_name: currentModel,
  }

  gimOutputChannel.appendLine(`Requesting analysis for: ${JSON.stringify(requestBody)}`)

  try {
    const response: AxiosResponse<Stream> = await axios.post(
      'http://127.0.0.1:9999/related-code',
      requestBody,
      {
        responseType: 'stream',
        timeout: 30000,
      },
    )

    const stream = response.data

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Analyzing ${dbMethod.method_signature}...`,
      cancellable: true,
    }, async (progress, token) => {
      let fullResponse = ''
      const onData = (chunk: Buffer) => {
        const data = chunk.toString('utf-8').replaceAll('data: ', '').trim()
        gimOutputChannel.appendLine(`Received chunk: ${data}`)
        try {
          if (data) {
            fullResponse += JSON.parse(data).token
          }
          progress.report({ message: 'Analyzing...' })
        }
        catch (e) {
          gimOutputChannel.appendLine(`Failed to parse SSE JSON data: ${data}`)
          gimOutputChannel.appendLine(`Parse error: ${String(e)}`)
        }
      }
      stream.on('data', onData)

      token.onCancellationRequested(() => {
        stream.off('data', onData)
        gimOutputChannel.appendLine('User canceled the analysis operation.')
      })

      return new Promise<void>((resolve, reject) => {
        stream.on('end', async () => {
          gimOutputChannel.appendLine('Stream ended.')
          stream.off('data', onData)

          if (fullResponse.trim()) {
            // Show analysis in a separate document
            const analysisDocument = await vscode.workspace.openTextDocument({
              content: `# Analysis for ${dbMethod.method_signature}\n\nFile: ${editor.document.fileName}\nLine: ${dbMethod.method_start_line}\n\n---\n\n${fullResponse}`,
              language: 'markdown',
            })

            await vscode.window.showTextDocument(analysisDocument, {
              viewColumn: vscode.ViewColumn.Beside,
              preserveFocus: false,
            })

            gimOutputChannel.appendLine(`Displayed analysis for ${dbMethod.method_signature}`)
          }
          else {
            gimOutputChannel.appendLine('Warning: Stream ended but no response content received')
            vscode.window.showWarningMessage(`No analysis generated for ${dbMethod.method_signature}`)
          }
          resolve()
        })

        stream.on('error', (err) => {
          gimOutputChannel.appendLine(`Stream error: ${String(err)}`)
          gimOutputChannel.appendLine(`Partial response collected: ${fullResponse.length} characters`)
          vscode.window.showErrorMessage('Error streaming response from AI server.')
          reject(err)
        })

        stream.on('close', () => {
          gimOutputChannel.appendLine('Stream closed')
        })
      })
    })
  }
  catch (error) {
    if (axios.isAxiosError(error)) {
      gimOutputChannel.appendLine(`Axios error: ${error.message}`)
      vscode.window.showErrorMessage(`Failed to connect to AI server: ${error.message}`)
    }
    else {
      gimOutputChannel.appendLine(`Unexpected error: ${String(error)}`)
      vscode.window.showErrorMessage('An unexpected error occurred.')
    }
  }
}

function explainFromSelection() {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showInformationMessage('No active editor found.')
    return
  }

  const document = editor.document
  const selection = editor.selection

  if (selection.isEmpty) {
    vscode.window.showErrorMessage('GIM: Nothing is selected')
    return
  }

  vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    document.uri,
  ).then(async (symbols) => {
    if (!symbols) {
      vscode.window.showErrorMessage('GIM: Nothing here')
      return
    }

    const dbMethods = await getSelectedMethodsFromDb({
      filePath: editor.document.fileName,
      startLine: selection.start.line,
      endLine: selection.end.line,
    })

    gimOutputChannel.appendLine(`Found ${dbMethods.length} methods for explanation`)

    if (dbMethods.length === 0) {
      vscode.window.showErrorMessage('GIM: Could not find any methods')
      return
    }

    for (let i = dbMethods.length - 1; i >= 0; i--) {
      const dbMethod = dbMethods[i]
      gimOutputChannel.appendLine(`\n--- Explaining method ${dbMethods.length - i}/${dbMethods.length}: ${dbMethod.method_signature} ---`)

      await generateExplanationForMethod(editor, dbMethod)
    }
  })
}

async function generateExplanationForMethod(editor: vscode.TextEditor, dbMethod: DbMethodResult): Promise<void> {
  const requestBody = {
    file_name: editor.document.fileName,
    signature: dbMethod.method_signature,
    model_name: currentModel,
  }

  gimOutputChannel.appendLine(`Requesting explanation for: ${JSON.stringify(requestBody)}`)

  try {
    const response: AxiosResponse<Stream> = await axios.post(
      'http://127.0.0.1:9999/explain',
      requestBody,
      {
        responseType: 'stream',
        timeout: 30000,
      },
    )

    const stream = response.data

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Explaining ${dbMethod.method_signature}...`,
      cancellable: true,
    }, async (progress, token) => {
      let fullResponse = ''
      const onData = (chunk: Buffer) => {
        const data = chunk.toString('utf-8').replaceAll('data: ', '').trim()
        gimOutputChannel.appendLine(`Received chunk: ${data}`)
        try {
          if (data) {
            fullResponse += JSON.parse(data).token
          }
          progress.report({ message: 'Explaining...' })
        }
        catch (e) {
          gimOutputChannel.appendLine(`Failed to parse SSE JSON data: ${data}`)
          gimOutputChannel.appendLine(`Parse error: ${String(e)}`)
        }
      }
      stream.on('data', onData)

      token.onCancellationRequested(() => {
        stream.off('data', onData)
        gimOutputChannel.appendLine('User canceled the explanation operation.')
      })

      return new Promise<void>((resolve, reject) => {
        stream.on('end', async () => {
          gimOutputChannel.appendLine('Stream ended.')
          stream.off('data', onData)

          if (fullResponse.trim()) {
            // Show explanation in a separate document
            const explanationDocument = await vscode.workspace.openTextDocument({
              content: `# Explanation for ${dbMethod.method_signature}\n\nFile: ${editor.document.fileName}\nLine: ${dbMethod.method_start_line}\n\n---\n\n${fullResponse}`,
              language: 'markdown',
            })

            await vscode.window.showTextDocument(explanationDocument, {
              viewColumn: vscode.ViewColumn.Beside,
              preserveFocus: false,
            })

            gimOutputChannel.appendLine(`Displayed explanation for ${dbMethod.method_signature}`)
          }
          else {
            gimOutputChannel.appendLine('Warning: Stream ended but no response content received')
            vscode.window.showWarningMessage(`No explanation generated for ${dbMethod.method_signature}`)
          }
          resolve()
        })

        stream.on('error', (err) => {
          gimOutputChannel.appendLine(`Stream error: ${String(err)}`)
          gimOutputChannel.appendLine(`Partial response collected: ${fullResponse.length} characters`)
          vscode.window.showErrorMessage('Error streaming response from AI server.')
          reject(err)
        })

        stream.on('close', () => {
          gimOutputChannel.appendLine('Stream closed')
        })
      })
    })
  }
  catch (error) {
    if (axios.isAxiosError(error)) {
      gimOutputChannel.appendLine(`Axios error: ${error.message}`)
      vscode.window.showErrorMessage(`Failed to connect to AI server: ${error.message}`)
    }
    else {
      gimOutputChannel.appendLine(`Unexpected error: ${String(error)}`)
      vscode.window.showErrorMessage('An unexpected error occurred.')
    }
  }
}

async function analyzeFile() {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showErrorMessage('GIM: No file open')
    return
  }

  const document = editor.document

  gimOutputChannel.appendLine(`\n--- Analyzing file: ${document.fileName} ---`)

  const dbMethods = await getSelectedMethodsFromDb({
    filePath: document.fileName,
    startLine: 0,
    endLine: document.lineCount - 1,
  })

  gimOutputChannel.appendLine(`Found ${dbMethods.length} methods in file`)

  if (dbMethods.length === 0) {
    vscode.window.showInformationMessage('GIM: No methods found in file')
    return
  }

  const confirmation = await vscode.window.showInformationMessage(
    `Analyze ${dbMethods.length} method(s) in this file?`,
    'Yes',
    'No',
  )

  if (confirmation !== 'Yes') {
    return
  }

  for (let i = dbMethods.length - 1; i >= 0; i--) {
    const dbMethod = dbMethods[i]
    gimOutputChannel.appendLine(`\n--- Analyzing method ${dbMethods.length - i}/${dbMethods.length}: ${dbMethod.method_signature} ---`)

    await generateAnalysisForMethod(editor, dbMethod)
  }

  vscode.window.showInformationMessage(`Completed analysis of ${dbMethods.length} method(s)`)
}

export function deactivate() {
  for (const child of childProcesses) {
    try {
      child.kill('SIGTERM')
    }
    catch (e) {
      console.error('Failed to kill process', e)
    }
  }
  childProcesses = []
}

async function updateIndexes() {
  console.log('GIM: Updating indexes...')
  if (vscode.workspace.workspaceFolders === undefined) {
    vscode.window.showErrorMessage('GIM: No workspace folder open')
    return
  }
  const projectPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath
  if (projectPath === undefined) {
    vscode.window.showErrorMessage('GIM: No workspace folder open')
    return
  }

  gimOutputChannel.appendLine('GIM: Updating indexes...')
  gimOutputChannel.appendLine(`GIM: Project path is ${projectPath}`)
  const solutionFile = findSolutionFile(projectPath)
  gimOutputChannel.appendLine(`GIM: Solution file is ${solutionFile}`)
  console.log(`GIM: Project path is ${projectPath}, solution file is ${solutionFile}`)
  axios.post('http://127.0.0.1:8080/update-codebase-indexes', {
    projectPath: solutionFile,
  }, {
    headers: { 'Content-Type': 'application/json' },
  }).then((response) => {
    console.log('GIM: Indexes updated successfully', response.data)
    vscode.window.showInformationMessage('GIM: Indexes updated successfully')
  }).catch((error) => {
    gimOutputChannel.appendLine('[ERROR] Error updating indexes', error)
    vscode.window.showErrorMessage(`[ERROR] Error updating indexes: ${error.message}`)
  })
}

function findSolutionFile(projectPath: string): string | null {
  const files = fs.readdirSync(projectPath)
  for (const file of files) {
    if (file.endsWith('.sln') || file.endsWith('.csproj')) {
      return path.join(projectPath, file)
    }
  }
  return null
}

function setupAiServer(extensionPath: string) {
  const ai = spawn('uv', ['run', 'main.py'], {
    cwd: `${extensionPath}/ai-server`,
  })

  childProcesses.push(ai)

  ai.stdout.on('data', (data) => {
    gimOutputChannel.append(data.toString())
  })

  ai.stderr?.on('data', (data) => {
    gimOutputChannel.append(`[stderr] ${data.toString()}`)
  })

  ai.on('error', (err) => {
    gimOutputChannel.appendLine(`[error] Failed to start: ${err.message}`)
    vscode.window.showErrorMessage(`Failed to start uvicorn: ${err.message}`)
  })

  ai.on('close', (code) => {
    gimOutputChannel.appendLine(`[exit] Uvicorn exited with code ${code}`)
  })
}

function setupSqliteServer(extensionPath: string) {
  const sqliteServer = spawn('uv', ['run', 'main.py'], {
    cwd: `${extensionPath}/sqlite-server`,
  })

  childProcesses.push(sqliteServer)

  sqliteServer.stdout.on('data', (data) => {
    gimOutputChannel.append(data.toString())
  })

  sqliteServer.stderr?.on('data', (data) => {
    gimOutputChannel.append(`[stderr] ${data.toString()}`)
  })

  sqliteServer.on('error', (err) => {
    gimOutputChannel.appendLine(`[error] Failed to start SQLite server: ${err.message}`)
    vscode.window.showErrorMessage(`Failed to start SQLite server: ${err.message}`)
  })

  sqliteServer.on('close', (code) => {
    gimOutputChannel.appendLine(`[exit] SQLite server exited with code ${code}`)
  })
}

function setupRoslyn(extensionPath: string) {
  env.DOTNET_ROOT = '/usr/local/share/dotnet/'
  env.PATH = `${env.PATH}:/usr/local/share/dotnet/`
  const roslyn = spawn('dotnet', ['run', 'server'], {
    cwd: `${extensionPath}/roslyn-analyzer`,
  })
  childProcesses.push(roslyn)

  roslyn.on('spawn', () => {
    setTimeout(() => {
      updateIndexes()
    }, 5000)
  })

  roslyn.stdout.on('data', (data) => {
    gimOutputChannel.append(data.toString())
  })

  roslyn.stderr?.on('data', (data) => {
    gimOutputChannel.append(`[stderr] ${data.toString()}`)
  })

  roslyn.on('error', (err) => {
    gimOutputChannel.appendLine(`[error] Failed to start Roslyn service: ${err.message}`)
    vscode.window.showErrorMessage(`Failed to start Roslyn service: ${err.message}`)
  })

  roslyn.on('close', (code) => {
    gimOutputChannel.appendLine(`[exit] Roslyn service exited with code ${code}`)
  })
}
