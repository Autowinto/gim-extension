import * as fs from 'node:fs'
import * as path from 'node:path'
import axios from 'axios'
import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  // Initial update indexes on activation
  updateIndexes()
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

  // Find a file with .sln or .csproj
  const solutionFile = findSolutionFile(projectPath)
  console.log(`GIM: Project path is ${projectPath}, solution file is ${solutionFile}`)
  axios.post('http://localhost:8080/update-codebase-indexes', {
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
