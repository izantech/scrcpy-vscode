import { VideoRenderer, ExtendedStats } from './VideoRenderer';
import { AudioRenderer } from './AudioRenderer';
import { InputHandler } from './InputHandler';
import { KeyboardHandler } from './KeyboardHandler';
import { RecordingManager } from './RecordingManager';

// VS Code API interface
interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

// Declare global l10n object
declare global {
  interface Window {
    l10n: {
      changeToPortrait: string;
      changeToLandscape: string;
      enableAudio: string;
      disableAudio: string;
      reconnecting: string;
      reconnect: string;
      noDevicesConnected: string;
      addDevice: string;
      statsFormat: string;
      extendedStatsFormat: string;
      startRecording: string;
      stopRecording: string;
      recording: string;
      screenshotPreview: string;
      save: string;
      copy: string;
      toolWarningAdb: string;
      toolWarningScrcpy: string;
      toolWarningBoth: string;
      install: string;
      settings: string;
      missingDependency: string;
      deviceSettings: string;
      darkMode: string;
      auto: string;
      light: string;
      dark: string;
      navigationMode: string;
      gestural: string;
      threeButton: string;
      twoButton: string;
      talkback: string;
      selectToSpeak: string;
      fontSize: string;
      displaySize: string;
      showLayoutBounds: string;
      loadingSettings: string;
      small: string;
      default: string;
      large: string;
      largest: string;
    };
  }
}

/**
 * Device UI settings from extension
 */
interface DeviceUISettings {
  darkMode: 'auto' | 'light' | 'dark';
  navigationMode: 'gestural' | 'threebutton' | 'twobutton';
  availableNavigationModes: ('gestural' | 'threebutton' | 'twobutton')[];
  talkbackEnabled: boolean;
  selectToSpeakEnabled: boolean;
  fontScale: number;
  displayDensity: number;
  defaultDensity: number;
  showLayoutBounds: boolean;
}

// Tool status tracking (derived from state snapshot)
let toolsAvailable = true;
let adbMissing = false;
let scrcpyMissing = false;

/**
 * Connection state for a device
 */
type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/**
 * Device state from extension (matches AppStateSnapshot)
 */
interface DeviceState {
  deviceId: string;
  serial: string;
  name: string;
  model?: string;
  connectionState: ConnectionState;
  isActive: boolean;
  videoDimensions?: {
    width: number;
    height: number;
  };
  videoCodec?: 'h264' | 'h265' | 'av1';
}

/**
 * Status message from extension
 */
interface StatusMessage {
  type: 'loading' | 'error' | 'empty';
  text: string;
  deviceId?: string;
}

/**
 * Complete state snapshot from extension (single source of truth)
 */
interface AppStateSnapshot {
  devices: DeviceState[];
  activeDeviceId: string | null;
  settings: {
    showStats: boolean;
    showExtendedStats: boolean;
    audioEnabled: boolean;
  };
  toolStatus: {
    adbAvailable: boolean;
    scrcpyAvailable: boolean;
  };
  statusMessage?: StatusMessage;
  deviceInfo: Record<string, DeviceDetailedInfo>;
}

/**
 * Device session UI representation
 */
interface DeviceSessionUI {
  deviceId: string;
  deviceInfo: { serial: string; name: string };
  canvas: HTMLCanvasElement;
  videoRenderer: VideoRenderer;
  audioRenderer: AudioRenderer;
  inputHandler: InputHandler;
  keyboardHandler: KeyboardHandler;
  recordingManager: RecordingManager;
  tabElement: HTMLElement;
  connectionState: ConnectionState;
}

/**
 * Detailed device information from extension
 */
interface DeviceDetailedInfo {
  model: string;
  manufacturer: string;
  androidVersion: string;
  sdkVersion: number;
  batteryLevel: number;
  batteryCharging: boolean;
  storageTotal: number;
  storageUsed: number;
  screenResolution: string;
  ipAddress?: string;
}

// Global state
let vscode: VSCodeAPI;
let canvasContainer: HTMLElement;
let tabBar: HTMLElement;
let statusElement: HTMLElement;
let statusTextElement: HTMLElement;
let statsElement: HTMLElement;
let controlToolbar: HTMLElement;
let addDeviceBtn: HTMLElement;
let screenshotPreviewOverlay: HTMLElement;
let screenshotPreviewTitle: HTMLElement;
let screenshotPreviewImage: HTMLImageElement;
let screenshotSaveBtn: HTMLElement;
let screenshotCopyBtn: HTMLElement;
let screenshotCloseBtn: HTMLElement;

// Device sessions
const sessions = new Map<string, DeviceSessionUI>();
let activeDeviceId: string | null = null;
let showStats = false;
let showExtendedStats = false;
let isMuted = false;
let muteBtn: HTMLElement | null = null;
let muteBtnText: HTMLElement | null = null;
let leftDropdownContent: HTMLElement | null = null;
let rotateBtn: HTMLElement | null = null;
let screenshotBtn: HTMLElement | null = null;
let recordBtn: HTMLElement | null = null;
let recordingIndicator: HTMLElement | null = null;
let recordingTime: HTMLElement | null = null;
let isPortrait = true;
let currentScreenshotData: string | null = null;

// Device settings popup
let deviceSettingsOverlay: HTMLElement | null = null;
let deviceSettingsContent: HTMLElement | null = null;
let deviceSettingsBtn: HTMLElement | null = null;
let currentDeviceSettings: DeviceUISettings | null = null;
const pendingSettingChanges = new Set<string>();
const deviceSettingsCache = new Map<string, DeviceUISettings>();

// Device info tooltip
let deviceInfoTooltip: HTMLElement | null = null;
const deviceInfoCache = new Map<string, DeviceDetailedInfo>();
let tooltipHideTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize the WebView
 */
