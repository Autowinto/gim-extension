import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "gim" is now active!');

	const disposable = vscode.commands.registerCommand('gim.run', () => {
		vscode.window.showInformationMessage('Hello World from gim!');
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
