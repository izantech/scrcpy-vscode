import * as vscode from 'vscode';

export function getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.js')
  );

  const nonce = getNonce();

  // Localized strings
  const connectingToDevice = vscode.l10n.t('Connecting to device...');
  const addDevice = vscode.l10n.t('Add Device');
  const back = vscode.l10n.t('Back');
  const home = vscode.l10n.t('Home');
  const recentApps = vscode.l10n.t('Recent Apps');
  const takeScreenshot = vscode.l10n.t('Take screenshot');
  const power = vscode.l10n.t('Power');
  const startRecording = vscode.l10n.t('Start recording');
  const startIOSInput = vscode.l10n.t('Start iOS Input Control');
  const startWdaOverlay = vscode.l10n.t('Start WDA to enable touch input');
  const controlCenter = vscode.l10n.t('Control Center');

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
    screenshotPreview: vscode.l10n.t('Screenshot Preview'),
    save: vscode.l10n.t('Save'),
    copy: vscode.l10n.t('Copy'),
    startWdaOverlay,
    startIOSInput,
    toolWarningAdb: vscode.l10n.t('ADB is not installed or not in PATH'),
    toolWarningScrcpy: vscode.l10n.t('scrcpy is not installed or not in PATH'),
    toolWarningBoth: vscode.l10n.t('ADB and scrcpy are not installed'),
    install: vscode.l10n.t('Install'),
    settings: vscode.l10n.t('Settings'),
    missingDependency: vscode.l10n.t('Missing dependency'),
    controlCenter: vscode.l10n.t('Control Center'),
    darkMode: vscode.l10n.t('Dark Mode'),
    auto: vscode.l10n.t('Auto'),
    light: vscode.l10n.t('Light'),
    dark: vscode.l10n.t('Dark'),
    navigationMode: vscode.l10n.t('Navigation'),
    gestural: vscode.l10n.t('Gestures'),
    threeButton: vscode.l10n.t('3-Button'),
    twoButton: vscode.l10n.t('2-Button'),
    talkback: vscode.l10n.t('TalkBack'),
    fontSize: vscode.l10n.t('Font Size'),
    displaySize: vscode.l10n.t('Display Size'),
    showLayoutBounds: vscode.l10n.t('Layout Bounds'),
    appearance: vscode.l10n.t('Appearance'),
    accessibility: vscode.l10n.t('Accessibility'),
    developer: vscode.l10n.t('Developer'),
    small: vscode.l10n.t('Small'),
    default: vscode.l10n.t('Default'),
    large: vscode.l10n.t('Large'),
    largest: vscode.l10n.t('Largest'),
    display: vscode.l10n.t('Display'),
    orientation: vscode.l10n.t('Orientation'),
    portrait: vscode.l10n.t('Portrait'),
    landscape: vscode.l10n.t('Landscape'),
    autoRotate: vscode.l10n.t('Auto'),
    audioVolume: vscode.l10n.t('Audio & Volume'),
    audioForwarding: vscode.l10n.t('Audio Forwarding'),
    on: vscode.l10n.t('On'),
    off: vscode.l10n.t('Off'),
    volumeDown: vscode.l10n.t('Volume Down'),
    volumeUp: vscode.l10n.t('Volume Up'),
    systemShortcuts: vscode.l10n.t('System Shortcuts'),
    notificationPanel: vscode.l10n.t('Notification Panel'),
    settingsPanel: vscode.l10n.t('Settings Panel'),
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
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      cursor: help;
      border-radius: 50%;
      transition: background-color 0.2s;
    }

    .tab-status:hover {
      background-color: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    }

    .tab-status-icon {
      width: 14px;
      height: 14px;
      transition: color 0.2s;
    }

    /* Connection states - using tab accent color for better visibility */
    .tab-status-connecting .tab-status-icon {
      color: var(--vscode-tab-activeBorderTop, var(--vscode-focusBorder, #007fd4));
      animation: pulse 1.5s ease-in-out infinite;
    }

    .tab-status-connected .tab-status-icon {
      color: var(--vscode-tab-activeBorderTop, var(--vscode-focusBorder, #007fd4));
    }

    .tab-status-disconnected .tab-status-icon {
      color: var(--vscode-disabledForeground, #808080);
    }

    .tab-status-reconnecting .tab-status-icon {
      color: var(--vscode-editorWarning-foreground, #cca700);
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

    .tab-platform-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      opacity: 0.7;
      margin-right: 4px;
    }

    /* Dropdown menu (used for iOS overflow) */
    .dropdown {
      position: relative;
      display: inline-block;
    }

    .dropdown-btn {
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

    .dropdown-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }

    .dropdown-content {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 0;
      background: var(--vscode-menu-background, #252526);
      border: 1px solid var(--vscode-menu-border, #454545);
      border-radius: 4px;
      min-width: 140px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 100;
      padding: 4px 0;
      margin-bottom: 4px;
    }

    .dropdown-content.show {
      display: block;
    }

    .dropdown-content.align-right {
      left: auto;
      right: 0;
    }

    .dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      color: var(--vscode-menu-foreground, #ccc);
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
      background: transparent;
      border: none;
      width: 100%;
      text-align: left;
    }

    .dropdown-item:hover {
      background: var(--vscode-menu-selectionBackground, #094771);
      color: var(--vscode-menu-selectionForeground, #fff);
    }

    .dropdown-item svg {
      flex-shrink: 0;
      opacity: 0.8;
    }

    .dropdown-separator {
      height: 1px;
      background: var(--vscode-menu-separatorBackground, #454545);
      margin: 4px 0;
    }


    .tab-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      font-size: 18px;
      line-height: 1;
      padding-bottom: 2px;
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
      display: flex;
      align-items: center;
      margin: 2px 0;
    }

    .device-info-tooltip .info-row .info-icon {
      width: 20px;
      text-align: center;
      flex-shrink: 0;
    }

    .device-info-tooltip .info-row-header {
      margin-bottom: 4px;
    }

    .device-info-tooltip .info-row .tab-platform-icon {
      width: 14px;
      height: 14px;
      opacity: 0.85;
    }

    .device-info-tooltip .info-row-bottom {
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
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
      position: relative;
      z-index: 101;
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

    .control-btn.active {
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, white);
    }

    .control-toolbar.control-center-open .control-btn:not(.active) {
      opacity: 0.4;
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

    /* WDA overlay button */
    .wda-overlay {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: none;
      z-index: 6;
    }

    .wda-overlay.visible {
      display: flex;
    }

    .wda-overlay button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px 14px;
      border-radius: 999px;
      border: 1px solid var(--vscode-button-secondaryBackground, #3a3d41);
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ccc);
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      transition: background 0.1s;
    }

    .wda-overlay button:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }

    .wda-overlay button.loading {
      pointer-events: none;
      opacity: 0.7;
    }

    /* Info overlay - appears on top of video with semi-transparent background */
    .status.info-overlay {
      background: rgba(0, 0, 0, 0.75);
      border-color: var(--vscode-textLink-foreground, #3794ff);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .status .info-icon {
      color: var(--vscode-textLink-foreground, #3794ff);
      display: flex;
      align-items: center;
    }

    .status.warning {
      border-color: var(--vscode-inputValidation-warningBorder, #cf9300);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .status.warning .warning-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .status.warning .warning-icon {
      color: var(--vscode-inputValidation-warningBorder, #cf9300);
      display: flex;
      align-items: center;
    }

    .status.warning .warning-title {
      font-weight: 600;
      color: var(--vscode-foreground, #ccc);
    }

    .status.warning .warning-subtitle {
      color: var(--vscode-descriptionForeground, #969696);
      font-size: 12px;
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
      padding: 8px 16px;
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, white);
      border: none;
      border-radius: 9999px;
      cursor: pointer;
      font-size: 12px;
      font-family: var(--vscode-font-family);
    }

    .reconnect-btn:hover {
      background: var(--vscode-button-hoverBackground, #106ebe);
    }

    /* Screenshot preview overlay */
    .screenshot-preview-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
      backdrop-filter: blur(4px);
    }

    .screenshot-preview-overlay.visible {
      display: flex;
    }

    .screenshot-preview-container {
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      position: relative;
    }

    .screenshot-preview-header {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 24px;
    }

    .screenshot-preview-title {
      font-family: var(--vscode-font-family);
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-foreground, #ccc);
      line-height: 24px;
    }

    .screenshot-preview-close {
      position: absolute;
      right: 12px;
      top: 12px;
      background: transparent;
      border: none;
      color: var(--vscode-foreground, #ccc);
      cursor: pointer;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      opacity: 0.7;
      transition: opacity 0.1s, background 0.1s;
    }

    .screenshot-preview-close:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
    }

    .screenshot-preview-close svg {
      width: 16px;
      height: 16px;
    }

    .screenshot-preview-image {
      max-width: 85vw;
      max-height: 75vh;
      object-fit: contain;
      border-radius: 4px;
    }

    .screenshot-preview-actions {
      display: flex;
      gap: 8px;
      justify-content: center;
    }

    .screenshot-preview-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, white);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: var(--vscode-font-family);
      transition: background 0.1s;
    }

    .screenshot-preview-btn svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    .screenshot-preview-btn:hover {
      background: var(--vscode-button-hoverBackground, #106ebe);
    }

    .screenshot-preview-btn.secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ccc);
    }

    .screenshot-preview-btn.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }

    .reconnect-btn.primary {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
    }

    .reconnect-btn.primary:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }

    /* Control Center overlay */
    .control-center-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.4);
      display: none;
      align-items: flex-end;
      justify-content: flex-end;
      z-index: 100;
      padding: 12px;
      padding-bottom: 0;
      animation: overlayFadeIn 0.2s ease-out;
      cursor: pointer;
    }

    @keyframes overlayFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .control-center-overlay.visible {
      display: flex;
    }

    /* Floating sections container */
    .control-center-sections {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 50%;
      width: 75%;
      overflow: auto;
      cursor: default;
      scrollbar-width: none;
      -ms-overflow-style: none;
      padding: 16px 2px 52px 2px;
      /* Top fade only shown when scrolled (via .scrolled class) */
      mask-image: none;
      -webkit-mask-image: none;
    }

    .control-center-sections.scrolled {
      mask-image: linear-gradient(
        in oklch to bottom,
        oklch(0% 0 0 / 0) 0%,
        oklch(0% 0 0 / 0.4) 12px,
        oklch(0% 0 0 / 0.8) 20px,
        oklch(0% 0 0 / 1) 28px,
        oklch(0% 0 0 / 1) 100%
      );
      -webkit-mask-image: linear-gradient(
        in oklch to bottom,
        oklch(0% 0 0 / 0) 0%,
        oklch(0% 0 0 / 0.4) 12px,
        oklch(0% 0 0 / 0.8) 20px,
        oklch(0% 0 0 / 1) 28px,
        oklch(0% 0 0 / 1) 100%
      );
    }

    .control-center-sections::-webkit-scrollbar {
      display: none;
    }

    /* Floating opaque settings groups */
    .settings-group {
      background: #1e1e1e;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      overflow: hidden;
      flex-shrink: 0;
    }

    .settings-group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      font-family: var(--vscode-font-family);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #888);
      cursor: pointer;
      user-select: none;
      transition: color 0.15s ease;
    }

    .settings-group-header:hover {
      color: var(--vscode-foreground, #ccc);
    }

    .settings-group-header svg {
      width: 14px;
      height: 14px;
      opacity: 0.7;
    }

    .settings-group-header .chevron {
      margin-left: auto;
      width: 16px;
      height: 16px;
      opacity: 0.5;
      transition: transform 0.2s ease, opacity 0.15s ease;
    }

    .settings-group-header:hover .chevron {
      opacity: 0.8;
    }

    .settings-group.collapsed .settings-group-header .chevron {
      transform: rotate(-90deg);
    }

    .settings-group.collapsed .settings-group-content {
      display: none;
    }

    .settings-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      gap: 14px;
      min-width: 0;
      transition: background 0.1s ease;
    }

    .settings-row:not(:last-child) {
      border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.04));
    }

    .settings-row.clickable {
      cursor: pointer;
    }

    .settings-row.clickable:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .settings-row.clickable:active {
      background: rgba(255, 255, 255, 0.05);
    }

    .settings-row-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .settings-row-label {
      min-width: 60px;
      line-height: 1.3;
    }

    .settings-row-icon {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      flex-shrink: 0;
      background: var(--vscode-tab-activeBorderTop, #0078d4);
      color: var(--vscode-button-foreground, white);
      transition: transform 0.15s ease;
    }

    .settings-row.clickable:hover .settings-row-icon {
      transform: scale(1.05);
    }

    .settings-row-icon svg {
      width: 16px;
      height: 16px;
    }

    .settings-row-icon.icon-display {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .settings-row-icon.icon-nav {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }

    .settings-row-icon.icon-accessibility {
      background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
    }

    .settings-row-icon.icon-text {
      background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
    }

    .settings-row-icon.icon-size {
      background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
    }

    .settings-row-icon.icon-debug {
      background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
      color: #333;
    }

    .settings-row-label {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-foreground, #e0e0e0);
      flex-shrink: 1;
      min-width: 0;
      user-select: none;
    }

    .settings-row-control {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      flex-shrink: 0;
    }

    /* Toggle switch */
    .toggle-switch {
      position: relative;
      width: 44px;
      height: 26px;
      background: rgba(255, 255, 255, 0.18);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 13px;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      flex-shrink: 0;
    }

    .toggle-switch.loading,
    .toggle-switch.disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .toggle-switch::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 3px;
      width: 20px;
      height: 20px;
      background: linear-gradient(180deg, #fff 0%, #f0f0f0 100%);
      border-radius: 50%;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.15);
    }

    .toggle-switch:hover::after {
      transform: scale(1.05);
    }

    .toggle-switch:active::after {
      width: 24px;
    }

    .toggle-switch.active {
      background: var(--vscode-tab-activeBorderTop, #0078d4);
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .toggle-switch.active::after {
      transform: translateX(18px);
    }

    .toggle-switch.active:active::after {
      transform: translateX(14px);
      width: 24px;
    }

    /* Cycle button */
    .cycle-button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px 14px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      color: var(--vscode-foreground, #e0e0e0);
      font-family: var(--vscode-font-family);
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
      width: 110px;
      min-height: 36px;
      flex-shrink: 0;
    }

    .cycle-button:hover:not(.disabled) {
      background: rgba(255, 255, 255, 0.18);
      border-color: rgba(255, 255, 255, 0.25);
    }

    .cycle-button:active:not(.disabled) {
      transform: scale(0.98);
    }

    .cycle-button.disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .cycle-button-icon {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .cycle-button-icon svg {
      width: 16px;
      height: 16px;
    }

    .cycle-button-label {
      text-align: center;
    }

    /* Slider with value */
    .slider-control {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      max-width: 160px;
    }

    .slider-control.loading,
    .slider-control.disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .settings-slider {
      flex: 1;
      min-width: 70px;
      height: 6px;
      -webkit-appearance: none;
      appearance: none;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 3px;
      outline: none;
      cursor: pointer;
    }

    .settings-slider::-webkit-slider-runnable-track {
      height: 6px;
      background: transparent;
      border-radius: 3px;
    }

    .settings-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 18px;
      height: 18px;
      margin-top: -6px;
      background: linear-gradient(180deg, #fff 0%, #f0f0f0 100%);
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.15);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .settings-slider::-webkit-slider-thumb:hover {
      transform: scale(1.1);
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .settings-slider::-webkit-slider-thumb:active {
      transform: scale(0.95);
    }

    .settings-slider::-moz-range-track {
      height: 6px;
      background: transparent;
      border-radius: 3px;
    }

    .settings-slider::-moz-range-thumb {
      width: 18px;
      height: 18px;
      background: linear-gradient(180deg, #fff 0%, #f0f0f0 100%);
      border: none;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    }

    .slider-value {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      font-weight: 500;
      color: var(--vscode-foreground, #ccc);
      min-width: 52px;
      flex-shrink: 0;
      text-align: right;
      background: rgba(255, 255, 255, 0.1);
      padding: 4px 8px;
      border-radius: 4px;
    }

    /* Action button for Control Center */
    .settings-action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 14px;
      background: rgba(255, 255, 255, 0.12);
      color: var(--vscode-foreground, #e0e0e0);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s ease;
      flex: 1;
      min-height: 36px;
    }

    .settings-action-btn:hover {
      background: rgba(255, 255, 255, 0.18);
    }

    .settings-action-btn:active {
      transform: scale(0.98);
    }

    .settings-action-btn svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    .settings-action-btn.loading {
      opacity: 0.6;
      pointer-events: none;
    }

    /* Button row for action buttons */
    .settings-button-row {
      display: flex;
      gap: 8px;
      padding: 10px 14px;
    }

    .settings-button-row:not(:last-child) {
      border-bottom: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.04));
    }

    /* Icon styles for new groups */
    .settings-row-icon.icon-orientation {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .settings-row-icon.icon-audio {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }

    .settings-row-icon.icon-volume {
      background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
    }

    .settings-row-icon.icon-system {
      background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
      color: #333;
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
      <!-- WDA overlay -->
      <div id="wda-overlay" class="wda-overlay">
        <button id="wda-overlay-btn">${startWdaOverlay}</button>
      </div>
      <!-- Stats display -->
      <div id="stats" class="stats hidden"></div>
      <!-- Recording indicator -->
      <div id="recording-indicator" class="recording-indicator hidden">
        <div class="recording-dot"></div>
        <span id="recording-time">00:00</span>
      </div>
      <!-- Screenshot preview overlay -->
      <div id="screenshot-preview-overlay" class="screenshot-preview-overlay">
        <div class="screenshot-preview-container">
          <button id="screenshot-close-btn" class="screenshot-preview-close">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>
          </button>
          <div class="screenshot-preview-header">
            <span class="screenshot-preview-title" id="screenshot-preview-title"></span>
          </div>
          <img id="screenshot-preview-image" class="screenshot-preview-image" alt="Screenshot">
          <div class="screenshot-preview-actions">
            <button id="screenshot-save-btn" class="screenshot-preview-btn">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/></svg>
              <span id="screenshot-save-text"></span>
            </button>
            <button id="screenshot-copy-btn" class="screenshot-preview-btn">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"/></svg>
              <span id="screenshot-copy-text"></span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Control toolbar - fixed at bottom -->
    <div id="control-toolbar" class="control-toolbar hidden">
      <div class="toolbar-group toolbar-left">
        <button class="control-btn" data-keycode="26" title="${power}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.56,5.44L15.11,6.89C16.84,7.94 18,9.83 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12C6,9.83 7.16,7.94 8.88,6.88L7.44,5.44C5.36,6.88 4,9.28 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12C20,9.28 18.64,6.88 16.56,5.44M13,3H11V13H13"/></svg></button>
        <button class="control-btn" id="record-btn" title="${startRecording}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18,16L14,12.8V16H6V8H14V11.2L18,8M20,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V6C22,4.89 21.1,4 20,4Z"/></svg></button>
        <button class="control-btn" id="screenshot-btn" title="${takeScreenshot}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
      </div>
      <div class="toolbar-group toolbar-center">
        <button class="control-btn" data-keycode="4" title="${back}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20,4 L20,20 L4,12 Z"/></svg></button>
        <button class="control-btn" data-keycode="3" title="${home}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg></button>
        <button class="control-btn" data-keycode="187" title="${recentApps}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14"/></svg></button>
      </div>
      <div class="toolbar-group toolbar-right">
        <button class="control-btn" id="control-center-btn" title="${controlCenter}"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9.82,12.5C9.84,12.33 9.86,12.17 9.86,12C9.86,11.83 9.84,11.67 9.82,11.5L10.9,10.69C11,10.62 11,10.5 10.96,10.37L9.93,8.64C9.87,8.53 9.73,8.5 9.62,8.53L8.34,9.03C8.07,8.83 7.78,8.67 7.47,8.54L7.27,7.21C7.27,7.09 7.16,7 7.03,7H5C4.85,7 4.74,7.09 4.72,7.21L4.5,8.53C4.21,8.65 3.92,8.83 3.65,9L2.37,8.5C2.25,8.47 2.12,8.5 2.06,8.63L1.03,10.36C0.97,10.5 1,10.61 1.1,10.69L2.18,11.5C2.16,11.67 2.15,11.84 2.15,12C2.15,12.17 2.17,12.33 2.19,12.5L1.1,13.32C1,13.39 0.96,13.5 1.03,13.64L2.06,15.37C2.12,15.5 2.25,15.5 2.37,15.5L3.65,15C3.92,15.18 4.21,15.34 4.5,15.47L4.72,16.79C4.74,16.91 4.85,17 5,17H7.03C7.16,17 7.27,16.91 7.29,16.79L7.5,15.47C7.8,15.35 8.07,15.18 8.35,15L9.62,15.5C9.73,15.5 9.87,15.5 9.93,15.37L10.96,13.64C11,13.5 11,13.39 10.9,13.32L9.82,12.5M6,13.75A1.75,1.75 0 0,1 4.25,12A1.75,1.75 0 0,1 6,10.25A1.75,1.75 0 0,1 7.75,12A1.75,1.75 0 0,1 6,13.75M17,1H7A2,2 0 0,0 5,3V6H7V4H17V20H7V18H5V21A2,2 0 0,0 7,23H17A2,2 0 0,0 19,21V3A2,2 0 0,0 17,1Z"/></svg></button>
      </div>
    </div>
  </div>

  <!-- Control Center Overlay -->
  <div id="control-center-overlay" class="control-center-overlay">
    <div class="control-center-sections" id="control-center-content">
      <!-- Floating settings sections populated dynamically -->
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