function initialize() {
  vscode = acquireVsCodeApi();

  // Get DOM elements
  canvasContainer = document.getElementById('canvas-container') as HTMLElement;
  tabBar = document.getElementById('tab-bar') as HTMLElement;
  statusElement = document.getElementById('status') as HTMLElement;
  statusTextElement = document.getElementById('status-text') as HTMLElement;
  statsElement = document.getElementById('stats') as HTMLElement;
  controlToolbar = document.getElementById('control-toolbar') as HTMLElement;
  addDeviceBtn = document.getElementById('add-device-btn') as HTMLElement;
  deviceInfoTooltip = document.getElementById('device-info-tooltip') as HTMLElement;
  screenshotPreviewOverlay = document.getElementById('screenshot-preview-overlay') as HTMLElement;
  screenshotPreviewTitle = document.getElementById('screenshot-preview-title') as HTMLElement;
  screenshotPreviewImage = document.getElementById('screenshot-preview-image') as HTMLImageElement;
  screenshotSaveBtn = document.getElementById('screenshot-save-btn') as HTMLElement;
  screenshotCopyBtn = document.getElementById('screenshot-copy-btn') as HTMLElement;
  screenshotCloseBtn = document.getElementById('screenshot-close-btn') as HTMLElement;

  if (!canvasContainer || !tabBar || !statusElement || !statusTextElement) {
    console.error('Required DOM elements not found');
    return;
  }

  // Set up control toolbar with long-press support
  if (controlToolbar) {
    const buttons = controlToolbar.querySelectorAll('.control-btn');

    // Volume buttons (keycodes 24=VOL_UP, 25=VOL_DOWN) use repeat-while-held
    const volumeKeycodes = [24, 25];
    const repeatDelay = 400; // Initial delay before repeat starts (ms)
    const repeatInterval = 100; // Interval between repeats (ms)

    buttons.forEach((button) => {
      const keycode = parseInt((button as HTMLElement).dataset.keycode || '0', 10);
      if (!keycode) {
        return;
      }

      const isVolumeButton = volumeKeycodes.includes(keycode);
      let repeatTimeout: ReturnType<typeof setTimeout> | null = null;
      let repeatIntervalId: ReturnType<typeof setInterval> | null = null;

      const stopRepeat = () => {
        if (repeatTimeout) {
          clearTimeout(repeatTimeout);
          repeatTimeout = null;
        }
        if (repeatIntervalId) {
          clearInterval(repeatIntervalId);
          repeatIntervalId = null;
        }
      };

      // Send key down on pointer press
      button.addEventListener('pointerdown', (e) => {
        const event = e as PointerEvent;
        vscode.postMessage({ type: 'keyDown', keycode });
        try {
          (button as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
          // Ignore errors from setting capture
        }

        // Start repeat for volume buttons
        if (isVolumeButton) {
          repeatTimeout = setTimeout(() => {
            repeatIntervalId = setInterval(() => {
              vscode.postMessage({ type: 'keyDown', keycode });
            }, repeatInterval);
          }, repeatDelay);
        }
      });

      // Send key up on pointer release
      button.addEventListener('pointerup', (e) => {
        const event = e as PointerEvent;
        stopRepeat();
        vscode.postMessage({ type: 'keyUp', keycode });
        try {
          (button as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {
          // Ignore errors from releasing capture
        }
      });

      // Handle pointer cancel (e.g., touch interrupted)
      button.addEventListener('pointercancel', (e) => {
        const event = e as PointerEvent;
        stopRepeat();
        vscode.postMessage({ type: 'keyUp', keycode });
        try {
          (button as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {
          // Ignore errors from releasing capture
        }
      });
    });
  }

  // Add device button
  if (addDeviceBtn) {
    addDeviceBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'showDevicePicker' });
    });
  }

  // Left dropdown setup
  leftDropdownContent = document.getElementById('left-dropdown-content');
  const leftDropdownBtn = document.getElementById('left-dropdown-btn');

  if (leftDropdownBtn && leftDropdownContent) {
    leftDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      leftDropdownContent!.classList.toggle('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      if (leftDropdownContent) {
        leftDropdownContent.classList.remove('show');
      }
    });

    // Prevent dropdown closing when clicking inside
    leftDropdownContent.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  // Mute button (now inside dropdown)
  muteBtn = document.getElementById('mute-btn');
  muteBtnText = document.getElementById('mute-btn-text');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      toggleMute();
      // Close dropdown after action
      if (leftDropdownContent) {
        leftDropdownContent.classList.remove('show');
      }
    });
  }

  // Volume buttons inside dropdown
  if (leftDropdownContent) {
    const volumeButtons = leftDropdownContent.querySelectorAll('.dropdown-item[data-keycode]');
    volumeButtons.forEach((button) => {
      const keycode = parseInt((button as HTMLElement).dataset.keycode || '0', 10);
      if (!keycode) {
        return;
      }

      button.addEventListener('click', () => {
        vscode.postMessage({ type: 'keyDown', keycode });
        setTimeout(() => {
          vscode.postMessage({ type: 'keyUp', keycode });
        }, 50);
        // Close dropdown after action
        if (leftDropdownContent) {
          leftDropdownContent.classList.remove('show');
        }
      });
    });
  }

  // Rotate button
  rotateBtn = document.getElementById('rotate-btn');
  if (rotateBtn) {
    rotateBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'rotateDevice' });
    });
  }

  // Screenshot button
  screenshotBtn = document.getElementById('screenshot-btn');
  if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
      takeScreenshot();
    });
  }

  // Record button
  recordBtn = document.getElementById('record-btn');
  if (recordBtn) {
    recordBtn.addEventListener('click', () => {
      toggleRecording();
    });
  }

  // Recording indicator elements
  recordingIndicator = document.getElementById('recording-indicator');
  recordingTime = document.getElementById('recording-time');

  // Notification panel button (now inside dropdown)
  const notificationPanelBtn = document.getElementById('notification-panel-btn');
  if (notificationPanelBtn) {
    notificationPanelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'expandNotificationPanel' });
      // Close dropdown after action
      if (leftDropdownContent) {
        leftDropdownContent.classList.remove('show');
      }
    });
  }

  // Settings panel button (now inside dropdown)
  const settingsPanelBtn = document.getElementById('settings-panel-btn');
  if (settingsPanelBtn) {
    settingsPanelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'expandSettingsPanel' });
      // Close dropdown after action
      if (leftDropdownContent) {
        leftDropdownContent.classList.remove('show');
      }
    });
  }

  // Screenshot preview buttons
  if (screenshotPreviewTitle) {
    screenshotPreviewTitle.textContent = window.l10n.screenshotPreview;
  }
  if (screenshotSaveBtn) {
    const saveText = document.getElementById('screenshot-save-text');
    if (saveText) {
      saveText.textContent = window.l10n.save;
    }
    screenshotSaveBtn.addEventListener('click', () => {
      saveScreenshot();
    });
  }
  if (screenshotCopyBtn) {
    const copyText = document.getElementById('screenshot-copy-text');
    if (copyText) {
      copyText.textContent = window.l10n.copy;
    }
    screenshotCopyBtn.addEventListener('click', () => {
      copyScreenshotToClipboard();
    });
  }
  if (screenshotCloseBtn) {
    screenshotCloseBtn.addEventListener('click', () => {
      dismissScreenshotPreview();
    });
  }

  // Close preview when clicking outside the container
  if (screenshotPreviewOverlay) {
    screenshotPreviewOverlay.addEventListener('click', (e) => {
      if (e.target === screenshotPreviewOverlay) {
        dismissScreenshotPreview();
      }
    });
  }

  // Device settings popup setup
  deviceSettingsOverlay = document.getElementById('device-settings-overlay');
  deviceSettingsContent = document.getElementById('device-settings-content');
  deviceSettingsBtn = document.getElementById('device-settings-btn');

  const deviceSettingsTitle = document.getElementById('device-settings-title');
  if (deviceSettingsTitle) {
    deviceSettingsTitle.textContent = window.l10n.deviceSettings;
  }

  if (deviceSettingsBtn) {
    deviceSettingsBtn.addEventListener('click', () => {
      openDeviceSettings();
    });
  }

  const deviceSettingsClose = document.getElementById('device-settings-close');
  if (deviceSettingsClose) {
    deviceSettingsClose.addEventListener('click', () => {
      closeDeviceSettings();
    });
  }

  // Close device settings when clicking outside
  if (deviceSettingsOverlay) {
    deviceSettingsOverlay.addEventListener('click', (e) => {
      if (e.target === deviceSettingsOverlay) {
        closeDeviceSettings();
      }
    });
  }

  // Add keyboard shortcuts for tab switching (Alt+1 to Alt+9)
  document.addEventListener('keydown', (e) => {
    // Alt+1 through Alt+9 (and Alt+0 for 10th tab)
    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
      const key = e.key;
      if (key >= '1' && key <= '9') {
        e.preventDefault();
        e.stopPropagation();
        const tabIndex = parseInt(key, 10) - 1; // Convert to 0-indexed
        switchToTabByIndex(tabIndex);
      } else if (key === '0') {
        e.preventDefault();
        e.stopPropagation();
        // Alt+0 switches to 10th tab or last tab
        const tabCount = sessions.size;
        if (tabCount > 0) {
          switchToTabByIndex(Math.min(9, tabCount - 1));
        }
      }
    }
  });

  vscode.postMessage({ type: 'ready' });
  console.log('WebView initialized');
}

/**
 * Format bitrate for display (converts bits/second to Kbps or Mbps)
 */
function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond === 0) {
    return '0 Kbps';
  }

  const kbps = bitsPerSecond / 1000;
  if (kbps < 1000) {
    return `${kbps.toFixed(0)} Kbps`;
  }

  const mbps = kbps / 1000;
  return `${mbps.toFixed(1)} Mbps`;
}

/**
 * Update rotate button icon based on current orientation
 */
