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
}

function docstringFromSelection() {
  vscode.window.showInformationMessage('GIM: TODO IMPLEMENT DOCSTRING SELECTION!')
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
  if (editor) {
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
}
