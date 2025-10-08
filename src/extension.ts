import { exec, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { env } from 'node:process'
import axios from 'axios'
import * as vscode from 'vscode'

let gimOutputChannel: vscode.OutputChannel

const DOTNET_PATH = '/usr/local/share/dotnet/dotnet'

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
}

function docstringFromSelection() {
  vscode.window.showInformationMessage('GIM: TODO IMPLEMENT DOCSTRING SELECTION!')
}

function analyzeSelection() {
  vscode.window.showInformationMessage('GIM: TODO IMPLEMENT SELECTION ANALYSIS!')
}

function explainFromSelection() {
  vscode.window.showInformationMessage('GIM: TODO IMPLEMENT EXPLAIN SELECTION!')
}

function analyzeFile() {
  const editor = vscode.window.activeTextEditor
  if (editor) {
    vscode.window.showInformationMessage(`GIM: Current file is !${editor.document}`)
    return
  }

  vscode.window.showErrorMessage('GIM: No file open')
}

export function deactivate() {
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
    console.error('GIM: Error updating indexes', error)
    vscode.window.showErrorMessage(`GIM: Error updating indexes: ${error.message}`)
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
  const roslyn = spawn(DOTNET_PATH, ['run', 'server'], {
    cwd: `${extensionPath}/roslyn-analyzer/Analyzer`,
  })

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