function updateRotateButton(width: number, height: number): void {
  if (!rotateBtn) {
    return;
  }

  isPortrait = height > width;

  if (isPortrait) {
    // Show landscape icon (rotate to landscape)
    rotateBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9,1H3A2,2 0 0,0 1,3V16A2,2 0 0,0 3,18H9A2,2 0 0,0 11,16V3A2,2 0 0,0 9,1M9,15H3V3H9V15M21,13H13V15H21V21H9V20H6V21A2,2 0 0,0 8,23H21A2,2 0 0,0 23,21V15A2,2 0 0,0 21,13M23,10L19,8L20.91,7.09C19.74,4.31 17,2.5 14,2.5V1A9,9 0 0,1 23,10Z"/></svg>`;
    rotateBtn.title = window.l10n.changeToLandscape;
  } else {
    // Show portrait icon (rotate to portrait)
    rotateBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9,1H3A2,2 0 0,0 1,3V16A2,2 0 0,0 3,18H4V15H3V3H9V11H11V3A2,2 0 0,0 9,1M23,21V15A2,2 0 0,0 21,13H8A2,2 0 0,0 6,15V21A2,2 0 0,0 8,23H21A2,2 0 0,0 23,21M9,21V15H21V21H9M23,10H21.5C21.5,7 19.69,4.27 16.92,3.09L16,5L14,1A9,9 0 0,1 23,10Z"/></svg>`;
    rotateBtn.title = window.l10n.changeToPortrait;
  }
}

/**
 * Toggle audio forwarding setting
 */
function toggleMute(): void {
  vscode.postMessage({ type: 'toggleAudio' });
}

/**
 * Take a screenshot of the active device (via ADB screencap for original resolution)
 */
function takeScreenshot(): void {
  if (!activeDeviceId || !screenshotBtn) {
    return;
  }

  // Show loading state on button
  screenshotBtn.classList.add('loading');
  screenshotBtn.innerHTML = '<span class="btn-spinner"></span>';

  // Send request to extension - screenshot is taken via ADB for original quality
  vscode.postMessage({ type: 'screenshot' });
}

/**
 * Reset screenshot button to normal state
 */
function resetScreenshotButton(): void {
  if (!screenshotBtn) {
    return;
  }

  screenshotBtn.classList.remove('loading');
  screenshotBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
}

/**
 * Toggle screen recording
 */
function toggleRecording(): void {
  if (!activeDeviceId) {
    return;
  }

  const session = sessions.get(activeDeviceId);
  if (!session) {
    return;
  }

  // Get recording format from settings (will be sent from extension)
  vscode.postMessage({ type: 'getRecordingSettings' });
}

/**
 * Start recording with settings from extension
 */
function startRecordingWithSettings(format: 'webm' | 'mp4'): void {
  if (!activeDeviceId) {
    return;
  }

  const session = sessions.get(activeDeviceId);
  if (!session) {
    return;
  }

  const success = session.recordingManager.startRecording(format);
  if (success) {
    updateRecordingUI(true, 0);
  }
}

/**
 * Stop recording
 */
function stopRecording(): void {
  if (!activeDeviceId) {
    return;
  }

  const session = sessions.get(activeDeviceId);
  if (!session) {
    return;
  }

  session.recordingManager.stopRecording();
  updateRecordingUI(false, 0);
}

/**
 * Update recording UI (button and indicator)
 */
function updateRecordingUI(isRecording: boolean, duration: number): void {
  if (!recordBtn || !recordingIndicator || !recordingTime) {
    return;
  }

  if (isRecording) {
    // Update button to show stop icon (square)
    recordBtn.classList.add('recording');
    recordBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
    recordBtn.title = window.l10n.stopRecording;

    // Show recording indicator with time
    recordingIndicator.classList.remove('hidden');
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    recordingTime.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  } else {
    // Update button to show record icon (video-box)
    recordBtn.classList.remove('recording');
    recordBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18,16L14,12.8V16H6V8H14V11.2L18,8M20,4H4A2,2 0 0,0 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V6C22,4.89 21.1,4 20,4Z"/></svg>`;
    recordBtn.title = window.l10n.startRecording;

    // Hide recording indicator
    recordingIndicator.classList.add('hidden');
    recordingTime.textContent = '00:00';
  }
}

/**
 * Handle recording settings from extension
 */
function handleRecordingSettings(message: { format: 'webm' | 'mp4' }): void {
  if (!activeDeviceId) {
    return;
  }

  const session = sessions.get(activeDeviceId);
  if (!session) {
    return;
  }

  // Toggle recording based on current state (check local state, not message)
  if (session.recordingManager.isCurrentlyRecording()) {
    // Already recording, stop it
    stopRecording();
  } else {
    // Not recording, start with the format from settings
    startRecordingWithSettings(message.format);
  }
}

/**
 * Handle recording completion - send blob to extension for saving
 */
function handleRecordingComplete(blob: Blob, duration: number): void {
  // Convert blob to array buffer
  blob.arrayBuffer().then((buffer) => {
    const array = new Uint8Array(buffer);

    // Send to extension for saving
    vscode.postMessage({
      type: 'saveRecording',
      data: Array.from(array),
      mimeType: blob.type,
      duration,
    });
  });
}

/**
 * Update audio state from settings
 */
function updateAudioState(audioEnabled: boolean): void {
  isMuted = !audioEnabled;

  // Update all audio renderers
  sessions.forEach((session) => {
    session.audioRenderer.setMuted(isMuted);
  });

  // Update button text and icon (now in dropdown)
  if (muteBtn && muteBtnText) {
    // Update SVG icon
    const iconPath = audioEnabled
      ? 'M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z'
      : 'M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z';
    const svg = muteBtn.querySelector('svg');
    if (svg) {
      svg.innerHTML = `<path d="${iconPath}"/>`;
    }
    // Update text
    muteBtnText.textContent = audioEnabled ? window.l10n.disableAudio : window.l10n.enableAudio;
  }
}

/**
 * Handle state snapshot from extension (single source of truth)
 * This replaces individual message handlers like sessionList, settings, toolStatus, connectionStateChanged
 */
function handleStateSnapshot(state: AppStateSnapshot): void {
  // 1. Update tool status
  const wasAvailable = toolsAvailable;
  toolsAvailable = state.toolStatus.adbAvailable && state.toolStatus.scrcpyAvailable;
  adbMissing = !state.toolStatus.adbAvailable;
  scrcpyMissing = !state.toolStatus.scrcpyAvailable;

  // 2. Update settings
  if (state.settings.showStats !== showStats) {
    showStats = state.settings.showStats;
    sessions.forEach((session) => {
      session.videoRenderer.setStatsEnabled(showStats);
    });
    if (!showStats) {
      statsElement.classList.add('hidden');
    }
  }

  if (state.settings.showExtendedStats !== showExtendedStats) {
    showExtendedStats = state.settings.showExtendedStats;
    if (showExtendedStats) {
      statsElement.classList.add('extended');
    } else {
      statsElement.classList.remove('extended');
    }
  }

  if (state.settings.audioEnabled !== !isMuted) {
    updateAudioState(state.settings.audioEnabled);
  }

  // 3. Update device info cache
  for (const [serial, info] of Object.entries(state.deviceInfo)) {
    deviceInfoCache.set(serial, info);
  }

  // 4. Sync sessions - create/update/remove as needed
  const stateDeviceIds = new Set(state.devices.map((d) => d.deviceId));

  // Remove sessions that no longer exist
  for (const [deviceId] of sessions) {
    if (!stateDeviceIds.has(deviceId)) {
      removeDeviceSession(deviceId);
    }
  }

  // Create or update sessions
  for (const deviceState of state.devices) {
    let session = sessions.get(deviceState.deviceId);

    if (!session) {
      // Create new session UI
      session = createDeviceSession(deviceState.deviceId, {
        serial: deviceState.serial,
        name: deviceState.name,
      });
    }

    // Update connection state
    if (session.connectionState !== deviceState.connectionState) {
      session.connectionState = deviceState.connectionState;
      updateTabConnectionState(session.tabElement, deviceState.connectionState);
    }
  }

  // 5. Update active device
  const activeSession = state.devices.find((d) => d.isActive);
  if (activeSession && activeDeviceId !== activeSession.deviceId) {
    switchToDevice(activeSession.deviceId);
  }

  // 6. Handle status message
  if (state.statusMessage) {
    const targetDeviceId = state.statusMessage.deviceId || undefined;
    const hasSessions = sessions.size > 0;

    // Only show per-device status overlays for the active device.
    // Global status overlays are only shown when there are no sessions (initial load / no devices).
    const shouldShowOverlay = !hasSessions ? true : targetDeviceId === activeDeviceId;

    if (!shouldShowOverlay) {
      hideStatus();
    } else {
      switch (state.statusMessage.type) {
        case 'loading':
          showStatus(state.statusMessage.text);
          break;
        case 'error':
          showError(state.statusMessage.text);
          break;
        case 'empty':
          // Show empty state when no devices are connected
          if (sessions.size === 0) {
            showEmptyState();
          } else {
            hideStatus();
          }
          break;
      }
    }
  } else if (sessions.size === 0) {
    // No status message and no sessions - show empty state
    if (wasAvailable !== toolsAvailable || sessions.size === 0) {
      showEmptyState();
    }
  } else {
    // Sessions exist and no status message - ensure overlay is hidden
    hideStatus();
  }

  // 7. Show tab bar if we have sessions
  if (state.devices.length > 0) {
    tabBar.classList.remove('hidden');
  }
}

