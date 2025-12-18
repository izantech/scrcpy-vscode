import { VideoRenderer, ExtendedStats } from './VideoRenderer';
import { AudioRenderer } from './AudioRenderer';
import { InputHandler } from './InputHandler';
import { KeyboardHandler } from './KeyboardHandler';
import { RecordingManager } from './RecordingManager';
import { TouchVisualizer } from './TouchVisualizer';

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
      controlCenter: string;
      darkMode: string;
      auto: string;
      light: string;
      dark: string;
      navigationMode: string;
      gestural: string;
      threeButton: string;
      twoButton: string;
      talkback: string;
      fontSize: string;
      displaySize: string;
      showLayoutBounds: string;
      appearance: string;
      accessibility: string;
      developer: string;
      loadingSettings: string;
      small: string;
      default: string;
      large: string;
      largest: string;
      display: string;
      orientation: string;
      portrait: string;
      landscape: string;
      autoRotate: string;
      audioVolume: string;
      audioForwarding: string;
      on: string;
      off: string;
      volumeDown: string;
      volumeUp: string;
      systemShortcuts: string;
      notificationPanel: string;
      settingsPanel: string;
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
  fontScale: number;
  displayDensity: number;
  defaultDensity: number;
  showLayoutBounds: boolean;
  orientation: 'portrait' | 'landscape' | 'auto';
  audioEnabled: boolean;
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
    showTouchRipples: boolean;
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
  touchVisualizer: TouchVisualizer;
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
let showTouchRipples = false;
let isMuted = false;
let screenshotBtn: HTMLElement | null = null;
let recordBtn: HTMLElement | null = null;
let recordingIndicator: HTMLElement | null = null;
let recordingTime: HTMLElement | null = null;
let currentScreenshotData: string | null = null;

