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
    };
  }
}

/**
 * Session info from extension
 */
interface SessionInfo {
  deviceId: string;
  deviceInfo: {
    serial: string;
    name: string;
  };
  isActive: boolean;
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

// Device sessions
const sessions = new Map<string, DeviceSessionUI>();
let activeDeviceId: string | null = null;
let showStats = false;
let showExtendedStats = false;
let isMuted = false;
let muteBtn: HTMLElement | null = null;
let rotateBtn: HTMLElement | null = null;
let screenshotBtn: HTMLElement | null = null;
let recordBtn: HTMLElement | null = null;
let recordingIndicator: HTMLElement | null = null;
let recordingTime: HTMLElement | null = null;
let isPortrait = true;

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

  // Mute button
  muteBtn = document.getElementById('mute-btn');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      toggleMute();
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

  // Notification panel button
  const notificationPanelBtn = document.getElementById('notification-panel-btn');
  if (notificationPanelBtn) {
    notificationPanelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'expandNotificationPanel' });
    });
  }

  // Settings panel button
  const settingsPanelBtn = document.getElementById('settings-panel-btn');
  if (settingsPanelBtn) {
    settingsPanelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'expandSettingsPanel' });
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
    // Update button to show record icon (circle)
    recordBtn.classList.remove('recording');
    recordBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>`;
    recordBtn.title = window.l10n.startRecording;

    // Hide recording indicator
    recordingIndicator.classList.add('hidden');
    recordingTime.textContent = '00:00';
  }
}

/**
 * Handle recording settings from extension
 */
function handleRecordingSettings(message: { format: 'webm' | 'mp4'; isRecording: boolean }): void {
  if (!activeDeviceId) {
    return;
  }

  const session = sessions.get(activeDeviceId);
  if (!session) {
    return;
  }

  // Toggle recording based on current state
  if (message.isRecording) {
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

  // Update button icon
  if (muteBtn) {
    muteBtn.innerHTML = audioEnabled ? '&#x1F50A;' : '&#x1F507;'; // 🔊 : 🔇
    muteBtn.title = audioEnabled ? window.l10n.disableAudio : window.l10n.enableAudio;
  }
}

/**
 * Handle messages from the extension
 */
function handleMessage(event: MessageEvent) {
  const message = event.data;

  switch (message.type) {
    case 'videoFrame':
      handleVideoFrame(message);
      break;

    case 'audioFrame':
      handleAudioFrame(message);
      break;

    case 'status':
      handleStatus(message);
      break;

    case 'error':
      handleError(message);
      break;

    case 'sessionList':
      updateSessionList(message.sessions);
      break;

    case 'settings':
      handleSettings(message);
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
  }
}

/**
 * Handle video frame from extension
 */
function handleVideoFrame(message: {
  deviceId: string;
  data: number[];
  isConfig: boolean;
  isKeyFrame: boolean;
  width?: number;
  height?: number;
}) {
  const session = sessions.get(message.deviceId);
  if (!session) {
    return;
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
  if (message.data && message.data.length > 0) {
    const frameData = new Uint8Array(message.data);
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
function handleAudioFrame(message: { deviceId: string; data: number[]; isConfig: boolean }) {
  const session = sessions.get(message.deviceId);
  if (!session) {
    console.warn('AudioFrame: no session found for device', message.deviceId);
    return;
  }

  // Initialize audio renderer on first frame (config signal)
  if (message.isConfig && message.data.length === 0) {
    console.log('AudioFrame: initializing audio renderer for', message.deviceId);
    session.audioRenderer.initialize();
    return;
  }

  // Push frame data
  if (message.data && message.data.length > 0) {
    const frameData = new Uint8Array(message.data);
    session.audioRenderer.pushFrame(frameData, message.isConfig);
  }
}

/**
 * Handle status message
 */
function handleStatus(message: { deviceId?: string; message: string }) {
  showStatus(message.message);
}

/**
 * Handle error message
 */
function handleError(message: { deviceId?: string; message: string }) {
  showError(message.message);
}

/**
 * Handle settings update from extension
 */
function handleSettings(message: {
  showStats?: boolean;
  showExtendedStats?: boolean;
  audioEnabled?: boolean;
}) {
  if (message.showStats !== undefined) {
    showStats = message.showStats;
    // Update all existing renderers
    sessions.forEach((session) => {
      session.videoRenderer.setStatsEnabled(showStats);
    });
    // Hide stats element if disabled
    if (!showStats) {
      statsElement.classList.add('hidden');
    }
  }

  if (message.showExtendedStats !== undefined) {
    showExtendedStats = message.showExtendedStats;
    // Update stats display style
    if (showExtendedStats) {
      statsElement.classList.add('extended');
    } else {
      statsElement.classList.remove('extended');
    }
  }

  if (message.audioEnabled !== undefined) {
    updateAudioState(message.audioEnabled);
  }
}

/**
 * Update session list (tabs)
 */
function updateSessionList(sessionList: SessionInfo[]) {
  // Create or update tabs for each session
  for (const sessionInfo of sessionList) {
    let session = sessions.get(sessionInfo.deviceId);

    if (!session) {
      // Create new session UI
      session = createDeviceSession(sessionInfo.deviceId, sessionInfo.deviceInfo);
    }
  }

  // Remove sessions that no longer exist
  const currentIds = new Set(sessionList.map((s) => s.deviceId));
  for (const [deviceId] of sessions) {
    if (!currentIds.has(deviceId)) {
      removeDeviceSession(deviceId);
    }
  }

  // Switch to the active device (always call to ensure proper state)
  const activeSession = sessionList.find((s) => s.isActive);
  if (activeSession) {
    switchToDevice(activeSession.deviceId);
  }

  // Show tab bar if we have sessions
  if (sessionList.length > 0) {
    tabBar.classList.remove('hidden');
  }
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

  // Determine connection type and icon
  const isWifi = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(deviceInfo.serial);

  const icon = isWifi
    ? `<svg class="tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12,21L15.6,16.2C14.6,15.45 13.35,15 12,15C10.65,15 9.4,15.45 8.4,16.2L12,21M12,3C7.95,3 4.21,4.34 1.2,6.6L3,9C5.5,7.12 8.62,6 12,6C15.38,6 18.5,7.12 21,9L22.8,6.6C19.79,4.34 16.05,3 12,3M12,9C9.3,9 6.81,9.89 4.8,11.4L6.6,13.8C8.1,12.67 9.97,12 12,12C14.03,12 15.9,12.67 17.4,13.8L19.2,11.4C17.19,9.89 14.7,9 12,9Z" /></svg>`
    : `<svg class="tab-icon" width="14" height="14" viewBox="0 0 193 193" fill="currentColor"><path d="M81.114 37.464l16.415-28.96 16.834 28.751-12.164.077-.174 70.181c.988-.552 2.027-1.09 3.096-1.643 6.932-3.586 15.674-8.11 15.998-28.05h-8.533V53.251h24.568V77.82h-7.611c-.334 25.049-11.627 30.892-20.572 35.519-3.232 1.672-6.012 3.111-6.975 5.68l-.09 36.683a14.503 14.503 0 0 1 10.68 14.02 14.5 14.5 0 0 1-14.533 14.532 14.5 14.5 0 0 1-14.533-14.532 14.504 14.504 0 0 1 9.454-13.628l.057-22.801c-2.873-1.613-5.62-2.704-8.139-3.705-11.142-4.43-18.705-7.441-18.857-33.4a14.381 14.381 0 0 1-10.43-13.869c0-7.946 6.482-14.428 14.428-14.428 7.946 0 14.428 6.482 14.428 14.428 0 6.488-4.21 11.889-10.004 13.74.116 20.396 5.54 22.557 13.528 25.732 1.61.641 3.303 1.312 5.069 2.114l.214-86.517-12.154.076z"/></svg>`;

  tab.innerHTML = `
    ${icon}
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
  statusTextElement.textContent = window.l10n.noDevicesConnected;
  statusTextElement.classList.remove('error');
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

  // Show empty icon
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
  emptyIcon.style.display = 'block';

  // Remove existing buttons
  let btnContainer = statusElement.querySelector('.button-container') as HTMLElement;
  if (btnContainer) {
    btnContainer.remove();
  }

  // Create button container with add device button
  btnContainer = document.createElement('div');
  btnContainer.className = 'button-container';
  btnContainer.style.cssText =
    'display: flex; gap: 8px; justify-content: center; margin-top: 12px;';
  statusElement.appendChild(btnContainer);

  const addBtn = document.createElement('button');
  addBtn.className = 'reconnect-btn';
  addBtn.textContent = window.l10n.addDevice;
  addBtn.onclick = () => {
    vscode.postMessage({ type: 'showDevicePicker' });
  };
  btnContainer.appendChild(addBtn);

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

  // Format battery icon
  const batteryIcon = batteryCharging ? '🔌' : '🔋';

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

  if (batteryLevel > 0) {
    content += `<div class="info-row">${batteryIcon} ${batteryLevel}%`;
    if (batteryCharging) {
      content += ' (charging)';
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

  content += '</div>';
  deviceInfoTooltip.innerHTML = content;
}

/**
 * Attach tooltip handlers to a tab
 */
function attachTooltipHandlers(tab: HTMLElement, serial: string) {
  // Show tooltip on hover (but not on close button)
  tab.addEventListener('mouseenter', (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('tab-close')) {
      showDeviceInfoTooltip(tab, serial);
    }
  });

  tab.addEventListener('mouseleave', () => {
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

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// Listen for messages from extension
window.addEventListener('message', handleMessage);