/**
 * Handle messages from the extension
 */
function handleMessage(event: MessageEvent) {
  const message = event.data;

  switch (message.type) {
    // New unified state snapshot (single source of truth)
    case 'stateSnapshot':
      handleStateSnapshot(message.state);
      break;

    case 'videoFrame':
      handleVideoFrame(message);
      break;

    case 'audioFrame':
      handleAudioFrame(message);
      break;

    case 'screenshotComplete':
      resetScreenshotButton();
      break;

    case 'deviceInfo':
      handleDeviceInfo(message);
      break;

    case 'recordingSettings':
      handleRecordingSettings(message);
      break;

    case 'toggleRecording':
      toggleRecording();
      break;

    case 'switchToTabByIndex':
      if (message.index !== undefined) {
        switchToTabByIndex(message.index);
      }
      break;

    case 'screenshotPreview':
      handleScreenshotPreview(message);
      break;

    case 'deviceSettingsLoaded':
      handleDeviceSettingsLoaded(message.settings);
      break;

    case 'deviceSettingsCacheLoaded':
      // Populate cache from persisted storage
      if (message.cache) {
        for (const [deviceId, settings] of Object.entries(message.cache)) {
          deviceSettingsCache.set(deviceId, settings as DeviceUISettings);
        }
      }
      break;

    case 'deviceSettingApplied':
      handleDeviceSettingApplied(message.setting, message.success, message.error);
      break;
  }
}

/**
 * Handle video frame from extension
 */
function handleVideoFrame(message: {
  deviceId: string;
  data: number[] | Uint8Array | ArrayBuffer;
  isConfig: boolean;
  isKeyFrame: boolean;
  width?: number;
  height?: number;
  codec?: 'h264' | 'h265' | 'av1';
}) {
  const session = sessions.get(message.deviceId);
  if (!session) {
    return;
  }

  // Set codec if provided (sent with config frames)
  if (message.codec) {
    session.videoRenderer.setCodec(message.codec);
  }

  // Configure renderer with dimensions (only sent with first frame)
  if (message.width && message.height) {
    session.videoRenderer.configure(message.width, message.height);

    // Update rotate button if this is the active device
    if (message.deviceId === activeDeviceId) {
      updateRotateButton(message.width, message.height);
    }
  }

  // Push frame data
  if (message.data) {
    const frameData =
      message.data instanceof Uint8Array
        ? message.data
        : message.data instanceof ArrayBuffer
          ? new Uint8Array(message.data)
          : new Uint8Array(message.data);

    if (frameData.length === 0) {
      return;
    }
    session.videoRenderer.pushFrame(frameData, message.isConfig, message.isKeyFrame);

    // Hide status and show UI once we're receiving frames for active device
    if (message.deviceId === activeDeviceId && session.canvas.width > 0) {
      session.canvas.classList.remove('hidden');
      tabBar.classList.remove('hidden');
      hideStatus();
      if (controlToolbar) {
        controlToolbar.classList.remove('hidden');
      }
    }
  }
}

/**
 * Handle audio frame from extension
 */
function handleAudioFrame(message: {
  deviceId: string;
  data: number[] | Uint8Array | ArrayBuffer;
  isConfig: boolean;
}) {
  const session = sessions.get(message.deviceId);
  if (!session) {
    console.warn('AudioFrame: no session found for device', message.deviceId);
    return;
  }

  const frameData =
    message.data instanceof Uint8Array
      ? message.data
      : message.data instanceof ArrayBuffer
        ? new Uint8Array(message.data)
        : new Uint8Array(message.data);

  // Initialize audio renderer on first frame (config signal)
  if (message.isConfig && frameData.length === 0) {
    console.log('AudioFrame: initializing audio renderer for', message.deviceId);
    session.audioRenderer.initialize();
    return;
  }

  // Push frame data
  if (frameData.length > 0) {
    session.audioRenderer.pushFrame(frameData, message.isConfig);
  }
}

/**
 * Update tab element to show connection state
 */
function updateTabConnectionState(tabElement: HTMLElement, state: ConnectionState) {
  const statusElement = tabElement.querySelector('.tab-status');
  if (!statusElement) {
    return;
  }

  // Remove all state classes
  statusElement.classList.remove(
    'tab-status-connecting',
    'tab-status-connected',
    'tab-status-disconnected',
    'tab-status-reconnecting'
  );

  // Add current state class
  statusElement.classList.add(`tab-status-${state}`);
}

/**
 * Create a new device session UI
 */