// Control Center
let controlCenterOverlay: HTMLElement | null = null;
let controlCenterContent: HTMLElement | null = null;
let controlCenterBtn: HTMLElement | null = null;
let currentControlCenterSettings: DeviceUISettings | null = null;
const pendingSettingChanges = new Set<string>();
const controlCenterCache = new Map<string, DeviceUISettings>();

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

  // Control Center setup
  controlCenterOverlay = document.getElementById('control-center-overlay');
  controlCenterContent = document.getElementById('control-center-content');
  controlCenterBtn = document.getElementById('control-center-btn');

  if (controlCenterBtn) {
    controlCenterBtn.addEventListener('click', () => {
      if (controlCenterOverlay?.classList.contains('visible')) {
        closeControlCenter();
      } else {
        openControlCenter();
      }
    });
  }

  // Add scroll listener for top fade effect
  const sectionsContainer = document.querySelector('.control-center-sections');
  if (sectionsContainer) {
    sectionsContainer.addEventListener('scroll', () => {
      if (sectionsContainer.scrollTop > 10) {
        sectionsContainer.classList.add('scrolled');
      } else {
        sectionsContainer.classList.remove('scrolled');
      }
    });
  }

  // Close control center when clicking outside of it
  document.addEventListener('click', (e) => {
    if (!controlCenterOverlay?.classList.contains('visible')) {
      return;
    }
    const target = e.target as HTMLElement;
    // Keep open if clicking inside the settings sections or the toggle button
    if (!target.closest('.control-center-sections') && !target.closest('#control-center-btn')) {
      closeControlCenter();
    }
  });

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

  if (state.settings.showTouchRipples !== showTouchRipples) {
    showTouchRipples = state.settings.showTouchRipples;
    sessions.forEach((session) => {
      session.touchVisualizer.setEnabled(showTouchRipples);
    });
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

    case 'controlCenterLoaded':
      handleControlCenterLoaded(message.settings);
      break;

    case 'controlCenterCacheLoaded':
      // Populate cache from persisted storage
      if (message.cache) {
        for (const [deviceId, settings] of Object.entries(message.cache)) {
          controlCenterCache.set(deviceId, settings as DeviceUISettings);
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

  // Create touch visualizer for ripple animations
  const touchVisualizer = new TouchVisualizer(canvasContainer);
  touchVisualizer.setEnabled(showTouchRipples);

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

        // Show touch ripple animation
        if (action === 'down') {
          touchVisualizer.showRipple(0, x, y);
        } else if (action === 'move') {
          touchVisualizer.moveRipple(0, x, y);
        } else if (action === 'up') {
          touchVisualizer.hideRipple(0);
        }
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

        // Show multi-touch ripple animations
        if (action === 'down') {
          touchVisualizer.showRipple(1000, x1, y1);
          touchVisualizer.showRipple(1001, x2, y2);
        } else if (action === 'move') {
          touchVisualizer.moveRipple(1000, x1, y1);
          touchVisualizer.moveRipple(1001, x2, y2);
        } else if (action === 'up') {
          touchVisualizer.hideRipple(1000);
          touchVisualizer.hideRipple(1001);
        }
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
    touchVisualizer,
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
  session.touchVisualizer.dispose();
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

// ==================== Control Center ====================

/**
 * Open Control Center
 */
function openControlCenter() {
  if (!controlCenterOverlay || !controlCenterContent || !activeDeviceId) {
    return;
  }

  // Use cached settings if available, otherwise use defaults
  const cachedSettings = controlCenterCache.get(activeDeviceId);
  const initialSettings: DeviceUISettings = cachedSettings || {
    darkMode: 'auto',
    navigationMode: 'gestural',
    availableNavigationModes: ['threebutton', 'gestural'],
    talkbackEnabled: false,
    fontScale: 1.0,
    displayDensity: 400,
    defaultDensity: 400,
    showLayoutBounds: false,
    orientation: 'auto',
    audioEnabled: !isMuted,
  };

  // If we have cached settings, show them enabled immediately
  // Otherwise show disabled state while fetching
  const hasCachedSettings = !!cachedSettings;
  renderControlCenterForm(initialSettings, !hasCachedSettings);

  if (hasCachedSettings) {
    currentControlCenterSettings = cachedSettings;
  }

  // Show overlay
  controlCenterOverlay.classList.add('visible');

  // Mark button as active and disable other toolbar buttons
  controlCenterBtn?.classList.add('active');
  document.getElementById('control-toolbar')?.classList.add('control-center-open');

  // Reset scroll position and update scroll state
  const sectionsContainer = document.querySelector('.control-center-sections');
  if (sectionsContainer) {
    sectionsContainer.scrollTop = 0;
    sectionsContainer.classList.remove('scrolled');
  }

  // Request fresh settings from extension
  vscode.postMessage({ type: 'openControlCenter' });
}

/**
 * Close Control Center
 */
function closeControlCenter() {
  if (!controlCenterOverlay) {
    return;
  }

  controlCenterOverlay.classList.remove('visible');
  currentControlCenterSettings = null;
  pendingSettingChanges.clear();

  // Remove active state and re-enable toolbar buttons
  controlCenterBtn?.classList.remove('active');
  document.getElementById('control-toolbar')?.classList.remove('control-center-open');
}

/**
 * Handle Control Center settings loaded from extension
 */
function handleControlCenterLoaded(settings: DeviceUISettings) {
  if (!controlCenterContent || !activeDeviceId) {
    return;
  }

  // Cache settings for this device
  controlCenterCache.set(activeDeviceId, settings);

  currentControlCenterSettings = settings;
  renderControlCenterForm(settings, false); // false = enabled
}

/**
 * Handle device setting applied response
 */
function handleDeviceSettingApplied(setting: string, success: boolean, error?: string) {
  pendingSettingChanges.delete(setting);

  // Remove loading state from the control
  const control = controlCenterContent?.querySelector(`[data-setting="${setting}"]`);
  if (control) {
    control.classList.remove('loading');
  }

  if (!success && error) {
    console.error(`Failed to apply setting ${setting}: ${error}`);
  }
}

/**
 * Create a settings row element with icon
 */
function createSettingsRow(
  label: string,
  controlElement: HTMLElement,
  iconSvg: string,
  iconClass: string
): HTMLElement {
  const row = document.createElement('div');
  const isToggle = controlElement.classList.contains('toggle-switch');
  row.className = isToggle ? 'settings-row clickable' : 'settings-row';

  const left = document.createElement('div');
  left.className = 'settings-row-left';

  const iconDiv = document.createElement('div');
  iconDiv.className = `settings-row-icon ${iconClass}`;
  iconDiv.innerHTML = iconSvg;
  left.appendChild(iconDiv);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'settings-row-label';
  labelSpan.textContent = label;
  left.appendChild(labelSpan);

  row.appendChild(left);
  row.appendChild(controlElement);
  return row;
}

/**
 * Get collapsed sections from localStorage
 */
function getCollapsedSections(): Set<string> {
  try {
    const stored = localStorage.getItem('controlCenterCollapsed');
    if (stored) {
      return new Set(JSON.parse(stored));
    }
  } catch {
    // Ignore parse errors
  }
  return new Set();
}

/**
 * Save collapsed sections to localStorage
 */
function saveCollapsedSections(collapsed: Set<string>): void {
  try {
    localStorage.setItem('controlCenterCollapsed', JSON.stringify([...collapsed]));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Create a settings group with header (collapsible)
 */
function createSettingsGroup(groupId: string, headerText: string, headerIcon: string): HTMLElement {
  const group = document.createElement('div');
  group.className = 'settings-group';
  group.dataset.groupId = groupId;

  // Check if this section should be collapsed
  const collapsedSections = getCollapsedSections();
  if (collapsedSections.has(groupId)) {
    group.classList.add('collapsed');
  }

  const header = document.createElement('div');
  header.className = 'settings-group-header';

  // Add icon using template
  const iconTemplate = document.createElement('template');
  iconTemplate.innerHTML = headerIcon.trim();
  if (iconTemplate.content.firstChild) {
    header.appendChild(iconTemplate.content.firstChild);
  }

  const headerSpan = document.createElement('span');
  headerSpan.textContent = headerText;
  header.appendChild(headerSpan);

  // Add chevron icon using safe DOM creation
  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  const chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevronSvg.setAttribute('viewBox', '0 0 24 24');
  chevronSvg.setAttribute('fill', 'currentColor');
  const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  chevronPath.setAttribute('d', 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z');
  chevronSvg.appendChild(chevronPath);
  chevron.appendChild(chevronSvg);
  header.appendChild(chevron);

  // Toggle collapse on header click
  header.addEventListener('click', () => {
    group.classList.toggle('collapsed');
    const sections = getCollapsedSections();
    if (group.classList.contains('collapsed')) {
      sections.add(groupId);
    } else {
      sections.delete(groupId);
    }
    saveCollapsedSections(sections);
  });

  group.appendChild(header);

  // Content wrapper for collapse
  const content = document.createElement('div');
  content.className = 'settings-group-content';
  group.appendChild(content);

  // Override appendChild to add to content instead of group
  const originalAppendChild = group.appendChild.bind(group);
  group.appendChild = function <T extends Node>(node: T): T {
    if ((node as Node) === header || (node as Node) === content) {
      return originalAppendChild(node);
    }
    content.appendChild(node);
    return node;
  };

  return group;
}

/**
 * Create an action button for Control Center
 */
function createActionButton(
  action: string,
  iconSvg: string,
  label: string,
  disabled: boolean
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'settings-action-btn';
  btn.dataset.action = action;
  btn.disabled = disabled;

  // Create icon container
  const iconContainer = document.createElement('span');
  iconContainer.className = 'action-btn-icon';
  // The icons are hardcoded SVG strings from our codebase, not user input
  const template = document.createElement('template');
  template.innerHTML = iconSvg.trim();
  if (template.content.firstChild) {
    iconContainer.appendChild(template.content.firstChild);
  }
  btn.appendChild(iconContainer);

  // Create label
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  btn.appendChild(labelSpan);

  return btn;
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
 * Create a cycle button that cycles through options on click
 */
function createCycleButton(
  setting: string,
  options: { value: string; label: string; icon: string }[],
  currentValue: string,
  disabled: boolean
): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'cycle-button';
  if (disabled) {
    btn.classList.add('disabled');
    btn.disabled = true;
  }
  btn.dataset.setting = setting;
  btn.dataset.options = JSON.stringify(options.map((o) => o.value));

  const currentIndex = options.findIndex((o) => o.value === currentValue);
  const current = options[currentIndex >= 0 ? currentIndex : 0];

  btn.dataset.currentIndex = String(currentIndex >= 0 ? currentIndex : 0);

  const iconSpan = document.createElement('span');
  iconSpan.className = 'cycle-button-icon';
  const template = document.createElement('template');
  template.innerHTML = current.icon.trim();
  if (template.content.firstChild) {
    iconSpan.appendChild(template.content.firstChild);
  }
  btn.appendChild(iconSpan);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'cycle-button-label';
  labelSpan.textContent = current.label;
  btn.appendChild(labelSpan);

  // Store all options data for cycling
  btn.dataset.optionsData = JSON.stringify(options);

  return btn;
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
 * Render Control Center form using safe DOM methods
 */
function renderControlCenterForm(settings: DeviceUISettings, disabled: boolean) {
  if (!controlCenterContent) {
    return;
  }

  // Clear content
  controlCenterContent.textContent = '';

  // Calculate display density percentage relative to default
  const densityPercent =
    settings.defaultDensity > 0
      ? Math.round((settings.displayDensity / settings.defaultDensity) * 100)
      : 100;

  // SVG icons for settings
  const icons = {
    // Dark mode - moon
    darkMode:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.75,4.09L15.22,6.03L16.13,9.09L13.5,7.28L10.87,9.09L11.78,6.03L9.25,4.09L12.44,4L13.5,1L14.56,4L17.75,4.09M21.25,11L19.61,12.25L20.2,14.23L18.5,13.06L16.8,14.23L17.39,12.25L15.75,11L17.81,10.95L18.5,9L19.19,10.95L21.25,11M18.97,15.95C19.8,15.87 20.69,17.05 20.16,17.8C19.84,18.25 19.5,18.67 19.08,19.07C15.17,23 8.84,23 4.94,19.07C1.03,15.17 1.03,8.83 4.94,4.93C5.34,4.53 5.76,4.17 6.21,3.85C6.96,3.32 8.14,4.21 8.06,5.04C7.79,7.9 8.75,10.87 10.95,13.06C13.14,15.26 16.1,16.22 18.97,15.95Z"/></svg>',
    // Navigation - concentric circles
    nav: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/></svg>',
    // TalkBack - person with sound waves
    talkback:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12,2A2,2 0 0,1 14,4A2,2 0 0,1 12,6A2,2 0 0,1 10,4A2,2 0 0,1 12,2M10.5,7H13.5A2,2 0 0,1 15.5,9V14.5H14V22H10V14.5H8.5V9A2,2 0 0,1 10.5,7M20,17L22,15V19L20,17M20,7L22,9V5L20,7M20,12L22,10V14L20,12Z"/></svg>',
    // Font size - text resize
    fontSize:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2,4V7H7V19H10V7H15V4H2M21,9H12V12H15V19H18V12H21V9Z"/></svg>',
    // Display size - screen resize
    displaySize:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21,17H3V5H21M21,3H3A2,2 0 0,0 1,5V17A2,2 0 0,0 3,19H8V21H16V19H21A2,2 0 0,0 23,17V5A2,2 0 0,0 21,3M5,7H9V9H7V11H5V7M19,11H17V9H15V7H19V11Z"/></svg>',
    // Layout bounds - grid layout
    layoutBounds:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3,3H9V9H3V3M3,15H9V21H3V15M15,3H21V9H15V3M15,15H21V21H15V15M5,5V7H7V5H5M5,17V19H7V17H5M17,5V7H19V5H17M17,17V19H19V17H17M11,5H13V9H11V5M11,11H13V13H11V11M11,15H13V19H11V15M5,11H9V13H5V11M15,11H19V13H15V11Z"/></svg>',
    // Orientation - screen rotation
    orientation:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.34,6.41L0.86,12.9L7.35,19.38L13.84,12.9L7.34,6.41M3.69,12.9L7.35,9.24L11,12.9L7.34,16.56L3.69,12.9M19.36,6.64C17.61,4.88 15.3,4 13,4V0.76L8.76,5L13,9.24V6C14.79,6 16.58,6.68 17.95,8.05C20.68,10.78 20.68,15.22 17.95,17.95C16.58,19.32 14.79,20 13,20C12.03,20 11.06,19.79 10.16,19.39L8.67,20.88C10,21.62 11.5,22 13,22C15.3,22 17.61,21.12 19.36,19.36C22.88,15.85 22.88,10.15 19.36,6.64Z"/></svg>',
    // Audio - speaker
    audio:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/></svg>',
    // Volume down
    volumeDown:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3,9H7L12,4V20L7,15H3V9M16,15H14V9H16V15Z"/></svg>',
    // Volume up
    volumeUp:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3,9H7L12,4V20L7,15H3V9M14,11H16V9H18V11H20V13H18V15H16V13H14V11Z"/></svg>',
    // Notification bell
    notification:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12,22C13.1,22 14,21.1 14,20H10C10,21.1 10.9,22 12,22M18,16V11C18,7.93 16.37,5.36 13.5,4.68V4C13.5,3.17 12.83,2.5 12,2.5C11.17,2.5 10.5,3.17 10.5,4V4.68C7.64,5.36 6,7.92 6,11V16L4,18V19H20V18L18,16Z"/></svg>',
    // Settings gear
    settingsGear:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>',
  };

  const groupIcons = {
    // Display - screen
    display:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21,16H3V4H21M21,2H3C1.89,2 1,2.89 1,4V16A2,2 0 0,0 3,18H10V20H8V22H16V20H14V18H21A2,2 0 0,0 23,16V4C23,2.89 22.1,2 21,2Z"/></svg>',
    // Appearance - palette/theme
    appearance:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5,12A1.5,1.5 0 0,1 16,10.5A1.5,1.5 0 0,1 17.5,9A1.5,1.5 0 0,1 19,10.5A1.5,1.5 0 0,1 17.5,12M14.5,8A1.5,1.5 0 0,1 13,6.5A1.5,1.5 0 0,1 14.5,5A1.5,1.5 0 0,1 16,6.5A1.5,1.5 0 0,1 14.5,8M9.5,8A1.5,1.5 0 0,1 8,6.5A1.5,1.5 0 0,1 9.5,5A1.5,1.5 0 0,1 11,6.5A1.5,1.5 0 0,1 9.5,8M6.5,12A1.5,1.5 0 0,1 5,10.5A1.5,1.5 0 0,1 6.5,9A1.5,1.5 0 0,1 8,10.5A1.5,1.5 0 0,1 6.5,12M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A1.5,1.5 0 0,0 13.5,19.5C13.5,19.11 13.35,18.76 13.11,18.5C12.88,18.23 12.73,17.88 12.73,17.5A1.5,1.5 0 0,1 14.23,16H16A5,5 0 0,0 21,11C21,6.58 16.97,3 12,3Z"/></svg>',
    // Audio - speaker
    audioVolume:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/></svg>',
    // System shortcuts - settings/panels
    systemShortcuts:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3,4H21V8H3V4M3,10H21V14H3V10M3,16H21V20H3V16Z"/></svg>',
    // Accessibility - universal symbol
    accessibility:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12,2A2,2 0 0,1 14,4A2,2 0 0,1 12,6A2,2 0 0,1 10,4A2,2 0 0,1 12,2M21,9H15V22H13V16H11V22H9V9H3V7H21V9Z"/></svg>',
    // Developer - code brackets
    developer:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8,3A2,2 0 0,0 6,5V9A2,2 0 0,1 4,11H3V13H4A2,2 0 0,1 6,15V19A2,2 0 0,0 8,21H10V19H8V14A2,2 0 0,0 6,12A2,2 0 0,0 8,10V5H10V3M16,3A2,2 0 0,1 18,5V9A2,2 0 0,0 20,11H21V13H20A2,2 0 0,0 18,15V19A2,2 0 0,1 16,21H14V19H16V14A2,2 0 0,1 18,12A2,2 0 0,1 16,10V5H14V3H16Z"/></svg>',
  };

  // === DISPLAY GROUP ===
  const displayGroup = createSettingsGroup('display', window.l10n.display, groupIcons.display);

  // Screen Orientation
  const orientationIcons = {
    auto: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12,5C16.97,5 21,7.69 21,11C21,12.68 19.96,14.2 18.29,15.29C19.36,14.42 20,13.32 20,12.13C20,9.29 16.42,7 12,7V10L8,6L12,2V5M12,19C7.03,19 3,16.31 3,13C3,11.32 4.04,9.8 5.71,8.71C4.64,9.58 4,10.68 4,11.88C4,14.71 7.58,17 12,17V14L16,18L12,22V19Z"/></svg>',
    portrait:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16,1H8A3,3 0 0,0 5,4V20A3,3 0 0,0 8,23H16A3,3 0 0,0 19,20V4A3,3 0 0,0 16,1M16,20H8V4H16V20Z"/></svg>',
    landscape:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M1,8V16A3,3 0 0,0 4,19H20A3,3 0 0,0 23,16V8A3,3 0 0,0 20,5H4A3,3 0 0,0 1,8M4,8H20V16H4V8Z"/></svg>',
  };
  const orientationControl = createCycleButton(
    'orientation',
    [
      { value: 'auto', label: window.l10n.autoRotate, icon: orientationIcons.auto },
      { value: 'portrait', label: window.l10n.portrait, icon: orientationIcons.portrait },
      { value: 'landscape', label: window.l10n.landscape, icon: orientationIcons.landscape },
    ],
    settings.orientation || 'auto',
    disabled
  );
  displayGroup.appendChild(
    createSettingsRow(
      window.l10n.orientation,
      orientationControl,
      icons.orientation,
      'icon-orientation'
    )
  );

  controlCenterContent.appendChild(displayGroup);

  // === APPEARANCE GROUP ===
  const appearanceGroup = createSettingsGroup(
    'appearance',
    window.l10n.appearance,
    groupIcons.appearance
  );

  // Dark Mode
  const darkModeIcons = {
    auto: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12,5C16.97,5 21,7.69 21,11C21,12.68 19.96,14.2 18.29,15.29C19.36,14.42 20,13.32 20,12.13C20,9.29 16.42,7 12,7V10L8,6L12,2V5M12,19C7.03,19 3,16.31 3,13C3,11.32 4.04,9.8 5.71,8.71C4.64,9.58 4,10.68 4,11.88C4,14.71 7.58,17 12,17V14L16,18L12,22V19Z"/></svg>',
    light:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,2L14.39,5.42C13.65,5.15 12.84,5 12,5C11.16,5 10.35,5.15 9.61,5.42L12,2M3.34,7L7.5,6.65C6.9,7.16 6.36,7.78 5.94,8.5C5.5,9.24 5.25,10 5.11,10.79L3.34,7M3.36,17L5.12,13.23C5.26,14 5.53,14.78 5.95,15.5C6.37,16.24 6.91,16.86 7.5,17.37L3.36,17M21,16.97L16.5,17.35C17.1,16.85 17.64,16.22 18.06,15.5C18.5,14.76 18.73,14 18.87,13.21L21,16.97M21,7L18.89,10.79C18.75,10 18.5,9.24 18.06,8.5C17.64,7.78 17.1,7.15 16.5,6.64L21,7M12,22L9.59,18.56C10.33,18.83 11.14,19 12,19C12.82,19 13.63,18.83 14.37,18.56L12,22Z"/></svg>',
    dark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17.75,4.09L15.22,6.03L16.13,9.09L13.5,7.28L10.87,9.09L11.78,6.03L9.25,4.09L12.44,4L13.5,1L14.56,4L17.75,4.09M21.25,11L19.61,12.25L20.2,14.23L18.5,13.06L16.8,14.23L17.39,12.25L15.75,11L17.81,10.95L18.5,9L19.19,10.95L21.25,11M18.97,15.95C19.8,15.87 20.69,17.05 20.16,17.8C19.84,18.25 19.5,18.67 19.08,19.07C15.17,23 8.84,23 4.94,19.07C1.03,15.17 1.03,8.83 4.94,4.93C5.34,4.53 5.76,4.17 6.21,3.85C6.96,3.32 8.14,4.21 8.06,5.04C7.79,7.9 8.75,10.87 10.95,13.06C13.14,15.26 16.1,16.22 18.97,15.95Z"/></svg>',
  };
  const darkModeControl = createCycleButton(
    'darkMode',
    [
      { value: 'auto', label: window.l10n.auto, icon: darkModeIcons.auto },
      { value: 'light', label: window.l10n.light, icon: darkModeIcons.light },
      { value: 'dark', label: window.l10n.dark, icon: darkModeIcons.dark },
    ],
    settings.darkMode,
    disabled
  );
  appearanceGroup.appendChild(
    createSettingsRow(window.l10n.darkMode, darkModeControl, icons.darkMode, 'icon-display')
  );

  // Navigation Mode - only show available modes
  const navIcons = {
    threebutton:
      '<svg viewBox="0 -960 960 960" width="16" height="16" fill="currentColor"><path d="M360-280h160q33 0 56.5-23.5T600-360v-60q0-26-17-43t-43-17q26 0 43-17t17-43v-60q0-33-23.5-56.5T520-680H360v80h160v80h-80v80h80v80H360v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></svg>',
    gestural:
      '<svg viewBox="0 -960 960 960" width="16" height="16" fill="currentColor"><path d="M245-400q-51-64-78-141t-27-159q0-27 3-54t9-54l-70 70-42-42 140-140 140 140-42 42-65-64q-7 25-10 50.5t-3 51.5q0 70 22.5 135.5T288-443l-43 43Zm413 273q-23 8-46.5 7.5T566-131L304-253l18-40q10-20 28-32.5t40-14.5l68-5-112-307q-6-16 1-30.5t23-20.5q16-6 30.5 1t20.5 23l148 407-100 7 131 61q7 3 15 3.5t15-1.5l157-57q31-11 45-41.5t3-61.5l-55-150q-6-16 1-30.5t23-20.5q16-6 30.5 1t20.5 23l55 150q23 63-4.5 122.5T815-184l-157 57Zm-90-265-54-151q-6-16 1-30.5t23-20.5q16-6 30.5 1t20.5 23l55 150-76 28Zm113-41-41-113q-6-16 1-30.5t23-20.5q16-6 30.5 1t20.5 23l41 112-75 28Zm8 78Z"/></svg>',
    twobutton:
      '<svg viewBox="0 -960 960 960" width="16" height="16" fill="currentColor"><path d="M360-280h240v-80H440v-80h80q33 0 56.5-23.5T600-520v-80q0-33-23.5-56.5T520-680H360v80h160v80h-80q-33 0-56.5 23.5T360-440v160ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></svg>',
  };
  const allNavOptions = [
    { value: 'threebutton', label: window.l10n.threeButton, icon: navIcons.threebutton },
    { value: 'gestural', label: window.l10n.gestural, icon: navIcons.gestural },
    { value: 'twobutton', label: window.l10n.twoButton, icon: navIcons.twobutton },
  ];
  const availableModes = settings.availableNavigationModes || ['threebutton', 'gestural'];
  const navOptions = allNavOptions.filter((opt) => availableModes.includes(opt.value as never)) as {
    value: string;
    label: string;
    icon: string;
  }[];
  const navModeControl = createCycleButton(
    'navigationMode',
    navOptions,
    settings.navigationMode,
    disabled
  );
  appearanceGroup.appendChild(
    createSettingsRow(window.l10n.navigationMode, navModeControl, icons.nav, 'icon-nav')
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
  appearanceGroup.appendChild(
    createSettingsRow(window.l10n.fontSize, fontScaleControl, icons.fontSize, 'icon-text')
  );

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
  appearanceGroup.appendChild(
    createSettingsRow(window.l10n.displaySize, displaySizeControl, icons.displaySize, 'icon-size')
  );

  controlCenterContent.appendChild(appearanceGroup);

  // === AUDIO & VOLUME GROUP ===
  const audioGroup = createSettingsGroup('audio', window.l10n.audioVolume, groupIcons.audioVolume);

  // Audio Forwarding
  const audioToggle = createToggleSwitch('audioEnabled', settings.audioEnabled, disabled);
  audioGroup.appendChild(
    createSettingsRow(window.l10n.audioForwarding, audioToggle, icons.audio, 'icon-audio')
  );

  // Volume buttons row
  const volumeButtonsRow = document.createElement('div');
  volumeButtonsRow.className = 'settings-button-row';
  volumeButtonsRow.appendChild(
    createActionButton('volumeDown', icons.volumeDown, window.l10n.volumeDown, disabled)
  );
  volumeButtonsRow.appendChild(
    createActionButton('volumeUp', icons.volumeUp, window.l10n.volumeUp, disabled)
  );
  audioGroup.appendChild(volumeButtonsRow);

  controlCenterContent.appendChild(audioGroup);

  // === SYSTEM SHORTCUTS GROUP ===
  const systemGroup = createSettingsGroup(
    'system',
    window.l10n.systemShortcuts,
    groupIcons.systemShortcuts
  );

  // System shortcut buttons row
  const systemButtonsRow = document.createElement('div');
  systemButtonsRow.className = 'settings-button-row';
  systemButtonsRow.appendChild(
    createActionButton(
      'notificationPanel',
      icons.notification,
      window.l10n.notificationPanel,
      disabled
    )
  );
  systemButtonsRow.appendChild(
    createActionButton('settingsPanel', icons.settingsGear, window.l10n.settingsPanel, disabled)
  );
  systemGroup.appendChild(systemButtonsRow);

  controlCenterContent.appendChild(systemGroup);

  // === ACCESSIBILITY GROUP ===
  const accessibilityGroup = createSettingsGroup(
    'accessibility',
    window.l10n.accessibility,
    groupIcons.accessibility
  );

  // TalkBack
  const talkbackToggle = createToggleSwitch('talkbackEnabled', settings.talkbackEnabled, disabled);
  accessibilityGroup.appendChild(
    createSettingsRow(window.l10n.talkback, talkbackToggle, icons.talkback, 'icon-accessibility')
  );

  controlCenterContent.appendChild(accessibilityGroup);

  // === DEVELOPER GROUP ===
  const developerGroup = createSettingsGroup(
    'developer',
    window.l10n.developer,
    groupIcons.developer
  );

  // Show Layout Bounds
  const layoutBoundsToggle = createToggleSwitch(
    'showLayoutBounds',
    settings.showLayoutBounds,
    disabled
  );
  developerGroup.appendChild(
    createSettingsRow(
      window.l10n.showLayoutBounds,
      layoutBoundsToggle,
      icons.layoutBounds,
      'icon-debug'
    )
  );

  controlCenterContent.appendChild(developerGroup);

  // Attach event handlers (only if not disabled)
  if (!disabled) {
    attachSettingsEventHandlers();
  }
}

/**
 * Attach event handlers to settings controls
 */
function attachSettingsEventHandlers() {
  if (!controlCenterContent) {
    return;
  }

  // Cycle buttons (orientation, dark mode)
  const cycleButtons = controlCenterContent.querySelectorAll('.cycle-button');
  cycleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('disabled')) {
        return;
      }

      const setting = (btn as HTMLElement).dataset.setting;
      const optionsData = (btn as HTMLElement).dataset.optionsData;
      const currentIndex = parseInt((btn as HTMLElement).dataset.currentIndex || '0', 10);

      if (!setting || !optionsData) {
        return;
      }

      const options = JSON.parse(optionsData) as { value: string; label: string; icon: string }[];
      const nextIndex = (currentIndex + 1) % options.length;
      const nextOption = options[nextIndex];

      // Update button UI
      (btn as HTMLElement).dataset.currentIndex = String(nextIndex);
      const iconSpan = btn.querySelector('.cycle-button-icon');
      const labelSpan = btn.querySelector('.cycle-button-label');

      if (iconSpan) {
        const template = document.createElement('template');
        template.innerHTML = nextOption.icon.trim();
        iconSpan.innerHTML = '';
        if (template.content.firstChild) {
          iconSpan.appendChild(template.content.firstChild);
        }
      }
      if (labelSpan) {
        labelSpan.textContent = nextOption.label;
      }

      // Clear canvas for orientation changes to avoid showing stale frame
      if (setting === 'orientation' && activeDeviceId) {
        const session = sessions.get(activeDeviceId);
        session?.videoRenderer.clear();
      }

      // Send to extension
      applyControlCenterSetting(setting, nextOption.value, btn as HTMLElement);
    });
  });

  // Action buttons (volume, notification panel, settings panel)
  const actionButtons = controlCenterContent.querySelectorAll('.settings-action-btn');
  actionButtons.forEach((btn) => {
    const action = (btn as HTMLElement).dataset.action;
    if (!action) {
      return;
    }

    // Volume buttons use pointerdown/pointerup for repeat behavior
    if (action === 'volumeDown' || action === 'volumeUp') {
      const keycode = action === 'volumeDown' ? 25 : 24; // KEYCODE_VOLUME_DOWN=25, KEYCODE_VOLUME_UP=24
      const repeatDelay = 400;
      const repeatInterval = 100;
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

      btn.addEventListener('pointerdown', (e) => {
        const event = e as PointerEvent;
        vscode.postMessage({ type: 'keyDown', keycode });
        try {
          (btn as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
          // Ignore errors from setting capture
        }

        repeatTimeout = setTimeout(() => {
          repeatIntervalId = setInterval(() => {
            vscode.postMessage({ type: 'keyDown', keycode });
          }, repeatInterval);
        }, repeatDelay);
      });

      btn.addEventListener('pointerup', (e) => {
        const event = e as PointerEvent;
        stopRepeat();
        vscode.postMessage({ type: 'keyUp', keycode });
        try {
          (btn as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {
          // Ignore errors from releasing capture
        }
      });

      btn.addEventListener('pointercancel', (e) => {
        const event = e as PointerEvent;
        stopRepeat();
        vscode.postMessage({ type: 'keyUp', keycode });
        try {
          (btn as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {
          // Ignore errors from releasing capture
        }
      });

      btn.addEventListener('pointerleave', () => {
        stopRepeat();
      });
    } else {
      // Other action buttons use simple click
      btn.addEventListener('click', () => {
        if (action === 'notificationPanel') {
          vscode.postMessage({ type: 'expandNotificationPanel' });
          closeControlCenter();
        } else if (action === 'settingsPanel') {
          vscode.postMessage({ type: 'expandSettingsPanel' });
          closeControlCenter();
        }
      });
    }
  });

  // Toggle switches - make entire row clickable
  const clickableRows = controlCenterContent.querySelectorAll('.settings-row.clickable');
  clickableRows.forEach((row) => {
    const toggle = row.querySelector('.toggle-switch');
    if (!toggle) {
      return;
    }

    const setting = (toggle as HTMLElement).dataset.setting;

    const handleToggle = (e: Event) => {
      e.stopPropagation();

      if (toggle.classList.contains('loading')) {
        return;
      }

      if (!setting) {
        return;
      }

      // Toggle UI immediately
      const newValue = !toggle.classList.contains('active');
      toggle.classList.toggle('active', newValue);

      // Handle audioEnabled specially
      if (setting === 'audioEnabled') {
        toggleMute();
        return;
      }

      // Send to extension
      applyControlCenterSetting(setting, newValue, toggle as HTMLElement);
    };

    row.addEventListener('click', handleToggle);
  });

  // Sliders
  const sliderControls = controlCenterContent.querySelectorAll('.slider-control');
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
          value = Math.round(
            (percent / 100) * (currentControlCenterSettings?.defaultDensity || 420)
          );
        } else {
          value = parseFloat(slider.value);
        }

        applyControlCenterSetting(setting, value, control as HTMLElement);
      }, 100);
    });
  });
}

/**
 * Apply a device setting
 */
function applyControlCenterSetting(setting: string, value: unknown, control: HTMLElement) {
  // Mark as pending and show loading state
  pendingSettingChanges.add(setting);
  control.classList.add('loading');

  // Update current settings and cache optimistically
  if (currentControlCenterSettings && activeDeviceId) {
    (currentControlCenterSettings as unknown as Record<string, unknown>)[setting] = value;
    controlCenterCache.set(activeDeviceId, { ...currentControlCenterSettings });
  }

  // Send to extension
  vscode.postMessage({
    type: 'applyControlCenterSetting',
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
