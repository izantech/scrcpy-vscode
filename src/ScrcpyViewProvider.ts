import * as vscode from 'vscode';
import { ScrcpyConnection, ScrcpyConfig } from './ScrcpyConnection';

export class ScrcpyViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'scrcpy.deviceView';

  private _view?: vscode.WebviewView;
  private _connection?: ScrcpyConnection;
  private _isConnecting = false;
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    // Clean up any previous disposables (resolveWebviewView can be called multiple times)
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }

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

    // Handle view disposal
    webviewView.onDidDispose(() => {
      this._onViewDisposed().catch(console.error);
    }, null, this._disposables);

    // Auto-connect when view becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && !this._connection) {
        this._connect();
      }
    }, null, this._disposables);

    // Listen for configuration changes and reconnect
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('scrcpy') && this._connection) {
        try {
          vscode.window.showInformationMessage('Scrcpy settings changed. Reconnecting...');
          await this._disconnect();
          await this._connect();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Failed to reconnect: ${message}`);
        }
      }
    }, null, this._disposables);

    // Initial connection if view is already visible
    if (webviewView.visible) {
      this._connect();
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
      showTouches: config.get<boolean>('showTouches', false)
    };
  }

  private async _connect() {
    if (!this._view || this._isConnecting || this._connection) return;

    this._isConnecting = true;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Connecting to Android device...',
          cancellable: true
        },
        async (progress, token) => {
          const config = this._getConfig();
          this._connection = new ScrcpyConnection(
            // Video frame callback
            (frameData: Uint8Array, isConfig: boolean, width?: number, height?: number) => {
              this._view?.webview.postMessage({
                type: 'videoFrame',
                data: Array.from(frameData),
                isConfig,
                width,
                height
              });
            },
            // Status callback
            (status: string) => {
              this._view?.webview.postMessage({
                type: 'status',
                message: status
              });
            },
            config
          );

          if (token.isCancellationRequested) {
            this._connection = undefined;
            return;
          }

          await this._connection.connect();

          if (token.isCancellationRequested) {
            await this._connection.disconnect();
            this._connection = undefined;
            return;
          }

          progress.report({ message: 'Starting screen mirroring...' });
          await this._connection.startScrcpy();

          vscode.window.showInformationMessage('Connected to Android device');
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to connect: ${message}`);
      this._view?.webview.postMessage({
        type: 'error',
        message: `Connection failed: ${message}`
      });
      this._connection = undefined;
    } finally {
      this._isConnecting = false;
    }
  }

  private async _onDidReceiveMessage(message: {
    type: string;
    x?: number;
    y?: number;
    action?: 'down' | 'move' | 'up';
    screenWidth?: number;
    screenHeight?: number;
  }) {
    switch (message.type) {
      case 'touch':
        if (this._connection && message.x !== undefined && message.y !== undefined && message.action) {
          this._connection.sendTouch(
            message.x,
            message.y,
            message.action,
            message.screenWidth ?? 0,
            message.screenHeight ?? 0
          );
        }
        break;

      case 'ready':
        console.log('Webview ready');
        break;

      case 'reconnect':
        await this._disconnect();
        await this._connect();
        break;

      case 'openSettings':
        vscode.commands.executeCommand('workbench.action.openSettings', 'scrcpy');
        break;
    }
  }

  private async _disconnect() {
    if (this._connection) {
      await this._connection.disconnect().catch(console.error);
      this._connection = undefined;
    }
  }

  private async _onViewDisposed() {
    await this._disconnect();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      disposable?.dispose();
    }
  }

  public async start() {
    if (this._view) {
      this._view.show?.(true);
      if (!this._connection) {
        await this._connect();
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
                 script-src 'nonce-${nonce}';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 img-src ${webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Android Device</title>
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
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 8px;
    }

    #screen {
      width: 100%;
      max-height: calc(100vh - 60px);
      object-fit: contain;
      touch-action: none;
      cursor: pointer;
      background: #000;
      border-radius: 4px;
    }

    .status {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: var(--vscode-foreground, #ccc);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 13px;
      text-align: center;
      padding: 16px;
      max-width: 90%;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .status.hidden {
      display: none;
    }

    .status .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid var(--vscode-input-border, #333);
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
      position: fixed;
      bottom: 4px;
      right: 4px;
      background: var(--vscode-badge-background, rgba(0, 0, 0, 0.7));
      color: var(--vscode-badge-foreground, #888);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
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
    <canvas id="screen"></canvas>
    <div id="status" class="status">
      <div class="spinner"></div>
      <div id="status-text">Connecting to device...</div>
    </div>
    <div id="stats" class="stats hidden"></div>
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