function createDeviceSession(
  deviceId: string,
  deviceInfo: { serial: string; name: string }
): DeviceSessionUI {
  // Create canvas (set dimensions to 0 to prevent showing before video arrives)
  const canvas = document.createElement('canvas');
  canvas.id = `canvas-${deviceId}`;
  canvas.className = 'device-canvas hidden';
  canvas.width = 0;
  canvas.height = 0;
  canvasContainer.appendChild(canvas);

  // Create video renderer
  const videoRenderer = new VideoRenderer(
    canvas,
    (fps, frames) => {
      if (deviceId === activeDeviceId && showStats) {
        if (showExtendedStats) {
          // Display extended stats
          const extStats: ExtendedStats = videoRenderer.getExtendedStats();
          const bitrateFormatted = formatBitrate(extStats.bitrate);
          statsElement.textContent = window.l10n.extendedStatsFormat
            .replace('{0}', extStats.fps.toString())
            .replace('{1}', bitrateFormatted)
            .replace('{2}', `${extStats.framesDropped} frames`);
        } else {
          // Display basic stats
          statsElement.textContent = window.l10n.statsFormat
            .replace('{0}', fps.toString())
            .replace('{1}', frames.toString());
        }
        statsElement.classList.remove('hidden');
      }
    },
    (width, height) => {
      // Update rotate button when dimensions change (from SPS parsing on rotation)
      if (deviceId === activeDeviceId) {
        updateRotateButton(width, height);
      }
      // Notify extension of new dimensions for touch coordinate mapping
      vscode.postMessage({
        type: 'dimensionsChanged',
        deviceId,
        width,
        height,
      });
    }
  );
  videoRenderer.setStatsEnabled(showStats);

  // Create audio renderer
  const audioRenderer = new AudioRenderer();
  audioRenderer.setMuted(isMuted);

  // Create recording manager
  const recordingManager = new RecordingManager(
    canvas,
    (isRecording, duration) => {
      // Update recording UI state
      updateRecordingUI(isRecording, duration);
    },
    (blob, duration) => {
      // Send recorded blob to extension for saving
      handleRecordingComplete(blob, duration);
    }
  );

  // Create input handler
  const inputHandler = new InputHandler(
    canvas,
    (x, y, action) => {
      if (deviceId === activeDeviceId) {
        vscode.postMessage({
          type: 'touch',
          deviceId,
          x,
          y,
          action,
          screenWidth: canvas.width,
          screenHeight: canvas.height,
        });
      }
    },
    (x, y, deltaX, deltaY) => {
      if (deviceId === activeDeviceId) {
        vscode.postMessage({
          type: 'scroll',
          deviceId,
          x,
          y,
          deltaX,
          deltaY,
          screenWidth: canvas.width,
          screenHeight: canvas.height,
        });
      }
    },
    (x1, y1, x2, y2, action) => {
      if (deviceId === activeDeviceId) {
        vscode.postMessage({
          type: 'multiTouch',
          deviceId,
          x1,
          y1,
          x2,
          y2,
          action,
          screenWidth: canvas.width,
          screenHeight: canvas.height,
        });
      }
    }
  );

  // Create keyboard handler
  const keyboardHandler = new KeyboardHandler(
    canvas,
    // Text callback (INJECT_TEXT)
    (text) => {
      if (deviceId === activeDeviceId) {
        vscode.postMessage({
          type: 'injectText',
          deviceId,
          text,
        });
      }
    },
    // Keycode callback (INJECT_KEYCODE)
    (keycode, metastate, action) => {
      if (deviceId === activeDeviceId) {
        vscode.postMessage({
          type: 'injectKeycode',
          deviceId,
          keycode,
          metastate,
          action,
        });
      }
    },
    // Paste callback (PC clipboard -> device)
    () => {
      if (deviceId === activeDeviceId) {
        vscode.postMessage({ type: 'pasteFromHost', deviceId });
      }
    },
    // Copy callback (device -> PC clipboard)
    () => {
      if (deviceId === activeDeviceId) {
        vscode.postMessage({ type: 'copyToHost', deviceId });
      }
    }
  );

  // Create tab element
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.deviceId = deviceId;

  // Info icon (ⓘ) for connection status - circle in accent color, "i" in white
  const infoIcon = `<svg class="tab-status-icon" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" fill="currentColor"/>
    <path d="M13,9H11V7H13M13,17H11V11H13" fill="white"/>
  </svg>`;

  tab.innerHTML = `
    <div class="tab-status tab-status-connecting">
      ${infoIcon}
    </div>
    <span class="tab-label">${escapeHtml(deviceInfo.name)}</span>
    <span class="tab-close">&times;</span>
  `;

  // Tab click handler
  tab.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('tab-close')) {
      // Close tab
      e.stopPropagation();
      vscode.postMessage({ type: 'closeTab', deviceId });
    } else {
      // Switch tab
      vscode.postMessage({ type: 'switchTab', deviceId });
    }
  });

  // Attach tooltip handlers
  attachTooltipHandlers(tab, deviceInfo.serial);

  // Insert tab before add button
  tabBar.insertBefore(tab, addDeviceBtn);

  const session: DeviceSessionUI = {
    deviceId,
    deviceInfo,
    canvas,
    videoRenderer,
    audioRenderer,
    inputHandler,
    keyboardHandler,
    recordingManager,
    tabElement: tab,
    connectionState: 'connecting',
  };

  sessions.set(deviceId, session);
  return session;
}

/**
 * Remove device session UI
 */
function removeDeviceSession(deviceId: string) {
  const session = sessions.get(deviceId);
  if (!session) {
    return;
  }

  // Cleanup
  session.videoRenderer.dispose();
  session.audioRenderer.dispose();
  session.inputHandler.dispose();
  session.keyboardHandler.dispose();
  session.recordingManager.dispose();
  session.canvas.remove();
  session.tabElement.remove();

  sessions.delete(deviceId);
  deviceInfoCache.delete(session.deviceInfo.serial);

  // If was active, clear active state
  if (activeDeviceId === deviceId) {
    activeDeviceId = null;
    statsElement.classList.add('hidden');
  }

  // Hide UI and show empty state if no more sessions
  if (sessions.size === 0) {
    tabBar.classList.add('hidden');
    controlToolbar.classList.add('hidden');
    showEmptyState();
  }
}

/**
 * Switch to a device (show its canvas)
 */
function switchToDevice(deviceId: string) {
  const newSession = sessions.get(deviceId);
  if (!newSession) {
    return;
  }

  // Pause and hide ALL other canvases (not just the previous active one)
  sessions.forEach((s, id) => {
    if (id !== deviceId) {
      s.canvas.classList.add('hidden');
      s.tabElement.classList.remove('active');
      s.videoRenderer.pause();
      s.audioRenderer.pause();
      s.keyboardHandler.setFocused(false);
    }
  });

  // Activate new session
  activeDeviceId = deviceId;
  newSession.tabElement.classList.add('active');
  newSession.videoRenderer.resume();
  newSession.audioRenderer.resume();

  // Show canvas if it has received video (has dimensions)
  if (newSession.canvas.width > 0 && newSession.canvas.height > 0) {
    newSession.canvas.classList.remove('hidden');
    hideStatus();
    if (controlToolbar) {
      controlToolbar.classList.remove('hidden');
    }
  }
}

/**
 * Switch to a tab by index (0-based)
 */
function switchToTabByIndex(index: number) {
  // Get array of device IDs in tab order
  const deviceIds: string[] = [];
  const tabs = tabBar.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    const deviceId = (tab as HTMLElement).dataset.deviceId;
    if (deviceId) {
      deviceIds.push(deviceId);
    }
  });

  // Check if index is valid
  if (index < 0 || index >= deviceIds.length) {
    return;
  }

  // Switch to the tab at the specified index
  const targetDeviceId = deviceIds[index];
  vscode.postMessage({ type: 'switchTab', deviceId: targetDeviceId });
}

/**
 * Show status message (with loading spinner)
 */
function showStatus(text: string) {
  statusTextElement.textContent = text;
  statusTextElement.classList.remove('error');
  statusElement.classList.remove('hidden');

  // Show spinner
  const spinner = statusElement.querySelector('.spinner') as HTMLElement;
  if (spinner) {
    spinner.style.display = 'block';
  }

  // Hide icons if they exist
  const emptyIcon = statusElement.querySelector('.empty-icon') as HTMLElement;
  if (emptyIcon) {
    emptyIcon.style.display = 'none';
  }
  const errorIcon = statusElement.querySelector('.error-icon') as HTMLElement;
  if (errorIcon) {
    errorIcon.style.display = 'none';
  }

  // Remove buttons if exists
  const btnContainer = statusElement.querySelector('.button-container');
  if (btnContainer) {
    btnContainer.remove();
  }
}

/**
 * Show error message with reconnect button
 */
