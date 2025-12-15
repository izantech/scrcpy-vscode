import * as vscode from 'vscode';

export function getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.js')
  );

  const nonce = getNonce();

  // Localized strings
  const connectingToDevice = vscode.l10n.t('Connecting to device...');
  const addDevice = vscode.l10n.t('Add Device');
  const disableAudio = vscode.l10n.t('Disable audio forwarding');
  const volumeDown = vscode.l10n.t('Volume Down');
  const volumeUp = vscode.l10n.t('Volume Up');
  const back = vscode.l10n.t('Back');
  const home = vscode.l10n.t('Home');
  const recentApps = vscode.l10n.t('Recent Apps');
  const takeScreenshot = vscode.l10n.t('Take screenshot');
  const changeToLandscape = vscode.l10n.t('Change to landscape');
  const power = vscode.l10n.t('Power');
  const startRecording = vscode.l10n.t('Start recording');
  const openNotificationPanel = vscode.l10n.t('Open notification panel');
  const openSettingsPanel = vscode.l10n.t('Open settings panel');

  // Bundle of strings for dynamic updates in main.ts
  const l10n = {
    changeToPortrait: vscode.l10n.t('Change to portrait'),
    changeToLandscape: vscode.l10n.t('Change to landscape'),
    enableAudio: vscode.l10n.t('Enable audio forwarding'),
    disableAudio: vscode.l10n.t('Disable audio forwarding'),
    reconnecting: vscode.l10n.t('Reconnecting...'),
    reconnect: vscode.l10n.t('Reconnect'),
    noDevicesConnected: vscode.l10n.t('No devices connected'),
    addDevice: vscode.l10n.t('Add Device'),
    statsFormat: vscode.l10n.t('{0} FPS | {1} frames'),
    extendedStatsFormat: vscode.l10n.t('FPS: {0} | Bitrate: {1} | Dropped: {2}'),
    startRecording: vscode.l10n.t('Start recording'),
    stopRecording: vscode.l10n.t('Stop recording'),
    recording: vscode.l10n.t('Recording'),
  };

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
      gap: 0;
      padding: 0;
      background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
      height: 35px;
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
      gap: 6px;
      padding: 0 10px;
      height: 100%;
      background: var(--vscode-tab-inactiveBackground, #2d2d2d);
      color: var(--vscode-tab-inactiveForeground, #969696);
      border-right: 1px solid var(--vscode-tab-border, #252526);
      border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder, transparent);
      cursor: pointer;
      white-space: nowrap;
      min-width: 120px;
      max-width: 200px;
      user-select: none;
      position: relative;
    }

    .tab-status {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 12px;
      height: 12px;
      flex-shrink: 0;
    }

    .tab-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      transition: background-color 0.2s;
    }

    /* Connection states */
    .tab-status-connecting .tab-status-dot {
      background-color: #0078d4;
      animation: pulse 1.5s ease-in-out infinite;
    }

    .tab-status-connected .tab-status-dot {
      background-color: #4ec9b0;
    }

    .tab-status-disconnected .tab-status-dot {
      background-color: #808080;
    }

    .tab-status-reconnecting .tab-status-dot {
      background-color: #ce9178;
      animation: pulse 1.5s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.5;
        transform: scale(0.8);
      }
    }

    .tab.active {
      background: var(--vscode-tab-activeBackground, #1e1e1e);
      color: var(--vscode-tab-activeForeground, #ffffff);
      border-top: 1px solid var(--vscode-tab-activeBorderTop, #0078d4);
      border-bottom: 1px solid var(--vscode-tab-activeBackground, #1e1e1e);
    }

    .tab:hover:not(.active) {
      background: var(--vscode-tab-hoverBackground, #2d2d2d);
      color: var(--vscode-tab-hoverForeground, #ffffff);
    }

    .tab-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 13px;
    }

    .tab-icon {
      flex-shrink: 0;
      opacity: 0.7;
    }

    .tab-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      font-size: 16px;
      opacity: 0; /* Hidden by default until hover or active */
      color: inherit;
    }

    .tab:hover .tab-close,
    .tab.active .tab-close {
      opacity: 1;
    }

    .tab-close:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    }

    /* Device info tooltip */
    .device-info-tooltip {
      position: absolute;
      top: 40px;
      left: 0;
      background: var(--vscode-editorHoverWidget-background, #252526);
      color: var(--vscode-editorHoverWidget-foreground, #ccc);
      border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 12px;
      font-family: var(--vscode-font-family);
      line-height: 1.5;
      white-space: pre-line;
      z-index: 1000;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      min-width: 200px;
      display: none;
    }

    .device-info-tooltip.visible {
      display: block;
    }

    .device-info-tooltip .info-row {
      margin: 2px 0;
    }

    .device-info-tooltip .info-label {
      color: var(--vscode-descriptionForeground, #999);
      font-weight: 500;
    }

    .device-info-loading {
      font-style: italic;
      color: var(--vscode-descriptionForeground, #999);
    }

    .tab-add {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      margin-left: 5px;
      background: transparent;
      color: var(--vscode-foreground, #ccc);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 18px;
      flex-shrink: 0;
      opacity: 0.7;
    }

    .tab-add:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
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
      white-space: nowrap;
    }

    .stats.hidden {
      display: none;
    }

    .stats.extended {
      font-size: 9px;
      padding: 3px 7px;
    }

    /* Recording indicator */
    .recording-indicator {
      position: absolute;
      top: 8px;
      left: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 4px;
      z-index: 5;
    }

    .recording-indicator.hidden {
      display: none;
    }

    .recording-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f00;
      animation: recording-pulse 1.5s ease-in-out infinite;
    }

    @keyframes recording-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .control-btn.recording {
      background: #c00 !important;
      color: white !important;
      border-color: #c00 !important;
    }

    .control-btn.recording:hover {
      background: #d00 !important;
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
      <button class="tab-add" id="add-device-btn" title="${addDevice}">+</button>
      <!-- Device info tooltip -->
      <div id="device-info-tooltip" class="device-info-tooltip"></div>
    </div>

    <!-- Canvas container - centered -->
    <div id="canvas-container" class="canvas-container">
      <!-- Status overlay -->
      <div id="status" class="status">
        <div class="spinner"></div>
        <div id="status-text">${connectingToDevice}</div>
      </div>
      <!-- Stats display -->
      <div id="stats" class="stats hidden"></div>
      <!-- Recording indicator -->
      <div id="recording-indicator" class="recording-indicator hidden">
        <div class="recording-dot"></div>
        <span id="recording-time">00:00</span>
      </div>
    </div>

    <!-- Control toolbar - fixed at bottom -->
    <div id="control-toolbar" class="control-toolbar hidden">
      <div class="toolbar-group toolbar-left">
        <button class="control-btn" id="mute-btn" title="${disableAudio}">&#x1F50A;</button>
        <button class="control-btn" data-keycode="25" title="${volumeDown}">Vol-</button>
        <button class="control-btn" data-keycode="24" title="${volumeUp}">Vol+</button>
      </div>
      <div class="toolbar-group toolbar-center">
        <button class="control-btn" data-keycode="4" title="${back}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20,4 L20,20 L4,12 Z"/></svg></button>
        <button class="control-btn" data-keycode="3" title="${home}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg></button>
        <button class="control-btn" data-keycode="187" title="${recentApps}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14"/></svg></button>
        <button class="control-btn" id="notification-panel-btn" title="${openNotificationPanel}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12,22 C13.1,22 14,21.1 14,20 L10,20 C10,21.1 10.9,22 12,22 M18,16 L18,11 C18,7.93 16.37,5.36 13.5,4.68 L13.5,4 C13.5,3.17 12.83,2.5 12,2.5 C11.17,2.5 10.5,3.17 10.5,4 L10.5,4.68 C7.64,5.36 6,7.92 6,11 L6,16 L4,18 L4,19 L20,19 L20,18 L18,16 Z"/></svg></button>
        <button class="control-btn" id="settings-panel-btn" title="${openSettingsPanel}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg></button>
      </div>
      <div class="toolbar-group toolbar-right">
        <button class="control-btn" id="record-btn" title="${startRecording}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg></button>
        <button class="control-btn" id="screenshot-btn" title="${takeScreenshot}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
        <button class="control-btn" id="rotate-btn" title="${changeToLandscape}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9,1H3A2,2 0 0,0 1,3V16A2,2 0 0,0 3,18H9A2,2 0 0,0 11,16V3A2,2 0 0,0 9,1M9,15H3V3H9V15M21,13H13V15H21V21H9V20H6V21A2,2 0 0,0 8,23H21A2,2 0 0,0 23,21V15A2,2 0 0,0 21,13M23,10L19,8L20.91,7.09C19.74,4.31 17,2.5 14,2.5V1A9,9 0 0,1 23,10Z"/></svg></button>
        <button class="control-btn" data-keycode="26" title="${power}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.56,5.44L15.11,6.89C16.84,7.94 18,9.83 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12C6,9.83 7.16,7.94 8.88,6.88L7.44,5.44C5.36,6.88 4,9.28 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12C20,9.28 18.64,6.88 16.56,5.44M13,3H11V13H13"/></svg></button>
      </div>
    </div>
  </div>
  <script nonce="${nonce}">
    window.l10n = ${JSON.stringify(l10n)};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
