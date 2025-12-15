import type { AxiosResponse } from 'axios'
import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import type Stream from 'node:stream'
import { exec, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { env } from 'node:process'
import axios, { request } from 'axios'
import * as vscode from 'vscode'

let gimOutputChannel: vscode.OutputChannel

const DOTNET_PATH = '/usr/local/share/dotnet/dotnet'

let childProcesses: ChildProcess[] = []
const modelName = 'gemma:7b'
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
      // Pass the selection as an argument to the command
      arguments: [range],
    }

    const analyzeAction = new vscode.CodeAction('GIM: Analyze Code', vscode.CodeActionKind.RefactorRewrite)
    analyzeAction.command = {
      command: 'gim.selection.analyze',
      title: 'GIM: Analyze Code',
      tooltip: 'Analyzes the selected code for potential issues.',
      // Pass the selection as an argument to the command
      arguments: [range],
    }

    const explainAction = new vscode.CodeAction('GIM: Explain Code', vscode.CodeActionKind.RefactorRewrite)
    explainAction.command = {
      command: 'gim.selection.explain',
      title: 'GIM: Explain Code',
      tooltip: 'Explains the selected code.',
      // Pass the selection as an argument to the command
      arguments: [range],
    }

    // Only show selection-based actions if there is a selection
    if (range.isEmpty) {
      console.log('CODE_ACTION: No selection, providing file-level actions')
      return [docstringAction, analyzeAction, explainAction]
    }

    const docstringSelectedAction = new vscode.CodeAction('GIM: Generate Docstring', vscode.CodeActionKind.RefactorRewrite)
    docstringSelectedAction.command = {
      command: 'gim.selection.docstring',
      title: 'GIM: Generate Docstring',
      tooltip: 'Generates a C# XML docstring for the selected code.',
      // Pass the selection as an argument to the command
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

const model = 'qwen2.5-coder:3b'

export function activate(context: vscode.ExtensionContext) {
  // Initial update indexes on activation
  gimOutputChannel = vscode.window.createOutputChannel('GIM')

  gimOutputChannel.appendLine('Starting AI Server...')
  gimOutputChannel.show(true)
  const extensionPath = context.extensionPath

  exec('uv sync')

  setupAiServer(extensionPath)
  setupSqliteServer(extensionPath)
  setupRoslyn(extensionPath)

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

  // Register our custom Code Action provider for C# files.
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

  // Also fetch methods from the database to get additional context
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

  let signature = ''
  if (dbMethods.length > 0) {
    signature = dbMethods[0].method_signature
  }
  else if (methods.length > 0) {
    const fullText = methods[0].signature
    const signatureLine = fullText.split('{')[0].trim()
    signature = signatureLine
  }

  if (!signature) {
    vscode.window.showErrorMessage('GIM: Could not determine method signature')
    return
  }

  const requestBody: {
    file_name: string
    model_name: string
    signature: string
  } = {
    file_name: editor.document.fileName,
    signature,
    model_name: model,
  }

  gimOutputChannel.appendLine(JSON.stringify(requestBody))

  try {
    const response: AxiosResponse<Stream> = await axios.post(
      'http://127.0.0.1:9999/docstring',
      requestBody,
      {
        responseType: 'stream',
        timeout: 10000,
      },
    )

    const stream = response.data

    // Use withProgress to show a cancellable progress notification
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Generating docstring...',
      cancellable: true,
    }, async (progress, token) => {
      let fullResponse = ''
      const onData = (chunk: Buffer) => {
        const data = chunk.toString('utf-8').replaceAll('data: ', '').trim()
        // SSE format is "data: ...\n\n"
        gimOutputChannel.appendLine(`Received chunk: ${data}`)
        try {
          // The data is a JSON string like {"token": "..."}∏
          // We need to parse it to get the actual content.
          if (data) {
            fullResponse += JSON.parse(data).token // Adjust based on actual data structure
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
        stream.on('end', () => {
          gimOutputChannel.appendLine('Stream ended.')
          if (fullResponse.trim()) {
            editor.edit((editBuilder) => {
              const formattedDocstring = fullResponse
                .split('\n')
                .map(line => `// ${line}`)
                .join('\n')

              editBuilder.insert(editor.selection.active, `${formattedDocstring}\n`)
            })
          }
          else {
            gimOutputChannel.appendLine('Warning: Stream ended but no response content received')
          }
          resolve()
        })

        stream.on('error', (err) => {
          gimOutputChannel.appendLine(`Stream error: ${String(err)}`)
          gimOutputChannel.appendLine(`Partial response collected: ${fullResponse.length} characters`)
          vscode.window.showErrorMessage('Error streaming response from AI server.')
          reject(err)
        })

        // Add a close handler in case the stream closes unexpectedly
        stream.on('close', () => {
          gimOutputChannel.appendLine('Stream closed')
        })
      })
    })
  }
  catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Axios error:', error.message)
      vscode.window.showErrorMessage(`Failed to connect to AI server: ${error.message}`)
    }
    else {
      console.error('Unexpected error:', error)
      vscode.window.showErrorMessage('An unexpected error occurred.')
    }
  }
}

function analyzeSelection() {
  vscode.window.showInformationMessage('GIM: TODO IMPLEMENT SELECTION ANALYSIS!')
}

function explainFromSelection() {
  vscode.window.showInformationMessage('GIM: TODO IMPLEMENT EXPLAIN SELECTION!')
}

function analyzeFile() {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showInformationMessage(`GIM: Current file is !${editor.document}`)
    return
  }
  vscode.window.showErrorMessage('GIM: No file open')
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