function showError(text: string) {
  statusTextElement.textContent = text;
  statusTextElement.classList.add('error');

  // Hide canvases and control toolbar
  sessions.forEach((s) => s.canvas.classList.add('hidden'));
  if (controlToolbar) {
    controlToolbar.classList.add('hidden');
  }

  // Hide spinner
  const spinner = statusElement.querySelector('.spinner') as HTMLElement;
  if (spinner) {
    spinner.style.display = 'none';
  }

  // Show disconnected icon
  let errorIcon = statusElement.querySelector('.error-icon') as HTMLElement;
  if (!errorIcon) {
    errorIcon = document.createElement('div');
    errorIcon.className = 'error-icon';
    // Disconnected/unplugged icon
    errorIcon.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"></line>
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
      <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
      <line x1="12" y1="20" x2="12.01" y2="20"></line>
    </svg>`;
    errorIcon.style.cssText = 'margin-bottom: 12px; opacity: 0.6;';
    statusElement.insertBefore(errorIcon, statusTextElement);
  }
  errorIcon.style.display = 'block';

  // Hide empty icon if exists
  const emptyIcon = statusElement.querySelector('.empty-icon') as HTMLElement;
  if (emptyIcon) {
    emptyIcon.style.display = 'none';
  }

  // Remove existing buttons
  let btnContainer = statusElement.querySelector('.button-container') as HTMLElement;
  if (btnContainer) {
    btnContainer.remove();
  }

  // Create button container with only reconnect button
  btnContainer = document.createElement('div');
  btnContainer.className = 'button-container';
  btnContainer.style.cssText =
    'display: flex; gap: 8px; justify-content: center; margin-top: 12px;';
  statusElement.appendChild(btnContainer);

  const reconnectBtn = document.createElement('button');
  reconnectBtn.className = 'reconnect-btn';
  reconnectBtn.textContent = window.l10n.reconnect;
  reconnectBtn.onclick = () => {
    vscode.postMessage({ type: 'reconnect' });
    showStatus(window.l10n.reconnecting);
  };
  btnContainer.appendChild(reconnectBtn);

  statusElement.classList.remove('hidden');
}

/**
 * Hide status overlay
 */
function hideStatus() {
  statusElement.classList.add('hidden');
}

/**
 * Show empty state (no devices connected)
 */
function showEmptyState() {
  statusElement.classList.remove('hidden');

  // Hide spinner
  const spinner = statusElement.querySelector('.spinner') as HTMLElement;
  if (spinner) {
    spinner.style.display = 'none';
  }

  // Hide error icon if exists
  const errorIcon = statusElement.querySelector('.error-icon') as HTMLElement;
  if (errorIcon) {
    errorIcon.style.display = 'none';
  }

  // Get or create empty icon
  let emptyIcon = statusElement.querySelector('.empty-icon') as HTMLElement;
  if (!emptyIcon) {
    emptyIcon = document.createElement('div');
    emptyIcon.className = 'empty-icon';
    emptyIcon.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
      <line x1="12" y1="18" x2="12" y2="18"></line>
    </svg>`;
    emptyIcon.style.cssText = 'margin-bottom: 12px; opacity: 0.5;';
    statusElement.insertBefore(emptyIcon, statusTextElement);
  }

  // Remove existing buttons/alerts
  let btnContainer = statusElement.querySelector('.button-container') as HTMLElement;
  if (btnContainer) {
    btnContainer.remove();
  }

  // Create button container
  btnContainer = document.createElement('div');
  btnContainer.className = 'button-container';
  btnContainer.style.cssText =
    'display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: 12px;';
  statusElement.appendChild(btnContainer);

  if (toolsAvailable) {
    // Show normal empty state
    statusElement.classList.remove('warning');
    emptyIcon.style.display = 'block';
    statusTextElement.style.display = '';
    statusTextElement.textContent = window.l10n.noDevicesConnected;
    statusTextElement.classList.remove('error');

    const addBtn = document.createElement('button');
    addBtn.className = 'reconnect-btn';
    addBtn.textContent = window.l10n.addDevice;
    addBtn.onclick = () => {
      vscode.postMessage({ type: 'showDevicePicker' });
    };
    btnContainer.appendChild(addBtn);
  } else {
    // Show warning state
    statusElement.classList.add('warning');
    emptyIcon.style.display = 'none';
    statusTextElement.style.display = 'none';

    // Title row with icon and text
    const titleRow = document.createElement('div');
    titleRow.className = 'warning-title-row';

    const warningIcon = document.createElement('div');
    warningIcon.className = 'warning-icon';
    warningIcon.innerHTML = `<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M7.56 1h.88l6.54 12.26-.44.74H1.44l-.42-.74L7.56 1zm.44 1.7L2.43 13H13.57L8 2.7zM8.5 12h-1V7h1v5zm-1-6V5h1v1h-1z"/>
    </svg>`;

    const title = document.createElement('span');
    title.className = 'warning-title';
    title.textContent = window.l10n.missingDependency;

    titleRow.appendChild(warningIcon);
    titleRow.appendChild(title);
    btnContainer.appendChild(titleRow);

    // Subtitle with specific message
    const subtitle = document.createElement('div');
    subtitle.className = 'warning-subtitle';
    if (adbMissing && scrcpyMissing) {
      subtitle.textContent = window.l10n.toolWarningBoth;
    } else if (adbMissing) {
      subtitle.textContent = window.l10n.toolWarningAdb;
    } else if (scrcpyMissing) {
      subtitle.textContent = window.l10n.toolWarningScrcpy;
    }
    btnContainer.appendChild(subtitle);

    // Action buttons row
    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display: flex; gap: 8px; margin-top: 16px;';

    const installBtn = document.createElement('button');
    installBtn.className = 'reconnect-btn primary';
    installBtn.textContent = window.l10n.install;
    installBtn.onclick = () => {
      vscode.postMessage({ type: 'openInstallDocs' });
    };

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'reconnect-btn';
    settingsBtn.textContent = window.l10n.settings;
    settingsBtn.onclick = () => {
      vscode.postMessage({ type: 'openSettings' });
    };

    actionsRow.appendChild(installBtn);
    actionsRow.appendChild(settingsBtn);
    btnContainer.appendChild(actionsRow);
  }

  statusElement.classList.remove('hidden');
}

/**
 * Handle device info response from extension
 */
function handleDeviceInfo(message: { serial: string; info: DeviceDetailedInfo | null }) {
  // Store in cache
  if (message.info) {
    deviceInfoCache.set(message.serial, message.info);

    // If tooltip is visible for this device, update it
    if (deviceInfoTooltip && !deviceInfoTooltip.classList.contains('hidden')) {
      const visibleSerial = deviceInfoTooltip.dataset.serial;
      if (visibleSerial === message.serial) {
        updateTooltipContent(message.serial, message.info);
      }
    }
  }
}

/**
 * Show device info tooltip for a tab
 */
function showDeviceInfoTooltip(tab: HTMLElement, serial: string) {
  if (!deviceInfoTooltip) {
    return;
  }

  // Clear hide timeout
  if (tooltipHideTimeout) {
    clearTimeout(tooltipHideTimeout);
    tooltipHideTimeout = null;
  }

  // Position tooltip below tab
  const tabRect = tab.getBoundingClientRect();
  const containerRect = tabBar.getBoundingClientRect();
  deviceInfoTooltip.style.left = `${tabRect.left - containerRect.left}px`;
  deviceInfoTooltip.dataset.serial = serial;

  // Check cache first
  const cached = deviceInfoCache.get(serial);
  if (cached) {
    updateTooltipContent(serial, cached);
    deviceInfoTooltip.classList.add('visible');
  } else {
    // Show loading state
    deviceInfoTooltip.innerHTML = '<div class="device-info-loading">Loading device info...</div>';
    deviceInfoTooltip.classList.add('visible');

    // Request device info from extension
    vscode.postMessage({ type: 'getDeviceInfo', serial });
  }
}

/**
 * Hide device info tooltip
 */
function hideDeviceInfoTooltip() {
  if (!deviceInfoTooltip) {
    return;
  }

  // Delay hiding to allow moving mouse to tooltip
  tooltipHideTimeout = setTimeout(() => {
    deviceInfoTooltip!.classList.remove('visible');
    deviceInfoTooltip!.dataset.serial = '';
  }, 200);
}

/**
 * Update tooltip content with device info
 */
