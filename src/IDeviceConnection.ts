/**
 * Device connection interface - abstraction for Android (scrcpy) and iOS (CoreMediaIO) connections
 */

import { DevicePlatform, PlatformCapabilities } from './PlatformCapabilities';

// Re-export for convenience
export { DevicePlatform } from './PlatformCapabilities';

/**
 * Video codec types supported across platforms
 */
export type VideoCodecType = 'h264' | 'h265' | 'av1';

/**
 * Device information
 */
export interface DeviceInfo {
  serial: string;
  name: string;
  model?: string;
  platform: DevicePlatform;
}

/**
 * Detailed device information (extended for display purposes)
 */
export interface DeviceDetailedInfo extends DeviceInfo {
  manufacturer?: string;
  osVersion?: string;
  sdkVersion?: number;
  batteryLevel?: number;
  isCharging?: boolean;
  storageUsed?: number;
  storageTotal?: number;
  resolution?: string;
  ipAddress?: string;
}

/**
 * Callback for video frames
 */
export type VideoFrameCallback = (
  data: Uint8Array,
  isConfig: boolean,
  isKeyFrame: boolean,
  width?: number,
  height?: number,
  codec?: VideoCodecType
) => void;

/**
 * Callback for audio frames
 */
export type AudioFrameCallback = (data: Uint8Array, isConfig: boolean) => void;

/**
 * Callback for status updates
 */
export type StatusCallback = (status: string) => void;

/**
 * Callback for errors/disconnections
 */
export type ErrorCallback = (message: string) => void;

/**
 * Callback for clipboard changes
 */
export type ClipboardCallback = (text: string) => void;

/**
 * Clipboard API interface
 */
export interface ClipboardAPI {
  readText(): Thenable<string>;
  writeText(text: string): Thenable<void>;
}

/**
 * Common streaming configuration (platform-agnostic)
 */
export interface StreamConfig {
  maxSize?: number;
  bitRate?: number;
  maxFps?: number;
  videoCodec?: VideoCodecType;
  audio?: boolean;
}

/**
 * Interface for device connections
 *
 * Implemented by:
 * - ScrcpyConnection (Android devices via ADB)
 * - iOSConnection (iOS devices via CoreMediaIO, macOS only)
 */
export interface IDeviceConnection {
  /**
   * Platform this connection is for
   */
  readonly platform: DevicePlatform;

  /**
   * Capabilities of the connected device's platform
   */
  readonly capabilities: PlatformCapabilities;

  /**
   * Whether the connection is currently active
   */
  readonly connected: boolean;

  /**
   * Device dimensions (width x height)
   */
  readonly deviceWidth: number;
  readonly deviceHeight: number;

  // Callbacks
  onVideoFrame?: VideoFrameCallback;
  onAudioFrame?: AudioFrameCallback;
  onStatus?: StatusCallback;
  onError?: ErrorCallback;
  onClipboardChange?: ClipboardCallback;

  /**
   * Connect to the device
   */
  connect(targetSerial?: string): Promise<void>;

  /**
   * Start streaming video/audio from the device
   */
  startStreaming(config: StreamConfig): Promise<void>;

  /**
   * Disconnect from the device
   */
  disconnect(): void;

  /**
   * Get device serial number
   */
  getDeviceSerial(): string | null;

  /**
   * Get basic device info
   */
  getDeviceInfo(): DeviceInfo | null;

  // Input methods (may not be supported on all platforms)

  /**
   * Send touch event
   */
  sendTouch?(action: number, x: number, y: number, pointerId?: number): void;

  /**
   * Send scroll event
   */
  sendScroll?(x: number, y: number, dx: number, dy: number): void;

  /**
   * Send key event
   */
  sendKey?(action: number, keycode: number, metastate?: number): void;

  /**
   * Inject text
   */
  injectText?(text: string): void;

  /**
   * Request device rotation
   */
  rotate?(): void;

  // Clipboard (may not be supported on all platforms)

  /**
   * Paste text from host to device
   */
  pasteFromHost?(text: string): void;

  /**
   * Request clipboard content from device
   */
  copyToHost?(): void;

  // Screenshot

  /**
   * Take a screenshot
   */
  takeScreenshot?(): Promise<Buffer | null>;
}
