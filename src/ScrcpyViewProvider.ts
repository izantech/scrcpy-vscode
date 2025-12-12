import * as vscode from 'vscode';
import { ScrcpyConfig } from './ScrcpyConnection';
import { DeviceManager, DeviceInfo } from './DeviceManager';

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
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')]
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
    webviewView.onDidDispose(() => {
      if (this._view === webviewView) {
        this._onViewDisposed().catch(console.error);
      }
    }, null, this._disposables);

    // Auto-connect when view becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && !this._deviceManager) {
        this._initializeAndConnect();
      }
    }, null, this._disposables);

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('scrcpy')) {
        // Send settings updates that don't require reconnect
        if (e.affectsConfiguration('scrcpy.showStats') || e.affectsConfiguration('scrcpy.audio')) {
          this._sendSettings();
        }

        // Reconnect for scrcpy options that affect the stream
        const reconnectSettings = ['scrcpy.path', 'scrcpy.screenOff', 'scrcpy.stayAwake',
          'scrcpy.maxSize', 'scrcpy.bitRate', 'scrcpy.maxFps', 'scrcpy.showTouches', 'scrcpy.audio',
          'scrcpy.lockVideoOrientation'];
        const needsReconnect = reconnectSettings.some(s => e.affectsConfiguration(s));

        if (needsReconnect && this._deviceManager) {
          this._view?.webview.postMessage({
            type: 'status',
            message: 'Settings changed. Reconnecting...'
          });
          this._deviceManager.updateConfig(this._getConfig());
          await this._deviceManager.disconnectAll();
          await this._autoConnectFirstDevice();
        }
      }
    }, null, this._disposables);

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
      clipboardPollInterval: config.get<number>('clipboardPollInterval', 1000),
      autoConnect: config.get<boolean>('autoConnect', true),
      autoReconnect: config.get<boolean>('autoReconnect', true),
      reconnectRetries: config.get<number>('reconnectRetries', 2),
      lockVideoOrientation: config.get<boolean>('lockVideoOrientation', false)
    };
  }

  private _sendSettings(): void {
    if (!this._view) return;
    const config = vscode.workspace.getConfiguration('scrcpy');
    this._view.webview.postMessage({
      type: 'settings',
      showStats: config.get<boolean>('showStats', false),
      audioEnabled: config.get<boolean>('audio', true)
    });
  }

  private _initializeAndConnect() {
    if (!this._view || this._deviceManager) return;

    const config = this._getConfig();

    this._deviceManager = new DeviceManager(
      // Video frame callback
      (deviceId, frameData, isConfig, width, height) => {
        if (this._isDisposed || !this._view) return;
        this._view.webview.postMessage({
          type: 'videoFrame',
          deviceId,
          data: Array.from(frameData),
          isConfig,
          width,
          height
        });
      },
      // Audio frame callback
      (deviceId, frameData, isConfig) => {
        if (this._isDisposed || !this._view) return;
        this._view.webview.postMessage({
          type: 'audioFrame',
          deviceId,
          data: Array.from(frameData),
          isConfig
        });
      },
      // Status callback
      (deviceId, status) => {
        if (this._isDisposed || !this._view) return;
        this._view.webview.postMessage({
          type: 'status',
          deviceId,
          message: status
        });
      },
      // Session list callback
      (sessions) => {
        if (this._isDisposed || !this._view) return;
        this._view.webview.postMessage({
          type: 'sessionList',
          sessions
        });
      },
      // Error callback
      (deviceId, message) => {
        if (this._isDisposed || !this._view) return;
        this._view.webview.postMessage({
          type: 'error',
          deviceId,
          message
        });
      },
      config,
      // Pass VS Code clipboard API for clipboard sync
      vscode.env.clipboard
    );

    this._autoConnectFirstDevice();

    // Start monitoring for new devices (auto-connect)
    this._deviceManager.startDeviceMonitoring();
  }

  private async _autoConnectFirstDevice() {
    const signal = this._abortController?.signal;
    if (!this._deviceManager) return;

    try {
      const devices = await this._deviceManager.getAvailableDevices();
      if (signal?.aborted || !this._deviceManager) return;
      if (devices.length > 0) {
        await this._deviceManager.addDevice(devices[0]);
      } else {
        this._view?.webview.postMessage({
          type: 'error',
          message: 'No Android devices found.\n\nPlease connect a device and enable USB debugging.'
        });
      }
    } catch (error) {
      if (signal?.aborted || !this._deviceManager) return;
      const message = error instanceof Error ? error.message : String(error);
      this._view?.webview.postMessage({
        type: 'error',
        message: `Connection failed: ${message}`
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
  }) {
    switch (message.type) {
      case 'touch':
        if (this._deviceManager && message.x !== undefined && message.y !== undefined && message.action) {
          this._deviceManager.sendTouch(
            message.x,
            message.y,
            message.action,
            message.screenWidth ?? 0,
            message.screenHeight ?? 0
          );
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
        if (this._deviceManager && message.keycode !== undefined &&
            message.metastate !== undefined &&
            (message.action === 'down' || message.action === 'up')) {
          this._deviceManager.sendKeyWithMeta(
            message.keycode,
            message.action,
            message.metastate
          );
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
          const device = devices.find(d => d.serial === message.serial);
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
        vscode.commands.executeCommand('workbench.action.openSettings', '@id:scrcpy*');
        break;

      case 'browseScrcpyPath':
        const result = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: 'Select scrcpy installation folder'
        });
        if (result && result[0]) {
          await vscode.workspace.getConfiguration('scrcpy').update('path', result[0].fsPath, true);
        }
        break;

      case 'resetScrcpyPath':
        await vscode.workspace.getConfiguration('scrcpy').update('path', undefined, true);
        break;
    }
  }

  private async _showDevicePicker(): Promise<void> {
    const signal = this._abortController?.signal;
    if (!this._deviceManager) return;

    const devices = await this._deviceManager.getAvailableDevices();
    if (signal?.aborted) return;

    if (devices.length === 0) {
      vscode.window.showErrorMessage('No Android devices found. Please connect a device and enable USB debugging.');
      return;
    }

    // Filter out already connected devices
    const availableDevices = devices.filter(d => !this._deviceManager!.isDeviceConnected(d.serial));

    if (availableDevices.length === 0) {
      vscode.window.showInformationMessage('All available devices are already connected.');
      return;
    }

    // Show quick pick
    const items = availableDevices.map(d => ({
      label: d.name,
      description: d.serial,
      device: d
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a device to connect'
    });

    if (selected && !signal?.aborted) {
      if (!this._deviceManager) return;
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
      message: 'Disconnected'
    });
  }

  private async _takeAndSaveScreenshot(): Promise<void> {
    const notifyComplete = () => {
      this._view?.webview.postMessage({ type: 'screenshotComplete' });
    };

    if (!this._deviceManager) {
      vscode.window.showErrorMessage('No device connected');
      notifyComplete();
      return;
    }

    try {
      // Take screenshot from device (original resolution, lossless PNG)
      const pngBuffer = await this._deviceManager.takeScreenshot();

      // Generate default filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultFilename = `screenshot-${timestamp}.png`;

      // Show save dialog
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultFilename),
        filters: {
          'PNG Image': ['png']
        },
        title: 'Save Screenshot'
      });

      if (!uri) {
        notifyComplete();
        return; // User cancelled
      }

      // Write to file
      await vscode.workspace.fs.writeFile(uri, pngBuffer);

      // Open the screenshot in the main editor panel
      await vscode.commands.executeCommand('vscode.open', uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to take screenshot: ${message}`);
    } finally {
      notifyComplete();
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'main.js')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 script-src 'nonce-${nonce}' 'wasm-unsafe-eval';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>scrcpy</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--vscode-sideBar-background, #1e1e1e);
    }

    .container {
      width: 100%;
      height: 100%;
      min-width: 200px;
      display: flex;
      flex-direction: column;
      container-type: inline-size;
    }

    /* Tab bar - fixed at top */
    .tab-bar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
      overflow-x: auto;
      overflow-y: hidden;
      flex-shrink: 0;
    }

    .tab-bar.hidden {
      display: none;
    }

    .tab {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--vscode-tab-inactiveBackground, #2d2d2d);
      color: var(--vscode-tab-inactiveForeground, #969696);
      border: 1px solid transparent;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      min-width: 60px;
      max-width: 120px;
    }

    .tab.active {
      background: var(--vscode-tab-activeBackground, #1e1e1e);
      color: var(--vscode-tab-activeForeground, #ffffff);
      border-color: var(--vscode-focusBorder, #0078d4);
    }

    .tab:hover:not(.active) {
      background: var(--vscode-tab-hoverBackground, #3a3a3a);
    }

    .tab-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tab-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      border-radius: 3px;
      font-size: 12px;
      opacity: 0.5;
      line-height: 1;
    }

    .tab-close:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
    }

    .tab-add {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      background: transparent;
      color: var(--vscode-foreground, #ccc);
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
      flex-shrink: 0;
      opacity: 0.7;
    }

    .tab-add:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
    }

    /* Canvas container - takes remaining space */
    .canvas-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }

    .device-canvas {
      display: block;
      touch-action: none;
      cursor: pointer;
      background: #000;
      border-radius: 4px;
    }

    .device-canvas.hidden {
      display: none;
    }

    .device-canvas.keyboard-focused {
      outline: 2px solid var(--vscode-focusBorder, #0078d4);
      outline-offset: -2px;
    }

    /* Control toolbar - fixed at bottom */
    .control-toolbar {
      display: flex;
      align-items: center;
      padding: 6px 8px;
      background: var(--vscode-sideBar-background);
      border-top: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
      flex-shrink: 0;
    }

    .control-toolbar.hidden {
      display: none;
    }

    .toolbar-group {
      display: flex;
      gap: 3px;
      flex: 1;
    }

    .toolbar-left {
      justify-content: flex-start;
    }

    .toolbar-center {
      justify-content: center;
    }

    .toolbar-right {
      justify-content: flex-end;
    }

    /* Hide non-essential buttons when toolbar is narrow */
    @container (max-width: 220px) {
      .toolbar-left,
      .toolbar-right {
        display: none;
      }
      .toolbar-center {
        flex: 1;
      }
    }

    .control-btn {
      min-width: 28px;
      height: 26px;
      padding: 4px 5px;
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ccc);
      border: 1px solid var(--vscode-input-border, #3a3d41);
      border-radius: 4px;
      cursor: pointer;
      font-size: 10px;
      font-family: var(--vscode-font-family);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.1s;
    }

    .control-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }

    .control-btn:active {
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, white);
      transform: scale(0.95);
    }

    .control-btn.loading {
      pointer-events: none;
      opacity: 0.7;
    }

    .btn-spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--vscode-button-secondaryForeground, #ccc);
      border-top-color: transparent;
      border-radius: 50%;
      animation: btn-spin 0.8s linear infinite;
    }

    @keyframes btn-spin {
      to { transform: rotate(360deg); }
    }

    /* Status overlay */
    .status {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: var(--vscode-foreground, #ccc);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 13px;
      text-align: center;
      padding: 24px;
      max-width: 90%;
      white-space: pre-wrap;
      word-wrap: break-word;
      background: var(--vscode-editor-background, #1e1e1e);
      border-radius: 8px;
      border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
      z-index: 10;
    }

    .status.hidden {
      display: none;
    }

    .status .spinner {
      width: 48px;
      height: 48px;
      border: 3px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.2));
      border-top-color: var(--vscode-focusBorder, #0078d4);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 12px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error {
      color: var(--vscode-errorForeground, #f48771);
    }

    .stats {
      position: absolute;
      bottom: 4px;
      right: 4px;
      background: var(--vscode-badge-background, rgba(0, 0, 0, 0.7));
      color: var(--vscode-badge-foreground, #888);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      z-index: 5;
    }

    .stats.hidden {
      display: none;
    }

    .reconnect-btn {
      margin-top: 12px;
      padding: 6px 12px;
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, white);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      font-family: var(--vscode-font-family);
    }

    .reconnect-btn:hover {
      background: var(--vscode-button-hoverBackground, #106ebe);
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Tab bar - fixed at top -->
    <div id="tab-bar" class="tab-bar hidden">
      <button class="tab-add" id="add-device-btn" title="Add Device">+</button>
    </div>

    <!-- Canvas container - centered -->
    <div id="canvas-container" class="canvas-container">
      <!-- Status overlay -->
      <div id="status" class="status">
        <div class="spinner"></div>
        <div id="status-text">Connecting to device...</div>
      </div>
      <!-- Stats display -->
      <div id="stats" class="stats hidden"></div>
    </div>

    <!-- Control toolbar - fixed at bottom -->
    <div id="control-toolbar" class="control-toolbar hidden">
      <div class="toolbar-group toolbar-left">
        <button class="control-btn" id="mute-btn" title="Disable audio forwarding">&#x1F50A;</button>
        <button class="control-btn" data-keycode="25" title="Volume Down">Vol-</button>
        <button class="control-btn" data-keycode="24" title="Volume Up">Vol+</button>
      </div>
      <div class="toolbar-group toolbar-center">
        <button class="control-btn" data-keycode="4" title="Back">&#x25C0;</button>
        <button class="control-btn" data-keycode="3" title="Home">&#x25CF;</button>
        <button class="control-btn" data-keycode="187" title="Recent Apps">&#x25A0;</button>
      </div>
      <div class="toolbar-group toolbar-right">
        <button class="control-btn" id="screenshot-btn" title="Take screenshot"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
        <button class="control-btn" id="rotate-btn" title="Change to landscape"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M18 12h.01"/></svg></button>
        <button class="control-btn" data-keycode="26" title="Power">&#x23FB;</button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
