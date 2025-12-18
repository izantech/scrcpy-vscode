/**
 * Webview action types
 *
 * All actions the webview can dispatch to the extension host.
 * The webview sends these typed actions instead of managing state locally.
 */

import type { DeviceUISettings } from './AppState';

/**
 * Touch action type
 */
export type TouchAction = 'down' | 'move' | 'up';

/**
 * Keycode action type
 */
export type KeycodeAction = 'down' | 'up';

/**
 * All actions the webview can dispatch to the extension
 */
export type WebviewAction =
  // Lifecycle
  | { type: 'ready' }

  // Tab/Session management
  | { type: 'switchTab'; deviceId: string }
  | { type: 'closeTab'; deviceId: string }
  | { type: 'showDevicePicker' }
  | { type: 'reconnect' }
  | { type: 'connectDevice'; serial: string }

  // Touch/Mouse input
  | {
      type: 'touch';
      deviceId: string;
      x: number;
      y: number;
      action: TouchAction;
      screenWidth: number;
      screenHeight: number;
    }
  | {
      type: 'scroll';
      deviceId: string;
      x: number;
      y: number;
      deltaX: number;
      deltaY: number;
      screenWidth: number;
      screenHeight: number;
    }
  | {
      type: 'multiTouch';
      deviceId: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      action: TouchAction;
      screenWidth: number;
      screenHeight: number;
    }

  // Keyboard input (hardware buttons)
  | { type: 'keyDown'; keycode: number }
  | { type: 'keyUp'; keycode: number }

  // Text/Keycode injection
  | { type: 'injectText'; deviceId: string; text: string }
  | {
      type: 'injectKeycode';
      deviceId: string;
      keycode: number;
      metastate: number;
      action: KeycodeAction;
    }

  // Clipboard
  | { type: 'pasteFromHost'; deviceId: string }
  | { type: 'copyToHost'; deviceId: string }

  // Device control
  | { type: 'rotateDevice' }
  | { type: 'expandNotificationPanel' }
  | { type: 'expandSettingsPanel' }
  | { type: 'collapsePanels' }

  // Screenshots
  | { type: 'screenshot' }
  | { type: 'saveScreenshot'; base64Data: string }

  // Recording
  | { type: 'getRecordingSettings' }
  | { type: 'toggleRecording' }
  | { type: 'saveRecording'; data: number[]; mimeType: string; duration: number }

  // Audio
  | { type: 'toggleAudio' }

  // Settings/Navigation
  | { type: 'openSettings' }
  | { type: 'openInstallDocs' }
  | { type: 'browseScrcpyPath' }
  | { type: 'browseAdbPath' }
  | { type: 'resetScrcpyPath' }
  | { type: 'resetAdbPath' }

  // Device info
  | { type: 'getDeviceInfo'; serial: string }

  // Dimension updates (from video parsing)
  | { type: 'dimensionsChanged'; deviceId: string; width: number; height: number }

  // Control Center
  | { type: 'openControlCenter' }
  | {
      type: 'applyControlCenterSetting';
      setting: keyof DeviceUISettings;
      value: DeviceUISettings[keyof DeviceUISettings];
    };

/**
 * Type guard to check if an object is a WebviewAction
 */
export function isWebviewAction(obj: unknown): obj is WebviewAction {
  return typeof obj === 'object' && obj !== null && 'type' in obj;
}