function updateTooltipContent(serial: string, info: DeviceDetailedInfo) {
  if (!deviceInfoTooltip) {
    return;
  }

  const {
    model,
    manufacturer,
    androidVersion,
    sdkVersion,
    batteryLevel,
    batteryCharging,
    storageTotal,
    storageUsed,
    screenResolution,
    ipAddress,
  } = info;

  // Determine connection type
  const isWifi = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(serial);
  const connectionType = isWifi ? 'WiFi' : 'USB';
  const connectionIcon = isWifi ? '📶' : '🔌';

  // Format battery icon
  const batteryIcon = batteryCharging ? '⚡' : '🔋';

  // Format storage as human-readable
  const storageUsedGB = (storageUsed / (1024 * 1024 * 1024)).toFixed(1);
  const storageTotalGB = (storageTotal / (1024 * 1024 * 1024)).toFixed(1);

  // Build tooltip content
  let content = '<div class="device-info-content">';

  if (manufacturer && model) {
    content += `<div class="info-row"><strong>${escapeHtml(manufacturer)} ${escapeHtml(model)}</strong></div>`;
  }

  if (androidVersion) {
    content += `<div class="info-row">Android ${escapeHtml(androidVersion)}`;
    if (sdkVersion) {
      content += ` (SDK ${sdkVersion})`;
    }
    content += `</div>`;
  }

  if (storageTotal > 0) {
    content += `<div class="info-row">Storage: ${storageUsedGB} GB / ${storageTotalGB} GB</div>`;
  }

  if (screenResolution && screenResolution !== 'Unknown') {
    // Parse resolution and format with × symbol
    const match = screenResolution.match(/(\d+)x(\d+)/);
    if (match) {
      content += `<div class="info-row">${match[1]} × ${match[2]}</div>`;
    }
  }

  if (ipAddress) {
    content += `<div class="info-row">${escapeHtml(ipAddress)}</div>`;
  }

  // Connection type and battery at the bottom, on the same row
  let bottomRow = `${connectionIcon} ${connectionType}`;
  if (batteryLevel > 0) {
    bottomRow += ` · ${batteryIcon} ${batteryLevel}%`;
    if (batteryCharging) {
      bottomRow += ' ⚡';
    }
  }
  content += `<div class="info-row info-row-bottom">${bottomRow}</div>`;

  content += '</div>';
  deviceInfoTooltip.innerHTML = content;
}

/**
 * Attach tooltip handlers to the info indicator in a tab
 */
function attachTooltipHandlers(tab: HTMLElement, serial: string) {
  const infoIndicator = tab.querySelector('.tab-status') as HTMLElement;
  if (!infoIndicator) {
    return;
  }

  // Show tooltip only when hovering the info indicator
  infoIndicator.addEventListener('mouseenter', () => {
    showDeviceInfoTooltip(tab, serial);
  });

  infoIndicator.addEventListener('mouseleave', () => {
    hideDeviceInfoTooltip();
  });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Handle screenshot preview message from extension
 */
function handleScreenshotPreview(message: { base64Data: string }) {
  if (!message.base64Data) {
    resetScreenshotButton();
    return;
  }

  currentScreenshotData = message.base64Data;

  // Set image source
  if (screenshotPreviewImage) {
    screenshotPreviewImage.src = `data:image/png;base64,${message.base64Data}`;
  }

  // Show overlay
  if (screenshotPreviewOverlay) {
    screenshotPreviewOverlay.classList.add('visible');
  }

  // Reset screenshot button
  resetScreenshotButton();
}

/**
 * Save screenshot via extension
 */
function saveScreenshot() {
  if (!currentScreenshotData) {
    return;
  }

  vscode.postMessage({
    type: 'saveScreenshot',
    base64Data: currentScreenshotData,
  });

  dismissScreenshotPreview();
}

/**
 * Copy screenshot to clipboard
 */
async function copyScreenshotToClipboard() {
  if (!currentScreenshotData) {
    return;
  }

  try {
    // Convert base64 to blob
    const byteString = atob(currentScreenshotData);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < byteString.length; i++) {
      uint8Array[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([arrayBuffer], { type: 'image/png' });

    // Copy to clipboard using Clipboard API
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': blob,
      }),
    ]);

    dismissScreenshotPreview();
  } catch (error) {
    console.error('Failed to copy screenshot to clipboard:', error);
  }
}

/**
 * Dismiss screenshot preview overlay
 */
function dismissScreenshotPreview() {
  if (screenshotPreviewOverlay) {
    screenshotPreviewOverlay.classList.remove('visible');
  }
  currentScreenshotData = null;
}

// ==================== Device Settings Popup ====================

/**
 * Open device settings popup
 */
function openDeviceSettings() {
  if (!deviceSettingsOverlay || !deviceSettingsContent || !activeDeviceId) {
    return;
  }

  // Use cached settings if available, otherwise use defaults
  const cachedSettings = deviceSettingsCache.get(activeDeviceId);
  const initialSettings: DeviceUISettings = cachedSettings || {
    darkMode: 'auto',
    navigationMode: 'gestural',
    availableNavigationModes: ['threebutton', 'gestural'],
    talkbackEnabled: false,
    selectToSpeakEnabled: false,
    fontScale: 1.0,
    displayDensity: 400,
    defaultDensity: 400,
    showLayoutBounds: false,
  };

  // If we have cached settings, show them enabled immediately
  // Otherwise show disabled state while fetching
  const hasCachedSettings = !!cachedSettings;
  renderDeviceSettingsForm(initialSettings, !hasCachedSettings);

  if (hasCachedSettings) {
    currentDeviceSettings = cachedSettings;
  }

  // Show overlay
  deviceSettingsOverlay.classList.add('visible');

  // Request fresh settings from extension
  vscode.postMessage({ type: 'openDeviceSettings' });
}

/**
 * Close device settings popup
 */
function closeDeviceSettings() {
  if (!deviceSettingsOverlay) {
    return;
  }

  deviceSettingsOverlay.classList.remove('visible');
  currentDeviceSettings = null;
  pendingSettingChanges.clear();
}

/**
 * Handle device settings loaded from extension
 */
function handleDeviceSettingsLoaded(settings: DeviceUISettings) {
  if (!deviceSettingsContent || !activeDeviceId) {
    return;
  }

  // Cache settings for this device
  deviceSettingsCache.set(activeDeviceId, settings);

  currentDeviceSettings = settings;
  renderDeviceSettingsForm(settings, false); // false = enabled
}

/**
 * Handle device setting applied response
 */
function handleDeviceSettingApplied(setting: string, success: boolean, error?: string) {
  pendingSettingChanges.delete(setting);

  // Remove loading state from the control
  const control = deviceSettingsContent?.querySelector(`[data-setting="${setting}"]`);
  if (control) {
    control.classList.remove('loading');
  }

  if (!success && error) {
    console.error(`Failed to apply setting ${setting}: ${error}`);
  }
}

/**
 * Create a settings row element
 */
function createSettingsRow(label: string, controlElement: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'settings-row-label';
  labelSpan.textContent = label;
  row.appendChild(labelSpan);

  row.appendChild(controlElement);
  return row;
}

/**
 * Create a segmented control
 */
function createSegmentedControl(
  setting: string,
  options: { value: string; label: string }[],
  currentValue: string,
  disabled: boolean
): HTMLElement {
  const control = document.createElement('div');
  control.className = 'segmented-control';
  if (disabled) {
    control.classList.add('disabled');
  }
  control.dataset.setting = setting;

  options.forEach((option) => {
    const btn = document.createElement('button');
    btn.className = 'segment-btn';
    if (option.value === currentValue) {
      btn.classList.add('active');
    }
    btn.dataset.value = option.value;
    btn.textContent = option.label;
    btn.disabled = disabled;
    control.appendChild(btn);
  });

  return control;
}

/**
 * Create a toggle switch
 */
function createToggleSwitch(setting: string, isActive: boolean, disabled: boolean): HTMLElement {
  const toggle = document.createElement('div');
  toggle.className = 'toggle-switch';
  if (isActive) {
    toggle.classList.add('active');
  }
  if (disabled) {
    toggle.classList.add('disabled');
  }
  toggle.dataset.setting = setting;
  return toggle;
}

