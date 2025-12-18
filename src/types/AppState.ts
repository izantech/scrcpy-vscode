/**
 * Centralized application state types
 *
 * This module defines the single source of truth for all application state.
 * The extension host owns this state and sends snapshots to the webview.
 */

/**
 * Error codes for tool-related errors
 */
export enum ToolErrorCode {
  SCRCPY_NOT_FOUND = 'SCRCPY_NOT_FOUND',
  ADB_NOT_FOUND = 'ADB_NOT_FOUND',
}

/**
 * Custom error class for tool-not-found errors
 */
export class ToolNotFoundError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ToolNotFoundError';
  }
}

/**
 * Connection state for a device
 */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/**
 * Video codec type
 */
export type VideoCodec = 'h264' | 'h265' | 'av1';

/**
 * Basic device information
 */
export interface DeviceInfo {
  serial: string;
  name: string;
  model?: string;
}

/**
 * Detailed device information from ADB
 */
export interface DeviceDetailedInfo {
  serial: string;
  model: string;
  manufacturer: string;
  androidVersion: string;
  sdkVersion: number;
  batteryLevel: number;
  batteryCharging: boolean;
  storageTotal: number; // bytes
  storageUsed: number; // bytes
  screenResolution: string; // e.g., "1080x2400"
  ipAddress?: string;
}

/**
 * Dark mode setting values
 */
export type DarkMode = 'auto' | 'light' | 'dark';

/**
 * Navigation mode setting values
 */
export type NavigationMode = 'gestural' | 'threebutton' | 'twobutton';

/**
 * Device UI settings that can be modified via ADB
 */
export interface DeviceUISettings {
  darkMode: DarkMode;
  navigationMode: NavigationMode;
  availableNavigationModes: NavigationMode[];
  talkbackEnabled: boolean;
  fontScale: number;
  displayDensity: number;
  defaultDensity: number;
  showLayoutBounds: boolean;
}

/**
 * State for a single device/session
 */
export interface DeviceState {
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
  videoCodec?: VideoCodec;
}

/**
 * Tool availability status
 */
export interface ToolStatus {
  adbAvailable: boolean;
  scrcpyAvailable: boolean;
}

/**
 * Settings exposed to webview
 */
export interface WebviewSettings {
  showStats: boolean;
  showExtendedStats: boolean;
  audioEnabled: boolean;
}

/**
 * Status message shown in the UI
 */
export interface StatusMessage {
  type: 'loading' | 'error' | 'empty';
  text: string;
  deviceId?: string;
}

/**
 * Complete application state (extension host side)
 */
export interface AppState {
  devices: Map<string, DeviceState>;
  activeDeviceId: string | null;
  settings: WebviewSettings;
  toolStatus: ToolStatus;
  statusMessage?: StatusMessage;
  deviceInfo: Map<string, DeviceDetailedInfo>;
  isMonitoring: boolean;
}

/**
 * Serializable state snapshot sent to webview
 * (Maps converted to arrays/records for postMessage)
 */
export interface AppStateSnapshot {
  devices: DeviceState[];
  activeDeviceId: string | null;
  settings: WebviewSettings;
  toolStatus: ToolStatus;
  statusMessage?: StatusMessage;
  deviceInfo: Record<string, DeviceDetailedInfo>;
}
