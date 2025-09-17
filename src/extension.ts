import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "gim" is now active!')

  context.subscriptions.push(
    vscode.commands.registerCommand('gim.selection.docstring', () => {
      vscode.window.showInformationMessage('GIM: TODO IMPLEMENT DOCSTRING SELECTION!')
    }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('gim.selection.analyze', () => {
      vscode.window.showInformationMessage('GIM: TODO IMPLEMENT ANALYZE SELECTION!')
    }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('gim.file.analyze', () => {
      vscode.window.showInformationMessage('GIM: TODO IMPLEMENT ANALYZE FILE!')
    }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('gim.selection.explain', () => {
      vscode.window.showInformationMessage('GIM: TODO IMPLEMENT EXPLAIN SELECTION!')
    }),
  )
}

export function deactivate() {}
