import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { getHtmlForWebview } from './webview/WebviewTemplate';
import { ScrcpyConfig } from './ScrcpyConnection';
import { DeviceManager } from './DeviceManager';

export class ScrcpyViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'scrcpy.deviceView';

  private _view?: vscode.WebviewView;
  private _deviceManager?: DeviceManager;
  private _disposables: vscode.Disposable[] = [];
  private _isDisposed = false;
  private _abortController?: AbortController;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    // Clean up any previous state (resolveWebviewView can be called multiple times when view is moved)
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }

    // Abort any pending async operations from the previous view
    this._abortController?.abort();
    this._abortController = new AbortController();

    // Disconnect any existing device manager (may still exist if view was moved, not disposed)
    if (this._deviceManager) {
      this._deviceManager.stopDeviceMonitoring();
      this._deviceManager.disconnectAll().catch(() => {});
      this._deviceManager = undefined;
    }

    // Reset disposed state
    this._isDisposed = false;

    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        await this._onDidReceiveMessage(message);
      },
      null,
      this._disposables
    );

    // Handle view disposal - only clean up if this is still the current view
    // (prevents race condition when view is moved between sidebars)
    webviewView.onDidDispose(
      () => {
        if (this._view === webviewView) {
          this._onViewDisposed().catch(console.error);
        }
      },
      null,
      this._disposables
    );

    // Auto-connect when view becomes visible
    webviewView.onDidChangeVisibility(
      () => {
        if (webviewView.visible && !this._deviceManager) {
          this._initializeAndConnect();
        }
      },
      null,
      this._disposables
    );

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration(
      async (e) => {
        if (e.affectsConfiguration('scrcpy')) {
          // Send settings updates that don't require reconnect
          if (
            e.affectsConfiguration('scrcpy.showStats') ||
            e.affectsConfiguration('scrcpy.audio')
          ) {
            this._sendSettings();
          }

          // Reconnect for scrcpy options that affect the stream
          const reconnectSettings = [
            'scrcpy.path',
            'scrcpy.screenOff',
            'scrcpy.stayAwake',
            'scrcpy.maxSize',
            'scrcpy.bitRate',
            'scrcpy.maxFps',
            'scrcpy.showTouches',
            'scrcpy.audio',
            'scrcpy.lockVideoOrientation',
          ];
          const needsReconnect = reconnectSettings.some((s) => e.affectsConfiguration(s));

          if (needsReconnect && this._deviceManager) {
            this._view?.webview.postMessage({
              type: 'status',
              message: vscode.l10n.t('Settings changed. Reconnecting...'),
            });
            this._deviceManager.updateConfig(this._getConfig());
            await this._deviceManager.disconnectAll();
            await this._autoConnectAllDevices();
          }
        }
      },
      null,
      this._disposables
    );

    // Initial connection if view is already visible
    if (webviewView.visible) {
      this._initializeAndConnect();
    }
  }

  private _getConfig(): ScrcpyConfig {
    const config = vscode.workspace.getConfiguration('scrcpy');
    return {
      scrcpyPath: config.get<string>('path', ''),
      screenOff: config.get<boolean>('screenOff', false),
      stayAwake: config.get<boolean>('stayAwake', true),
      maxSize: config.get<number>('maxSize', 1920),
      bitRate: config.get<number>('bitRate', 8),
      maxFps: config.get<number>('maxFps', 60),
      showTouches: config.get<boolean>('showTouches', false),
      audio: config.get<boolean>('audio', true),
      clipboardSync: config.get<boolean>('clipboardSync', true),
      autoConnect: config.get<boolean>('autoConnect', true),
      autoReconnect: config.get<boolean>('autoReconnect', true),
      reconnectRetries: config.get<number>('reconnectRetries', 2),
      lockVideoOrientation: config.get<boolean>('lockVideoOrientation', false),
      scrollSensitivity: config.get<number>('scrollSensitivity', 1.0),
    };
  }

  private _sendSettings(): void {
    if (!this._view) {
      return;
    }
    const config = vscode.workspace.getConfiguration('scrcpy');
    this._view.webview.postMessage({
      type: 'settings',
      showStats: config.get<boolean>('showStats', false),
      audioEnabled: config.get<boolean>('audio', true),
    });
  }

  private _initializeAndConnect() {
    if (!this._view || this._deviceManager) {
      return;
    }

    const config = this._getConfig();

    this._deviceManager = new DeviceManager(
      // Video frame callback
      (deviceId, frameData, isConfig, isKeyFrame, width, height) => {
        if (this._isDisposed || !this._view) {
          return;
        }
        this._view.webview.postMessage({
          type: 'videoFrame',
          deviceId,
          data: Array.from(frameData),
          isConfig,
          isKeyFrame,
          width,
          height,
        });
      },
      // Audio frame callback
      (deviceId, frameData, isConfig) => {
        if (this._isDisposed || !this._view) {
          return;
        }
        this._view.webview.postMessage({
          type: 'audioFrame',
          deviceId,
          data: Array.from(frameData),
          isConfig,
        });
      },
      // Status callback
      (deviceId, status) => {
        if (this._isDisposed || !this._view) {
          return;
        }
        this._view.webview.postMessage({
          type: 'status',
          deviceId,
          message: status,
        });
      },
      // Session list callback
      (sessions) => {
        if (this._isDisposed || !this._view) {
          return;
        }
        this._view.webview.postMessage({
          type: 'sessionList',
          sessions,
        });
      },
      // Error callback
      (deviceId, message) => {
        if (this._isDisposed || !this._view) {
          return;
        }
        this._view.webview.postMessage({
          type: 'error',
          deviceId,
          message,
        });
      },
      config,
      // Pass VS Code clipboard API for clipboard sync
      vscode.env.clipboard
    );

    this._autoConnectAllDevices();

    // Start monitoring for new USB devices (auto-connect)
    this._deviceManager.startDeviceMonitoring();
  }

  private async _autoConnectAllDevices() {
    const signal = this._abortController?.signal;
    if (!this._deviceManager) {
      return;
    }

    try {
      const devices = await this._deviceManager.getAvailableDevices();
      if (signal?.aborted || !this._deviceManager) {
        return;
      }

      if (devices.length === 0) {
        this._view?.webview.postMessage({
          type: 'error',
          message: vscode.l10n.t(
            'No Android devices found.\n\nPlease connect a device and enable USB debugging.'
          ),
        });
        return;
      }

      // Connect to all available devices (including WiFi devices already in ADB)
      // This ensures WiFi connections persist across window reloads
      for (const device of devices) {
        if (signal?.aborted || !this._deviceManager) {
          return;
        }
        try {
          await this._deviceManager.addDevice(device);
        } catch {
          // Continue connecting other devices even if one fails
        }
      }
    } catch (error) {
      if (signal?.aborted || !this._deviceManager) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this._view?.webview.postMessage({
        type: 'error',
        message: vscode.l10n.t('Connection failed: {0}', message),
      });
    }
  }

  private async _onDidReceiveMessage(message: {
    type: string;
    deviceId?: string;
    serial?: string;
    x?: number;
    y?: number;
    action?: 'down' | 'move' | 'up';
    screenWidth?: number;
    screenHeight?: number;
    width?: number;
    height?: number;
    keycode?: number;
    text?: string;
    metastate?: number;
    deltaX?: number;
    deltaY?: number;
  }) {
    switch (message.type) {
      case 'touch':
        if (
          this._deviceManager &&
          message.x !== undefined &&
          message.y !== undefined &&
          message.action
        ) {
          this._deviceManager.sendTouch(
            message.x,
            message.y,
            message.action,
            message.screenWidth ?? 0,
            message.screenHeight ?? 0
          );
        }
        break;

      case 'scroll':
        if (
          this._deviceManager &&
          message.x !== undefined &&
          message.y !== undefined &&
          message.deltaX !== undefined &&
          message.deltaY !== undefined
        ) {
          this._deviceManager.sendScroll(message.x, message.y, message.deltaX, message.deltaY);
        }
        break;

      case 'keyDown':
        if (this._deviceManager && message.keycode !== undefined) {
          this._deviceManager.sendKeyDown(message.keycode);
        }
        break;

      case 'keyUp':
        if (this._deviceManager && message.keycode !== undefined) {
          this._deviceManager.sendKeyUp(message.keycode);
        }
        break;

      case 'injectText':
        if (this._deviceManager && message.text !== undefined) {
          this._deviceManager.sendText(message.text);
        }
        break;

      case 'injectKeycode':
        if (
          this._deviceManager &&
          message.keycode !== undefined &&
          message.metastate !== undefined &&
          (message.action === 'down' || message.action === 'up')
        ) {
          this._deviceManager.sendKeyWithMeta(message.keycode, message.action, message.metastate);
        }
        break;

      case 'pasteFromHost':
        if (this._deviceManager) {
          await this._deviceManager.pasteFromHost();
        }
        break;

      case 'copyToHost':
        if (this._deviceManager) {
          await this._deviceManager.copyToHost();
        }
        break;

      case 'rotateDevice':
        if (this._deviceManager) {
          this._deviceManager.rotateDevice();
        }
        break;

      case 'screenshot':
        await this._takeAndSaveScreenshot();
        break;

      case 'toggleAudio':
        {
          const config = vscode.workspace.getConfiguration('scrcpy');
          const currentAudio = config.get<boolean>('audio', true);
          config.update('audio', !currentAudio, vscode.ConfigurationTarget.Global);
        }
        break;

      case 'dimensionsChanged':
        if (this._deviceManager && message.deviceId && message.width && message.height) {
          this._deviceManager.updateDimensions(message.deviceId, message.width, message.height);
        }
        break;

      case 'switchTab':
        if (this._deviceManager && message.deviceId) {
          this._deviceManager.switchToDevice(message.deviceId);
        }
        break;

      case 'closeTab':
        if (this._deviceManager && message.deviceId) {
          await this._deviceManager.removeDevice(message.deviceId);
        }
        break;

      case 'showDevicePicker':
        await this._showDevicePicker();
        break;

      case 'connectDevice':
        if (this._deviceManager && message.serial) {
          const devices = await this._deviceManager.getAvailableDevices();
          const device = devices.find((d) => d.serial === message.serial);
          if (device) {
            try {
              await this._deviceManager.addDevice(device);
            } catch {
              // Error already handled via callback
            }
          }
        }
        break;

      case 'ready':
        console.log('Webview ready');
        this._sendSettings();
        break;

      case 'reconnect':
        await this._disconnect();
        this._initializeAndConnect();
        break;

      case 'openSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:izan.scrcpy-vscode');
        break;

      case 'browseScrcpyPath': {
        const result = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: vscode.l10n.t('Select scrcpy installation folder'),
        });
        if (result && result[0]) {
          await vscode.workspace.getConfiguration('scrcpy').update('path', result[0].fsPath, true);
        }
        break;
      }

      case 'resetScrcpyPath':
        await vscode.workspace.getConfiguration('scrcpy').update('path', undefined, true);
        break;

      case 'getDeviceInfo':
        if (this._deviceManager && message.serial) {
          try {
            const deviceInfo = await this._deviceManager.getCachedDeviceInfo(message.serial);
            this._view?.webview.postMessage({
              type: 'deviceInfo',
              serial: message.serial,
              info: deviceInfo,
            });
          } catch (error) {
            console.error('Failed to get device info:', error);
            // Send empty response on error
            this._view?.webview.postMessage({
              type: 'deviceInfo',
              serial: message.serial,
              info: null,
            });
          }
        }
        break;
    }
  }

  /**
   * Show WiFi connection dialog and connect to device
   */
  public async connectWifi(): Promise<void> {
    // Ask user which connection method to use
    const method = await vscode.window.showQuickPick(
      [
        {
          label: vscode.l10n.t('$(key) Pair new device (Android 11+)'),
          description: vscode.l10n.t('Use pairing code from Wireless debugging'),
          value: 'pair',
        },
        {
          label: vscode.l10n.t('$(plug) Connect to paired device'),
          description: vscode.l10n.t('Device was previously paired or uses legacy ADB WiFi'),
          value: 'connect',
        },
      ],
      {
        placeHolder: vscode.l10n.t('How do you want to connect?'),
        title: vscode.l10n.t('Connect to Device over WiFi'),
      }
    );

    if (!method) {
      return; // User cancelled
    }

    if (method.value === 'pair') {
      await this._pairWifiDevice();
    } else {
      await this._connectWifiDevice();
    }
  }

  /**
   * Pair with a new device using Android 11+ Wireless Debugging
   */
  private async _pairWifiDevice(): Promise<void> {
    // Step 1: Get pairing address (IP:port from Wireless debugging > Pair device)
    const pairingAddress = await vscode.window.showInputBox({
      title: vscode.l10n.t('Pair Device (Step 1/2)'),
      prompt: vscode.l10n.t('Enter the pairing address from "Pair device with pairing code"'),
      placeHolder: '192.168.1.100:37000',
      validateInput: (value) => {
        if (!value) {
          return vscode.l10n.t('Pairing address is required');
        }
        const ipPortRegex = /^(\d{1,3}\.){3}\d{1,3}:\d+$/;
        if (!ipPortRegex.test(value)) {
          return vscode.l10n.t('Enter address as IP:port (e.g., 192.168.1.100:37000)');
        }
        return undefined;
      },
    });

    if (!pairingAddress) {
      return;
    }

    // Step 2: Get pairing code
    const pairingCode = await vscode.window.showInputBox({
      title: vscode.l10n.t('Pair Device (Step 2/2)'),
      prompt: vscode.l10n.t('Enter the 6-digit pairing code'),
      placeHolder: '123456',
      validateInput: (value) => {
        if (!value) {
          return vscode.l10n.t('Pairing code is required');
        }
        if (!/^\d{6}$/.test(value)) {
          return vscode.l10n.t('Pairing code must be 6 digits');
        }
        return undefined;
      },
    });

    if (!pairingCode) {
      return;
    }

    // Initialize device manager if not already
    if (!this._deviceManager) {
      this._initializeAndConnect();
    }

    if (!this._deviceManager) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to initialize device manager'));
      return;
    }

    // Pair the device
    const pairResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Pairing with {0}...', pairingAddress),
        cancellable: false,
      },
      async () => {
        try {
          await this._deviceManager!.pairWifi(pairingAddress, pairingCode);
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(vscode.l10n.t('Pairing failed: {0}', message));
          return false;
        }
      }
    );

    if (!pairResult) {
      return;
    }

    vscode.window.showInformationMessage(
      vscode.l10n.t('Device paired successfully! Now connecting...')
    );

    // After pairing, prompt for the connection address
    // The connection port is different from the pairing port
    const ip = pairingAddress.split(':')[0];
    const connectAddress = await vscode.window.showInputBox({
      title: vscode.l10n.t('Connect to Paired Device'),
      prompt: vscode.l10n.t(
        'Enter the connection address shown in Wireless debugging (not the pairing address)'
      ),
      placeHolder: `${ip}:5555`,
      value: ip,
      validateInput: (value) => {
        if (!value) {
          return vscode.l10n.t('Connection address is required');
        }
        const ipPortRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
        if (!ipPortRegex.test(value)) {
          return vscode.l10n.t('Enter address as IP or IP:port');
        }
        return undefined;
      },
    });

    if (!connectAddress) {
      return;
    }

    await this._connectWifiDeviceWithAddress(connectAddress);
  }

  /**
   * Connect to an already paired or legacy WiFi device
   */
  private async _connectWifiDevice(): Promise<void> {
    const ipAddress = await vscode.window.showInputBox({
      title: vscode.l10n.t('Connect to Device over WiFi'),
      prompt: vscode.l10n.t('Enter the IP address (and port) of your Android device'),
      placeHolder: '192.168.1.100:5555',
      validateInput: (value) => {
        if (!value) {
          return vscode.l10n.t('IP address is required');
        }
        const ipPortRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
        if (!ipPortRegex.test(value)) {
          return vscode.l10n.t(
            'Enter a valid IP address (e.g., 192.168.1.100 or 192.168.1.100:5555)'
          );
        }
        const ipPart = value.split(':')[0];
        const octets = ipPart.split('.').map(Number);
        if (octets.some((o) => o < 0 || o > 255)) {
          return vscode.l10n.t('Invalid IP address: each octet must be between 0 and 255');
        }
        return undefined;
      },
    });

    if (!ipAddress) {
      return;
    }

    await this._connectWifiDeviceWithAddress(ipAddress);
  }

  /**
   * Show file picker and install APK on device
   */
  public async installApk(): Promise<void> {
    // Get default path from settings (fallback to Downloads folder)
    const config = vscode.workspace.getConfiguration('scrcpy');
    const customPath = config.get<string>('apkInstallDefaultPath', '');
    const defaultPath = customPath || path.join(os.homedir(), 'Downloads');

    // Show file picker for APK files
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(defaultPath),
      filters: {
        'APK Files': ['apk'],
      },
      title: vscode.l10n.t('Select APK to Install'),
    });

    if (!result || result.length === 0) {
      return; // User cancelled
    }

    const apkPath = result[0].fsPath;
    const apkName = path.basename(apkPath);

    // Initialize device manager if not already
    if (!this._deviceManager) {
      vscode.window.showErrorMessage(vscode.l10n.t('No device connected'));
      return;
    }

    // Install with progress notification
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Installing {0}...', apkName),
        cancellable: false,
      },
      async () => {
        try {
          await this._deviceManager!.installApk(apkPath);
          vscode.window.showInformationMessage(
            vscode.l10n.t('APK installed successfully: {0}', apkName)
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(vscode.l10n.t('Failed to install APK: {0}', message));
        }
      }
    );
  }

  /**
   * Show file/folder picker and upload to device
   */
  public async uploadFiles(): Promise<void> {
    // Get default path from settings (reuse APK default path setting)
    const config = vscode.workspace.getConfiguration('scrcpy');
    const customPath = config.get<string>('apkInstallDefaultPath', '');
    const defaultPath = customPath || path.join(os.homedir(), 'Downloads');

    // Show file/folder picker - allow multiple selections
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: true,
      defaultUri: vscode.Uri.file(defaultPath),
      title: vscode.l10n.t('Select Files or Folders to Upload'),
    });

    if (!result || result.length === 0) {
      return; // User cancelled
    }

    // Check device connection
    if (!this._deviceManager) {
      vscode.window.showErrorMessage(vscode.l10n.t('No device connected'));
      return;
    }

    // Upload with progress notification
    // adb push handles directories recursively and supports multiple paths in one command
    const filePaths = result.map((uri) => uri.fsPath);
    const itemNames = filePaths.map((p) => path.basename(p)).join(', ');

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Uploading to device...'),
        cancellable: false,
      },
      async () => {
        try {
          await this._deviceManager!.pushFiles(filePaths);
          vscode.window.showInformationMessage(
            vscode.l10n.t('Successfully uploaded to /sdcard/Download/: {0}', itemNames)
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(vscode.l10n.t('Failed to upload: {0}', message));
        }
      }
    );
  }

  /**
   * Show app picker and launch app on device
   */
  public async launchApp(): Promise<void> {
    // Check device connection
    if (!this._deviceManager) {
      vscode.window.showErrorMessage(vscode.l10n.t('No device connected'));
      return;
    }

    // Get list of installed apps with progress notification
    const apps = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Loading installed apps...'),
        cancellable: false,
      },
      async () => {
        try {
          // Get all apps (not just third-party) for better UX
          return await this._deviceManager!.getInstalledApps(false);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            vscode.l10n.t('Failed to get installed apps: {0}', message)
          );
          return null;
        }
      }
    );

    if (!apps || apps.length === 0) {
      return;
    }

    // Create quick pick items with package names
    const items = apps.map((app) => ({
      label: app.packageName,
      packageName: app.packageName,
    }));

    // Show quick pick with search
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('Select an app to launch'),
    });

    if (!selected) {
      return; // User cancelled
    }

    // Launch the selected app
    try {
      this._deviceManager.launchApp(selected.packageName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to launch app: {0}', message));
    }
  }

  /**
   * Connect to a WiFi device with the given address
   */
  private async _connectWifiDeviceWithAddress(address: string): Promise<void> {
    // Parse IP and port
    let ip: string;
    let port: number;

    if (address.includes(':')) {
      const parts = address.split(':');
      ip = parts[0];
      port = parseInt(parts[1], 10);
    } else {
      ip = address;
      port = 5555;
    }

    // Initialize device manager if not already
    if (!this._deviceManager) {
      this._initializeAndConnect();
    }

    if (!this._deviceManager) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to initialize device manager'));
      return;
    }

    // Show progress notification
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Connecting to {0}...', `${ip}:${port}`),
        cancellable: false,
      },
      async () => {
        try {
          // Connect via ADB
          const deviceInfo = await this._deviceManager!.connectWifi(ip, port);

          // Now add the device to the session
          await this._deviceManager!.addDevice(deviceInfo);

          vscode.window.showInformationMessage(
            vscode.l10n.t('Connected to {0} over WiFi', deviceInfo.name)
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(vscode.l10n.t('WiFi connection failed: {0}', message));
        }
      }
    );
  }

  private async _showDevicePicker(): Promise<void> {
    const signal = this._abortController?.signal;
    if (!this._deviceManager) {
      return;
    }

    const devices = await this._deviceManager.getAvailableDevices();
    if (signal?.aborted) {
      return;
    }

    if (devices.length === 0) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('No Android devices found. Please connect a device and enable USB debugging.')
      );
      return;
    }

    // Filter out already connected devices
    const availableDevices = devices.filter(
      (d) => !this._deviceManager!.isDeviceConnected(d.serial)
    );

    if (availableDevices.length === 0) {
      vscode.window.showInformationMessage(
        vscode.l10n.t('All available devices are already connected.')
      );
      return;
    }

    // Show quick pick
    const items = availableDevices.map((d) => ({
      label: d.name,
      description: d.serial,
      device: d,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('Select a device to connect'),
    });

    if (selected && !signal?.aborted) {
      if (!this._deviceManager) {
        return;
      }
      try {
        await this._deviceManager.addDevice(selected.device);
      } catch {
        // Error already handled via callback
      }
    }
  }

  private async _disconnect() {
    if (this._deviceManager) {
      this._deviceManager.stopDeviceMonitoring();
      await this._deviceManager.disconnectAll();
      this._deviceManager = undefined;
    }
  }

  private async _onViewDisposed() {
    this._isDisposed = true;
    this._abortController?.abort();
    await this._disconnect();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      disposable?.dispose();
    }
  }

  public async start() {
    if (this._view) {
      this._view.show?.(true);
      if (!this._deviceManager) {
        this._initializeAndConnect();
      }
    }
  }

  public async stop() {
    await this._disconnect();
    this._view?.webview.postMessage({
      type: 'status',
      message: vscode.l10n.t('Disconnected'),
    });
  }

  private async _takeAndSaveScreenshot(): Promise<void> {
    const notifyComplete = () => {
      this._view?.webview.postMessage({ type: 'screenshotComplete' });
    };

    if (!this._deviceManager) {
      vscode.window.showErrorMessage(vscode.l10n.t('No device connected'));
      notifyComplete();
      return;
    }

    try {
      // Take screenshot from device (original resolution, lossless PNG)
      const pngBuffer = await this._deviceManager.takeScreenshot();

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `screenshot-${timestamp}.png`;

      // Get settings
      const config = vscode.workspace.getConfiguration('scrcpy');
      const showSaveDialog = config.get<boolean>('screenshotShowSaveDialog', false);
      const customPath = config.get<string>('screenshotSavePath', '');

      let uri: vscode.Uri | undefined;

      if (showSaveDialog) {
        // Show save dialog
        uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(filename),
          filters: {
            'PNG Image': ['png'],
          },
          title: vscode.l10n.t('Save Screenshot'),
        });

        if (!uri) {
          notifyComplete();
          return; // User cancelled
        }
      } else {
        // Save directly to configured path or Downloads folder
        const saveDir = customPath || path.join(os.homedir(), 'Downloads');
        uri = vscode.Uri.file(path.join(saveDir, filename));
      }

      // Write to file
      await vscode.workspace.fs.writeFile(uri, pngBuffer);

      // Open the screenshot in the main editor panel
      await vscode.commands.executeCommand('vscode.open', uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to take screenshot: {0}', message));
    } finally {
      notifyComplete();
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return getHtmlForWebview(webview, this._extensionUri);
  }
}
