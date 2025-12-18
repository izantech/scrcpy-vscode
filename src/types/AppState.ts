/**
 * Centralized application state types
 *
 * This module defines the single source of truth for all application state.
 * The extension host owns this state and sends snapshots to the webview.
 */

import { DevicePlatform, PlatformCapabilities } from '../PlatformCapabilities';

// Re-export platform types for convenience
export type { DevicePlatform, PlatformCapabilities };

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
  platform: DevicePlatform;
  /**
   * iOS only: True if screen capture is unavailable and device was detected via Continuity Camera.
   * When true, video will show the device camera instead of the screen.
   */
  isCameraFallback?: boolean;
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
  // iOS WebDriverAgent status (Phase 8)
  wdaStatus?: 'connected' | 'connecting' | 'unavailable' | 'disabled';
}

/**
 * WDA setup process state
 */
export type WDASetupState =
  | 'idle'
  | 'checking_xcode'
  | 'checking_iproxy'
  | 'checking_device'
  | 'cloning_wda'
  | 'configuring'
  | 'building'
  | 'starting'
  | 'ready'
  | 'error'
  | 'cancelled';

/**
 * WDA setup status with UI-relevant information
 */
export interface WDASetupStatus {
  state: WDASetupState;
  message?: string;
  error?: string;
  requiresUserAction: boolean;
  userActionInstructions?: string[];
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
/**
 * Screen orientation mode
 */
export type Orientation = 'auto' | 'portrait' | 'landscape';

export interface DeviceUISettings {
  darkMode: DarkMode;
  navigationMode: NavigationMode;
  availableNavigationModes: NavigationMode[];
  talkbackEnabled: boolean;
  fontScale: number;
  displayDensity: number;
  defaultDensity: number;
  showLayoutBounds: boolean;
  orientation: Orientation;
}

/**
 * State for a single device/session
 */
export interface DeviceState {
  deviceId: string;
  serial: string;
  name: string;
  model?: string;
  platform: DevicePlatform;
  capabilities: PlatformCapabilities;
  connectionState: ConnectionState;
  isActive: boolean;
  videoDimensions?: {
    width: number;
    height: number;
  };
  videoCodec?: VideoCodec;
  /** iOS only: true when device screen is off/locked */
  isScreenOff?: boolean;
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
  type: 'loading' | 'error' | 'empty' | 'info';
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
  allowedAutoConnectDevices: Set<string>;
  blockedAutoConnectDevices: Set<string>;
  controlCenterCache: Record<string, DeviceUISettings>;
  /** WDA setup status per device (iOS only) */
  wdaSetupStatus: Map<string, WDASetupStatus>;
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
  // We don't necessarily need to send this to the webview, but keeping it in snapshot for consistency
  // allowedAutoConnectDevices is internal logic, but maybe useful for debug?
  // Let's exclude it from snapshot sent to webview for now if not needed by UI,
  // or include it if we want to visualize it.
  // The prompt says "The whole app state must be handled using AppStateManager".
  // Snapshot is what is sent to webview.
  // I'll add it to the snapshot but as an array.
  allowedAutoConnectDevices: string[];
  blockedAutoConnectDevices: string[];
  controlCenterCache: Record<string, DeviceUISettings>;
  /** WDA setup status per device (iOS only) */
  wdaSetupStatus: Record<string, WDASetupStatus>;
}
