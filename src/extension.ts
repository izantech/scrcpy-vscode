import * as vscode from 'vscode';
import { ScrcpyViewProvider } from './ScrcpyViewProvider';

let provider: ScrcpyViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Scrcpy extension activated');

  provider = new ScrcpyViewProvider(context.extensionUri);

  // Register the webview view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ScrcpyViewProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );

  // Register start command
  const startCommand = vscode.commands.registerCommand('scrcpy.start', () => {
    provider?.start();
  });

  // Register stop command
  const stopCommand = vscode.commands.registerCommand('scrcpy.stop', () => {
    provider?.stop();
  });

  // Register WiFi connection command
  const wifiCommand = vscode.commands.registerCommand('scrcpy.connectWifi', () => {
    provider?.connectWifi();
  });

  // Register APK installation command
  const installApkCommand = vscode.commands.registerCommand('scrcpy.installApk', () => {
    provider?.installApk();
  });

  // Register settings command
  const settingsCommand = vscode.commands.registerCommand('scrcpy.openSettings', () => {
    vscode.commands.executeCommand('workbench.action.openSettings', '@ext:izan.scrcpy-vscode');
  });

  context.subscriptions.push(startCommand, stopCommand, wifiCommand, installApkCommand, settingsCommand);
}

export async function deactivate() {
  await provider?.stop();
  console.log('Scrcpy extension deactivated');
}
