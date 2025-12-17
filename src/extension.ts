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

  // Register iOS input setup command (macOS only)
  const setupiOSInputCommand = vscode.commands.registerCommand('scrcpy.setupiOSInput', async () => {
    if (process.platform !== 'darwin') {
      vscode.window.showWarningMessage(
        vscode.l10n.t('iOS input control is only available on macOS')
      );
      return;
    }
    const scriptPath = vscode.Uri.joinPath(context.extensionUri, 'scripts', 'setup-wda.sh').fsPath;
    const terminal = vscode.window.createTerminal({
      name: 'iOS Input Setup',
      cwd: context.extensionUri.fsPath,
    });
    terminal.show();
    terminal.sendText(`bash "${scriptPath}" setup`);
  });

  // Register iOS input start command (macOS only)
  const startiOSInputCommand = vscode.commands.registerCommand('scrcpy.startiOSInput', async () => {
    if (process.platform !== 'darwin') {
      vscode.window.showWarningMessage(
        vscode.l10n.t('iOS input control is only available on macOS')
      );
      return;
    }
    const scriptPath = vscode.Uri.joinPath(context.extensionUri, 'scripts', 'setup-wda.sh').fsPath;
    const terminal = vscode.window.createTerminal({
      name: 'iOS Input Control',
      cwd: context.extensionUri.fsPath,
    });
    terminal.show();
    terminal.sendText(`bash "${scriptPath}" start`);
  });

  // Register tab switching commands (for keyboard shortcuts)
  const tabCommands = [];
  for (let i = 1; i <= 9; i++) {
    const cmd = vscode.commands.registerCommand(`scrcpy.switchToTab${i}`, () => {
      provider?.switchToTab(i - 1); // Convert to 0-indexed
    });
    tabCommands.push(cmd);
  }

  // Register browse path commands for settings
  const browseCommands = [
    {
      command: 'scrcpy.browseScrcpyPath',
      setting: 'path',
      title: 'Select scrcpy installation folder',
    },
    { command: 'scrcpy.browseAdbPath', setting: 'adbPath', title: 'Select ADB executable folder' },
    {
      command: 'scrcpy.browseScreenshotPath',
      setting: 'screenshotSavePath',
      title: 'Select screenshot save folder',
    },
    {
      command: 'scrcpy.browseRecordingPath',
      setting: 'recordingSavePath',
      title: 'Select recording save folder',
    },
    {
      command: 'scrcpy.browseApkInstallPath',
      setting: 'apkInstallDefaultPath',
      title: 'Select default APK folder',
    },
  ];

  const browseDisposables = browseCommands.map(({ command, setting, title }) =>
    vscode.commands.registerCommand(command, async () => {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: vscode.l10n.t(title),
      });
      if (result && result[0]) {
        await vscode.workspace.getConfiguration('scrcpy').update(setting, result[0].fsPath, true);
        vscode.window.setStatusBarMessage(
          vscode.l10n.t('Setting updated: {0}', result[0].fsPath),
          3000
        );
      }
    })
  );

  // Register reset path commands for settings
  const resetCommands = [
    { command: 'scrcpy.resetScrcpyPath', setting: 'path' },
    { command: 'scrcpy.resetAdbPath', setting: 'adbPath' },
    { command: 'scrcpy.resetScreenshotPath', setting: 'screenshotSavePath' },
    { command: 'scrcpy.resetRecordingPath', setting: 'recordingSavePath' },
    { command: 'scrcpy.resetApkInstallPath', setting: 'apkInstallDefaultPath' },
  ];

  const resetDisposables = resetCommands.map(({ command, setting }) =>
    vscode.commands.registerCommand(command, async () => {
      await vscode.workspace.getConfiguration('scrcpy').update(setting, undefined, true);
      vscode.window.setStatusBarMessage(vscode.l10n.t('Setting reset to default'), 3000);
    })
  );

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
    setupiOSInputCommand,
    startiOSInputCommand,
    ...tabCommands,
    ...browseDisposables,
    ...resetDisposables
  );
}

export async function deactivate() {
  await provider?.stop();
  console.log('Scrcpy extension deactivated');
}
