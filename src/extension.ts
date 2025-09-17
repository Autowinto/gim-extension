import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  console.log('Activating GIM')

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
