import * as path from 'node:path'
import { TextEncoder } from 'node:util'
import * as vscode from 'vscode'

// used for diff viewing
const suggestedContentMap: Map<string, string> = new Map()
const myScheme = 'gim-diff'

export function activate(context: vscode.ExtensionContext) {
  // used to get the content for the diff view
  const myProvider = new (class implements vscode.TextDocumentContentProvider {
    public provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
      const content = suggestedContentMap.get(uri.path)
      if (content) {
        return content
      }
      return '' // Or handle the case where content is not found
    }
  })()

  const acceptChangesDisposable = vscode.commands.registerCommand('gim.acceptChanges', async (uri: vscode.Uri) => {
    return await acceptChanges(uri)
  })

  context.subscriptions.push(acceptChangesDisposable)

  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(myScheme, myProvider))

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

async function docstringFromSelection() {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showInformationMessage('No active editor found.')
    return
  }

  const document = editor.document
  let signature = ''

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

  signature = methods[0].signature
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
          fullResponse += JSON.parse(data).token // Adjust based on actual data structure

          progress.report({ message: 'Generating...' })
        }
        catch (e) {
          console.error('Failed to parse SSE JSON data:', data, e)
        }
      }
      stream.on('data', onData)

      token.onCancellationRequested(() => {
        // This will close the connection and stop the stream
        stream.off('data', onData)
        console.log('User canceled the streaming operation.')
      })

      return new Promise<void>((resolve, reject) => {
        stream.on('end', () => {
          console.log('Stream ended.')
          // Here you can insert the fullResponse into the editor
          editor.edit((editBuilder) => {
            // Format the complete response as a C# XML doc comment block.
            const formattedDocstring = fullResponse
              .split('\n')
              .map(line => `// ${line}`)
              .join('\n')

            // Example: insert at current cursor position
            editBuilder.insert(editor.selection.active, `${formattedDocstring}\n`)
          })
          resolve()
        })

        stream.on('error', (err) => {
          console.error('Stream error:', err)
          vscode.window.showErrorMessage('Error streaming response from AI server.')
          reject(err)
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

// possibly can be moved out to other functions, so we can re-use some of this logic
async function analyzeSelection() {
  const selectionInfo = getSelectedText()

  if (!selectionInfo) {
    vscode.window.showInformationMessage('Please select some code to analyze.')
    return
  }

  const { text, range, fullFile } = selectionInfo

  const editor = vscode.window.activeTextEditor
  if (!editor) {
    return
  }
  const document = editor.document

  const startOffset = document.offsetAt(range.start)
  const endOffset = document.offsetAt(range.end)

  // should be replaced with actual HTTP call
  const suggestedNewCode = text.split('').reverse().join('').trimEnd()

  const suggestedFullFile = fullFile.slice(0, startOffset) + suggestedNewCode + fullFile.slice(endOffset)

  const suggestedUriKey = document.uri.path
  suggestedContentMap.set(suggestedUriKey, suggestedFullFile)

  const originalUri = document.uri
  const suggestedUri = vscode.Uri.parse(`${myScheme}://suggested${suggestedUriKey}`)
  const title = `Suggestion: ${path.basename(originalUri.fsPath)}`

  vscode.commands.executeCommand('vscode.diff', originalUri, suggestedUri, title)
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

function getSelectedText(): { text: string, range: vscode.Range, fullFile: string } | null {
  const editor = vscode.window.activeTextEditor

  if (!editor) {
    return null
  }
  const selection = editor.selection
  return {
    text: editor.document.getText(selection),
    range: selection,
    fullFile: editor.document.getText(),
  }
}
async function acceptChanges(uri: vscode.Uri) {
  const originalFilePath = uri.path.replace('/suggested', '')
  const originalUri = vscode.Uri.file(originalFilePath)

  // Get the suggested content from your map.
  const suggestedText = suggestedContentMap.get(uri.path)
  if (!suggestedText) {
    vscode.window.showErrorMessage('Could not find the suggested content.')
    return
  }

  try {
    const encodedContent = new TextEncoder().encode(suggestedText)

    await vscode.workspace.fs.writeFile(originalUri, encodedContent)

    vscode.window.showInformationMessage('Changes applied!')

    const diffEditorGroups = vscode.window.tabGroups.all.filter(group =>
      group.tabs.some(tab =>
        tab.input instanceof vscode.TabInputTextDiff
        && tab.input.modified.scheme === myScheme,
      ),
    )

    if (diffEditorGroups.length > 0) {
      const diffTab = diffEditorGroups[0].tabs.find(tab =>
        tab.input instanceof vscode.TabInputTextDiff
        && tab.input.modified.scheme === myScheme,
      )
      if (diffTab) {
        await vscode.window.tabGroups.close(diffTab)
      }
    }

    // Optional: clear the temporary content.
    suggestedContentMap.delete(uri.path)
  }
  catch (error) {
    vscode.window.showErrorMessage(`Failed to apply changes: ${error}`)
  }
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
  // Find a file with .sln or .csproj
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
  // exec(`${DOTNET_PATH} build`, { cwd: `${extensionPath}/roslyn-analyzer/Analyzer` }, (error, stdout, stderr) => {
  //   if (error) {
  //     gimOutputChannel.appendLine(`Error building Roslyn analyzer: ${error.message}`)
  //     vscode.window.showErrorMessage(`Error building Roslyn analyzer: ${error.message}`)
  //     return
  //   }
  //   if (stderr) {
  //     gimOutputChannel.appendLine(`Roslyn build stderr: ${stderr}`)
  //   }
  //   gimOutputChannel.appendLine(`Roslyn build stdout: ${stdout}`)
  // })

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
