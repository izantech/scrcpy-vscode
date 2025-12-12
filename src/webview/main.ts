import { VideoRenderer } from './VideoRenderer';
import { InputHandler } from './InputHandler';

// VS Code API interface
interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

// Global state
let vscode: VSCodeAPI;
let videoRenderer: VideoRenderer;
let inputHandler: InputHandler;
let canvas: HTMLCanvasElement;
let statusElement: HTMLElement;
let statusTextElement: HTMLElement;
let statsElement: HTMLElement;

/**
 * Initialize the WebView
 */
function initialize() {
  // Get VS Code API
  vscode = acquireVsCodeApi();

  // Get DOM elements
  canvas = document.getElementById('screen') as HTMLCanvasElement;
  statusElement = document.getElementById('status') as HTMLElement;
  statusTextElement = document.getElementById('status-text') as HTMLElement;
  statsElement = document.getElementById('stats') as HTMLElement;

  if (!canvas || !statusElement || !statusTextElement) {
    console.error('Required DOM elements not found');
    return;
  }

  // Initialize video renderer
  videoRenderer = new VideoRenderer(canvas, (fps, frames) => {
    statsElement.textContent = `${fps} FPS | ${frames} frames`;
    statsElement.classList.remove('hidden');
  });

  // Initialize input handler
  inputHandler = new InputHandler(canvas, (x, y, action) => {
    vscode.postMessage({
      type: 'touch',
      x,
      y,
      action,
      screenWidth: canvas.width,
      screenHeight: canvas.height
    });
  });

  // Notify extension that webview is ready
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
      showStatus(message.message);
      break;

    case 'error':
      showError(message.message);
      break;
  }
}

/**
 * Handle video frame from extension
 */
function handleVideoFrame(message: {
  data: number[];
  isConfig: boolean;
  width?: number;
  height?: number;
}) {
  // Hide status on first frame
  if (message.width && message.height) {
    // Initial config with dimensions
    videoRenderer.configure(message.width, message.height);
    hideStatus();
  }

  if (message.data && message.data.length > 0) {
    const frameData = new Uint8Array(message.data);
    videoRenderer.pushFrame(frameData, message.isConfig);
  }
}

/**
 * Show status message
 */
function showStatus(text: string) {
  statusTextElement.textContent = text;
  statusTextElement.classList.remove('error');
  statusElement.classList.remove('hidden');

  // Remove reconnect button if exists
  const btn = statusElement.querySelector('.reconnect-btn');
  if (btn) {
    btn.remove();
  }
}

/**
 * Show error message with reconnect button
 */
function showError(text: string) {
  statusTextElement.textContent = text;
  statusTextElement.classList.add('error');

  // Hide spinner
  const spinner = statusElement.querySelector('.spinner') as HTMLElement;
  if (spinner) {
    spinner.style.display = 'none';
  }

  // Add reconnect button if not exists
  if (!statusElement.querySelector('.reconnect-btn')) {
    const btn = document.createElement('button');
    btn.className = 'reconnect-btn';
    btn.textContent = 'Reconnect';
    btn.onclick = () => {
      vscode.postMessage({ type: 'reconnect' });
      showStatus('Reconnecting...');
      if (spinner) {
        spinner.style.display = 'block';
      }
    };
    statusElement.appendChild(btn);
  }

  statusElement.classList.remove('hidden');
}

/**
 * Hide status overlay
 */
function hideStatus() {
  statusElement.classList.add('hidden');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// Listen for messages from extension
window.addEventListener('message', handleMessage);
