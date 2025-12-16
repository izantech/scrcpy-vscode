import * as vscode from 'vscode';
import { ScrcpyViewProvider } from './ScrcpyViewProvider';
import { checkAllTools, clearCache } from './ToolChecker';

let provider: ScrcpyViewProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Scrcpy extension activated');

  // Check tools at activation
  const config = vscode.workspace.getConfiguration('scrcpy');
  const adbPath = config.get<string>('adbPath', '');
  const scrcpyPath = config.get<string>('path', '');

  const toolResult = await checkAllTools(adbPath, scrcpyPath);

  // Create provider with tool status
  provider = new ScrcpyViewProvider(context.extensionUri, toolResult);

  // Register the webview view provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ScrcpyViewProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  // Re-check tools when path settings change
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('scrcpy.path') || e.affectsConfiguration('scrcpy.adbPath')) {
        clearCache();
        const cfg = vscode.workspace.getConfiguration('scrcpy');
        const newResult = await checkAllTools(
          cfg.get<string>('adbPath', ''),
          cfg.get<string>('path', '')
        );
        provider?.updateToolStatus(newResult);
      }
    })
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

  // Register file upload command
  const uploadFilesCommand = vscode.commands.registerCommand('scrcpy.uploadFiles', () => {
    provider?.uploadFiles();
  });

  // Register app launcher command
  const launchAppCommand = vscode.commands.registerCommand('scrcpy.launchApp', () => {
    provider?.launchApp();
  });

  // Register settings command
  const settingsCommand = vscode.commands.registerCommand('scrcpy.openSettings', () => {
    vscode.commands.executeCommand('workbench.action.openSettings', '@ext:izantech.scrcpy-vscode');
  });

  // Register toggle recording command
  const toggleRecordingCommand = vscode.commands.registerCommand('scrcpy.toggleRecording', () => {
    provider?.toggleRecording();
  });

  // Register list cameras command
  const listCamerasCommand = vscode.commands.registerCommand('scrcpy.listCameras', () => {
    provider?.listCameras();
  });

  // Register select display command
  const selectDisplayCommand = vscode.commands.registerCommand('scrcpy.selectDisplay', () => {
    provider?.selectDisplay();
  });

  // Register tab switching commands (for keyboard shortcuts)
  const tabCommands = [];
  for (let i = 1; i <= 9; i++) {
    const cmd = vscode.commands.registerCommand(`scrcpy.switchToTab${i}`, () => {
      provider?.switchToTab(i - 1); // Convert to 0-indexed
    });
    tabCommands.push(cmd);
  }

  context.subscriptions.push(
    startCommand,
    stopCommand,
    wifiCommand,
    installApkCommand,
    uploadFilesCommand,
    launchAppCommand,
    settingsCommand,
    toggleRecordingCommand,
    listCamerasCommand,
    selectDisplayCommand,
    ...tabCommands
  );
}

export async function deactivate() {
  await provider?.stop();
  console.log('Scrcpy extension deactivated');
}