/**
 * Create a slider control
 */
function createSliderControl(
  setting: string,
  min: number,
  max: number,
  step: number,
  value: number,
  displayValue: string,
  disabled: boolean
): HTMLElement {
  const control = document.createElement('div');
  control.className = 'slider-control';
  if (disabled) {
    control.classList.add('disabled');
  }
  control.dataset.setting = setting;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'settings-slider';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  slider.disabled = disabled;
  control.appendChild(slider);

  const valueSpan = document.createElement('span');
  valueSpan.className = 'slider-value';
  valueSpan.textContent = displayValue;
  control.appendChild(valueSpan);

  return control;
}

/**
 * Get font scale display label
 */
function getFontScaleLabel(fontScale: number): string {
  const fontScaleLabels: Record<string, string> = {
    '0.85': window.l10n.small,
    '1': window.l10n.default,
    '1.15': window.l10n.large,
    '1.3': window.l10n.largest,
  };
  return fontScaleLabels[fontScale.toString()] || `${Math.round(fontScale * 100)}%`;
}

/**
 * Render device settings form using safe DOM methods
 */
function renderDeviceSettingsForm(settings: DeviceUISettings, disabled: boolean) {
  if (!deviceSettingsContent) {
    return;
  }

  // Clear content
  deviceSettingsContent.textContent = '';

  // Calculate display density percentage relative to default
  const densityPercent =
    settings.defaultDensity > 0
      ? Math.round((settings.displayDensity / settings.defaultDensity) * 100)
      : 100;

  // Dark Mode
  const darkModeControl = createSegmentedControl(
    'darkMode',
    [
      { value: 'auto', label: window.l10n.auto },
      { value: 'light', label: window.l10n.light },
      { value: 'dark', label: window.l10n.dark },
    ],
    settings.darkMode,
    disabled
  );
  deviceSettingsContent.appendChild(createSettingsRow(window.l10n.darkMode, darkModeControl));

  // Navigation Mode - only show available modes
  const allNavOptions = [
    { value: 'threebutton', label: window.l10n.threeButton },
    { value: 'gestural', label: window.l10n.gestural },
    { value: 'twobutton', label: window.l10n.twoButton },
  ];
  const availableModes = settings.availableNavigationModes || ['threebutton', 'gestural'];
  const navOptions = allNavOptions.filter((opt) => availableModes.includes(opt.value as never));
  const navModeControl = createSegmentedControl(
    'navigationMode',
    navOptions,
    settings.navigationMode,
    disabled
  );
  deviceSettingsContent.appendChild(createSettingsRow(window.l10n.navigationMode, navModeControl));

  // TalkBack
  const talkbackToggle = createToggleSwitch('talkbackEnabled', settings.talkbackEnabled, disabled);
  deviceSettingsContent.appendChild(createSettingsRow(window.l10n.talkback, talkbackToggle));

  // Select to Speak
  const selectToSpeakToggle = createToggleSwitch(
    'selectToSpeakEnabled',
    settings.selectToSpeakEnabled,
    disabled
  );
  deviceSettingsContent.appendChild(
    createSettingsRow(window.l10n.selectToSpeak, selectToSpeakToggle)
  );

  // Font Size
  const fontScaleControl = createSliderControl(
    'fontScale',
    0.85,
    1.3,
    0.15,
    settings.fontScale,
    getFontScaleLabel(settings.fontScale),
    disabled
  );
  deviceSettingsContent.appendChild(createSettingsRow(window.l10n.fontSize, fontScaleControl));

  // Display Size
  const displaySizeControl = createSliderControl(
    'displayDensity',
    80,
    120,
    5,
    densityPercent,
    `${densityPercent}%`,
    disabled
  );
  deviceSettingsContent.appendChild(createSettingsRow(window.l10n.displaySize, displaySizeControl));

  // Show Layout Bounds
  const layoutBoundsToggle = createToggleSwitch(
    'showLayoutBounds',
    settings.showLayoutBounds,
    disabled
  );
  deviceSettingsContent.appendChild(
    createSettingsRow(window.l10n.showLayoutBounds, layoutBoundsToggle)
  );

  // Attach event handlers (only if not disabled)
  if (!disabled) {
    attachSettingsEventHandlers();
  }
}

/**
 * Attach event handlers to settings controls
 */
function attachSettingsEventHandlers() {
  if (!deviceSettingsContent) {
    return;
  }

  // Segmented controls (dark mode, navigation mode)
  const segmentedControls = deviceSettingsContent.querySelectorAll('.segmented-control');
  segmentedControls.forEach((control) => {
    const setting = (control as HTMLElement).dataset.setting;
    const buttons = control.querySelectorAll('.segment-btn');

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (control.classList.contains('loading')) {
          return;
        }

        const value = (btn as HTMLElement).dataset.value;
        if (!setting || !value) {
          return;
        }

        // Update UI immediately
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        // Send to extension
        applyDeviceSetting(setting, value, control as HTMLElement);
      });
    });
  });

  // Toggle switches
  const toggleSwitches = deviceSettingsContent.querySelectorAll('.toggle-switch');
  toggleSwitches.forEach((toggle) => {
    const setting = (toggle as HTMLElement).dataset.setting;

    toggle.addEventListener('click', () => {
      if (toggle.classList.contains('loading')) {
        return;
      }

      if (!setting) {
        return;
      }

      // Toggle UI immediately
      const newValue = !toggle.classList.contains('active');
      toggle.classList.toggle('active', newValue);

      // Send to extension
      applyDeviceSetting(setting, newValue, toggle as HTMLElement);
    });
  });

  // Sliders
  const sliderControls = deviceSettingsContent.querySelectorAll('.slider-control');
  sliderControls.forEach((control) => {
    const setting = (control as HTMLElement).dataset.setting;
    const slider = control.querySelector('.settings-slider') as HTMLInputElement;
    const valueDisplay = control.querySelector('.slider-value') as HTMLElement;

    if (!slider || !valueDisplay || !setting) {
      return;
    }

    // Debounce slider changes
    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    slider.addEventListener('input', () => {
      const value = parseFloat(slider.value);

      // Update display immediately
      if (setting === 'fontScale') {
        valueDisplay.textContent = getFontScaleLabel(value);
      } else if (setting === 'displayDensity') {
        valueDisplay.textContent = `${value}%`;
      }
    });

    slider.addEventListener('change', () => {
      if (control.classList.contains('loading')) {
        return;
      }

      // Debounce the change
      if (debounceTimeout) {
        clearTimeout(debounceTimeout);
      }

      debounceTimeout = setTimeout(() => {
        let value: number;

        if (setting === 'fontScale') {
          value = parseFloat(slider.value);
        } else if (setting === 'displayDensity') {
          // Convert percentage back to actual density
          const percent = parseFloat(slider.value);
          value = Math.round((percent / 100) * (currentDeviceSettings?.defaultDensity || 420));
        } else {
          value = parseFloat(slider.value);
        }

        applyDeviceSetting(setting, value, control as HTMLElement);
      }, 100);
    });
  });
}

/**
 * Apply a device setting
 */
function applyDeviceSetting(setting: string, value: unknown, control: HTMLElement) {
  // Mark as pending and show loading state
  pendingSettingChanges.add(setting);
  control.classList.add('loading');

  // Update current settings and cache optimistically
  if (currentDeviceSettings && activeDeviceId) {
    (currentDeviceSettings as unknown as Record<string, unknown>)[setting] = value;
    deviceSettingsCache.set(activeDeviceId, { ...currentDeviceSettings });
  }

  // Send to extension
  vscode.postMessage({
    type: 'applyDeviceSetting',
    setting,
    value,
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// Listen for messages from extension
window.addEventListener('message', handleMessage);
