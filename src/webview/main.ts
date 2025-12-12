import { VideoRenderer } from './VideoRenderer';
import { InputHandler } from './InputHandler';

// VS Code API interface
interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

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
  inputHandler: InputHandler;
  tabElement: HTMLElement;
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

  if (!canvasContainer || !tabBar || !statusElement || !statusTextElement) {
    console.error('Required DOM elements not found');
    return;
  }

  // Set up control toolbar
  if (controlToolbar) {
    const buttons = controlToolbar.querySelectorAll('.control-btn');
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const keycode = parseInt((button as HTMLElement).dataset.keycode || '0', 10);
        if (keycode) {
          vscode.postMessage({ type: 'keyEvent', keycode });
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

  vscode.postMessage({ type: 'ready' });
  console.log('WebView initialized');
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

    case 'status':
      handleStatus(message);
      break;

    case 'error':
      handleError(message);
      break;

    case 'sessionList':
      updateSessionList(message.sessions);
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
  width?: number;
  height?: number;
}) {
  const session = sessions.get(message.deviceId);
  if (!session) return;

  // Configure renderer with dimensions
  if (message.width && message.height) {
    session.videoRenderer.configure(message.width, message.height);

    // Show UI elements on first frame
    tabBar.classList.remove('hidden');
    hideStatus();
    if (controlToolbar) {
      controlToolbar.classList.remove('hidden');
    }
  }

  // Push frame data
  if (message.data && message.data.length > 0) {
    const frameData = new Uint8Array(message.data);
    session.videoRenderer.pushFrame(frameData, message.isConfig);
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

    // Update tab active state
    if (sessionInfo.isActive) {
      if (activeDeviceId !== sessionInfo.deviceId) {
        switchToDevice(sessionInfo.deviceId);
      }
      session.tabElement.classList.add('active');
    } else {
      session.tabElement.classList.remove('active');
    }
  }

  // Remove sessions that no longer exist
  const currentIds = new Set(sessionList.map(s => s.deviceId));
  for (const [deviceId] of sessions) {
    if (!currentIds.has(deviceId)) {
      removeDeviceSession(deviceId);
    }
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
  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = `canvas-${deviceId}`;
  canvas.className = 'device-canvas hidden';
  canvasContainer.appendChild(canvas);

  // Create video renderer
  const videoRenderer = new VideoRenderer(canvas, (fps, frames) => {
    if (deviceId === activeDeviceId) {
      statsElement.textContent = `${fps} FPS | ${frames} frames`;
      statsElement.classList.remove('hidden');
    }
  });

  // Create input handler
  const inputHandler = new InputHandler(canvas, (x, y, action) => {
    if (deviceId === activeDeviceId) {
      vscode.postMessage({
        type: 'touch',
        deviceId,
        x,
        y,
        action,
        screenWidth: canvas.width,
        screenHeight: canvas.height
      });
    }
  });

  // Create tab element
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.deviceId = deviceId;
  tab.innerHTML = `
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

  // Insert tab before add button
  tabBar.insertBefore(tab, addDeviceBtn);

  const session: DeviceSessionUI = {
    deviceId,
    deviceInfo,
    canvas,
    videoRenderer,
    inputHandler,
    tabElement: tab
  };

  sessions.set(deviceId, session);
  return session;
}

/**
 * Remove device session UI
 */
function removeDeviceSession(deviceId: string) {
  const session = sessions.get(deviceId);
  if (!session) return;

  // Cleanup
  session.videoRenderer.dispose();
  session.inputHandler.dispose();
  session.canvas.remove();
  session.tabElement.remove();

  sessions.delete(deviceId);

  // If was active, clear active state
  if (activeDeviceId === deviceId) {
    activeDeviceId = null;
    statsElement.classList.add('hidden');
  }

  // Hide UI and show status if no more sessions
  if (sessions.size === 0) {
    tabBar.classList.add('hidden');
    controlToolbar.classList.add('hidden');
    showStatus('No devices connected.\nClick + to add a device.');
  }
}

/**
 * Switch to a device (show its canvas)
 */
function switchToDevice(deviceId: string) {
  const newSession = sessions.get(deviceId);
  if (!newSession) return;

  // Pause and hide old active canvas
  if (activeDeviceId && activeDeviceId !== deviceId) {
    const oldSession = sessions.get(activeDeviceId);
    if (oldSession) {
      oldSession.canvas.classList.add('hidden');
      oldSession.tabElement.classList.remove('active');
      oldSession.videoRenderer.pause();
    }
  }

  // Show and resume new canvas
  activeDeviceId = deviceId;
  newSession.canvas.classList.remove('hidden');
  newSession.tabElement.classList.add('active');
  newSession.videoRenderer.resume();
}

/**
 * Show status message
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
  sessions.forEach(s => s.canvas.classList.add('hidden'));
  if (controlToolbar) {
    controlToolbar.classList.add('hidden');
  }

  // Hide spinner
  const spinner = statusElement.querySelector('.spinner') as HTMLElement;
  if (spinner) {
    spinner.style.display = 'none';
  }

  // Remove existing buttons
  let btnContainer = statusElement.querySelector('.button-container') as HTMLElement;
  if (btnContainer) {
    btnContainer.remove();
  }

  // Create button container
  btnContainer = document.createElement('div');
  btnContainer.className = 'button-container';
  btnContainer.style.cssText = 'display: flex; gap: 8px; justify-content: center; margin-top: 12px; flex-wrap: wrap;';
  statusElement.appendChild(btnContainer);

  // Add browse path button
  const browseBtn = document.createElement('button');
  browseBtn.className = 'reconnect-btn';
  browseBtn.textContent = 'Browse...';
  browseBtn.title = 'Select scrcpy installation folder';
  browseBtn.onclick = () => {
    vscode.postMessage({ type: 'browseScrcpyPath' });
  };
  btnContainer.appendChild(browseBtn);

  // Add reset path button
  const resetBtn = document.createElement('button');
  resetBtn.className = 'reconnect-btn';
  resetBtn.textContent = 'Reset Path';
  resetBtn.title = 'Reset scrcpy path to default (use PATH)';
  resetBtn.onclick = () => {
    vscode.postMessage({ type: 'resetScrcpyPath' });
  };
  btnContainer.appendChild(resetBtn);

  // Add reconnect button
  const reconnectBtn = document.createElement('button');
  reconnectBtn.className = 'reconnect-btn';
  reconnectBtn.textContent = 'Reconnect';
  reconnectBtn.onclick = () => {
    vscode.postMessage({ type: 'reconnect' });
    showStatus('Reconnecting...');
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
