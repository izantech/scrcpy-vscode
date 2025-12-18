/**
 * iOS device connection via CoreMediaIO/AVFoundation
 * macOS only - uses Swift CLI helper to capture screen
 *
 * Phase 8: Added WebDriverAgent support for input control
 */

import { execFile, spawn, ChildProcess } from 'child_process';
import {
  IDeviceConnection,
  DeviceInfo,
  VideoFrameCallback,
  AudioFrameCallback,
  StatusCallback,
  ErrorCallback,
  StreamConfig,
  VideoCodecType,
} from '../IDeviceConnection';
import { DevicePlatform, IOS_CAPABILITIES, PlatformCapabilities } from '../PlatformCapabilities';
import { WDAClient } from './WDAClient';
import { iOSDeviceManager } from './iOSDeviceManager';
import { resolveIOSHelperPath } from './iosHelperPath';

/**
 * iOS connection configuration
 */
export interface iOSConnectionConfig {
  enabled: boolean;
  webDriverAgentEnabled: boolean;
  webDriverAgentPort: number;
}

/**
 * Message types from the iOS helper binary protocol
 */
enum MessageType {
  DEVICE_LIST = 0x01,
  DEVICE_INFO = 0x02,
  VIDEO_CONFIG = 0x03,
  VIDEO_FRAME = 0x04,
  ERROR = 0x05,
  STATUS = 0x06,
  SCREENSHOT = 0x07,
}

/**
 * iOS device connection using CoreMediaIO via Swift CLI helper
 * Supports optional WebDriverAgent for touch/keyboard control (Phase 8)
 */
export class iOSConnection implements IDeviceConnection {
  readonly platform: DevicePlatform = 'ios';

  // Mutable capabilities - updated based on WDA availability
  private _capabilities: PlatformCapabilities = { ...IOS_CAPABILITIES };

  private helperProcess: ChildProcess | null = null;
  private deviceSerial: string | null = null;
  private _deviceInfo: DeviceInfo | null = null;
  private _connected = false;
  private _deviceWidth = 0;
  private _deviceHeight = 0;
  private messageBuffer = Buffer.alloc(0);
  private _frameLogged = false;
  private readonly videoSource: 'display' | 'camera';

  // Frame timeout detection (for screen off state)
  private lastFrameTime = 0;
  private hasReceivedFirstFrame = false;
  private frameTimeoutTimer: ReturnType<typeof setInterval> | null = null;
  private captureStartedTime = 0;
  private screenOffNotified = false;

  // WebDriverAgent integration (Phase 8)
  private wdaClient: WDAClient | null = null;
  private wdaReady = false;
  private wdaUnavailable = false;
  private iproxyProcess: ChildProcess | null = null;
  private readonly wdaEnabled: boolean;
  private readonly wdaPort: number;
  private resolvedWdaUdid: string | null = null;
  private wdaScreenWidth = 0;
  private wdaScreenHeight = 0;

  // Callbacks
  onVideoFrame?: VideoFrameCallback;
  onAudioFrame?: AudioFrameCallback;
  onStatus?: StatusCallback;
  onError?: ErrorCallback;
  onClipboardChange?: (text: string) => void;
  onCapabilitiesChanged?: (capabilities: PlatformCapabilities) => void;

  constructor(
    private targetUDID?: string,
    private customHelperPath?: string,
    config?: iOSConnectionConfig,
    videoSource: 'display' | 'camera' = 'display'
  ) {
    this.wdaEnabled = config?.webDriverAgentEnabled ?? false;
    this.wdaPort = config?.webDriverAgentPort ?? 8100;
    this.videoSource = videoSource;
  }

  /**
   * Get current capabilities (may change based on WDA availability)
   */
  get capabilities(): PlatformCapabilities {
    return this._capabilities;
  }

  get connected(): boolean {
    return this._connected;
  }

  get deviceWidth(): number {
    return this._deviceWidth;
  }

  get deviceHeight(): number {
    return this._deviceHeight;
  }

  async connect(targetSerial?: string): Promise<void> {
    this.deviceSerial = targetSerial || this.targetUDID || null;

    // Validate we're on macOS
    if (process.platform !== 'darwin') {
      throw new Error('iOS support is only available on macOS');
    }

    if (!this.deviceSerial) {
      throw new Error('No device serial specified');
    }
  }

  async startStreaming(_config: StreamConfig): Promise<void> {
    if (!this.deviceSerial) {
      throw new Error('No device serial specified');
    }

    // Kill any previous streaming helpers to avoid conflicts on reload
    iOSDeviceManager.killStaleHelpers?.('stream');

    const helperPath = this.getHelperPath();
    console.log('[iOSConnection] Starting stream for device:', this.deviceSerial);

    if (this.videoSource === 'camera') {
      this.onStatus?.('Starting iOS camera capture...');
    } else {
      this.onStatus?.('Starting iOS screen capture...');
    }

    // If helper is a JS file, run with node
    const isNodeScript = helperPath.endsWith('.js');
    const command = isNodeScript ? 'node' : helperPath;
    const args = isNodeScript
      ? [helperPath, 'stream', this.deviceSerial]
      : ['stream', this.deviceSerial];
    console.log('[iOSConnection] Running:', command, args);

    this.helperProcess = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.helperProcess.stdout?.on('data', (chunk: Buffer) => {
      this.handleHelperData(chunk);
    });

    this.helperProcess.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        console.error('[ios-helper]', message);
      }
    });

    this.helperProcess.on('error', (err) => {
      this._connected = false;
      this.onError?.(err.message);
    });

    this.helperProcess.on('close', (code) => {
      this._connected = false;
      if (code !== 0 && code !== null) {
        this.onError?.(`iOS helper exited with code ${code}`);
      }
    });

    this._connected = true;

    // Initialize WebDriverAgent if enabled (Phase 8)
    // Non-blocking: screen mirroring functions independently of WDA
    if (this.wdaEnabled) {
      void this.initializeWDA();
    }
  }

  /**
   * Manually start WebDriverAgent (used when automatic init is suppressed)
   */
  async startWda(): Promise<boolean> {
    // Allow manual retry even after prior failures
    this.wdaUnavailable = false;
    return this.initializeWDA(true);
  }

  /**
   * Initialize WebDriverAgent connection via iproxy
   */
  private async initializeWDA(force = false): Promise<boolean> {
    if (!this.deviceSerial || !this.wdaEnabled) {
      return false;
    }

    if (this.wdaUnavailable && !force) {
      this.onStatus?.('WDA: Unavailable (manual start required)');
      return false;
    }

    this.onStatus?.('Initializing WebDriverAgent...');
    this.wdaReady = false;
    this.wdaUnavailable = false;

    // Create WDA client and check status
    this.wdaClient = new WDAClient('localhost', this.wdaPort);

    // First try connecting directly. If the user is already running `iproxy` (via the setup script),
    // the port is already forwarded and we don't need to start our own iproxy process.
    try {
      const status = await this.wdaClient.checkStatus();
      if (status?.ready !== false) {
        // Pre-create session to avoid latency on first touch
        await this.wdaClient.initSession();
        this.wdaReady = true;
        this.wdaUnavailable = false;
        this.updateCapabilities(true);
        await this.refreshWdaWindowSize();
        this.onStatus?.('WDA: Connected, input enabled');
        return true;
      } else {
        this.onStatus?.('WDA: Not ready, input disabled');
        this.wdaUnavailable = true;
        this.wdaClient = null;
        this.updateCapabilities(false);
        this.stopIproxy();
        return false;
      }
    } catch (error) {
      console.log('[WDA] Direct connection unavailable, trying iproxy...');
    }

    // Fall back to starting iproxy (best-effort).
    const iproxyStarted = await this.startIproxy();
    if (!iproxyStarted) {
      this.onStatus?.('WDA: iproxy not available, input disabled');
      this.wdaUnavailable = true;
      this.wdaClient = null;
      this.updateCapabilities(false);
      return false;
    }

    // Give iproxy a moment to establish the connection
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      const wdaClient = this.wdaClient;
      if (!wdaClient) {
        this.onStatus?.('WDA: Client not available, input disabled');
        this.wdaUnavailable = true;
        this.updateCapabilities(false);
        this.stopIproxy();
        return false;
      }

      const status = await wdaClient.checkStatus();
      if (status?.ready !== false) {
        // Pre-create session to avoid latency on first touch
        await wdaClient.initSession();
        this.wdaReady = true;
        this.wdaUnavailable = false;
        this.updateCapabilities(true);
        await this.refreshWdaWindowSize();
        this.onStatus?.('WDA: Connected, input enabled');
        return true;
      } else {
        this.onStatus?.('WDA: Not ready, input disabled');
        this.wdaUnavailable = true;
        this.wdaClient = null;
        this.updateCapabilities(false);
        this.stopIproxy();
        return false;
      }
    } catch (error) {
      console.error('[WDA] Connection failed:', error);
      this.onStatus?.('WDA: Connection failed, input disabled');
      this.wdaUnavailable = true;
      this.wdaClient = null;
      this.updateCapabilities(false);
      this.stopIproxy();
      return false;
    }
  }

  /**
   * Start iproxy to forward WDA port from device to localhost
   */
  private async startIproxy(): Promise<boolean> {
    const deviceUdid = await this.resolveWdaDeviceUdid();
    if (!deviceUdid) {
      this.onStatus?.(
        'WDA: No iOS UDID available for iproxy (connect device via USB or run setup script)'
      );
      return false;
    }

    return new Promise((resolve) => {
      try {
        // iproxy <local_port> <device_port> -u <udid>
        this.iproxyProcess = spawn(
          'iproxy',
          [String(this.wdaPort), String(this.wdaPort), '-u', deviceUdid],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );

        let started = false;
        let resolved = false;

        const resolveOnce = (result: boolean) => {
          if (resolved) {
            return;
          }
          resolved = true;
          resolve(result);
        };

        this.iproxyProcess.stderr?.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          console.log('[iproxy]', message);
          if (message.toLowerCase().includes('address already in use')) {
            // Another iproxy instance is already forwarding this port.
            started = true;
            this.iproxyProcess?.kill();
            this.iproxyProcess = null;
            resolveOnce(true);
            return;
          }
          // iproxy outputs "waiting for connection" when ready
          if (message.includes('waiting') || message.includes('Creating')) {
            started = true;
            resolveOnce(true);
          }
        });

        this.iproxyProcess.on('error', (err) => {
          if (err.message.includes('ENOENT')) {
            console.error('[iproxy] Not found. Install with: brew install libimobiledevice');
            this.onStatus?.('WDA: iproxy not found (brew install libimobiledevice)');
          } else {
            console.error('[iproxy] Error:', err.message);
          }
          resolveOnce(false);
        });

        this.iproxyProcess.on('close', (code) => {
          if (!started && code !== 0) {
            console.error('[iproxy] Exited with code', code);
            resolveOnce(false);
          }
        });

        // Timeout after 3 seconds
        setTimeout(() => {
          if (!started) {
            // iproxy might not output anything if it starts successfully
            // Check if process is still running
            if (this.iproxyProcess && !this.iproxyProcess.killed) {
              started = true;
              resolveOnce(true);
            } else {
              resolveOnce(false);
            }
          }
        }, 3000);
      } catch (error) {
        console.error('[iproxy] Failed to start:', error);
        resolve(false);
      }
    });
  }

  private async resolveWdaDeviceUdid(): Promise<string | null> {
    if (this.resolvedWdaUdid) {
      return this.resolvedWdaUdid;
    }

    const envUdid = process.env.SCRCPY_WDA_UDID || process.env.IOS_UDID || process.env.UDID;
    if (envUdid) {
      this.resolvedWdaUdid = envUdid;
      return envUdid;
    }

    return new Promise((resolve) => {
      execFile('idevice_id', ['-l'], (error, stdout) => {
        if (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            console.error(
              '[WDA] idevice_id not found. Install with: brew install libimobiledevice'
            );
          } else {
            console.error('[WDA] Failed to run idevice_id:', error.message);
          }
          resolve(null);
          return;
        }

        const udids = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);

        if (udids.length === 0) {
          resolve(null);
          return;
        }

        // If the selected device serial matches a real iOS UDID, prefer it.
        if (this.deviceSerial && udids.includes(this.deviceSerial)) {
          this.resolvedWdaUdid = this.deviceSerial;
          resolve(this.deviceSerial);
          return;
        }

        if (udids.length === 1) {
          this.resolvedWdaUdid = udids[0];
          resolve(udids[0]);
          return;
        }

        // Multiple devices connected; avoid picking the wrong one.
        console.warn('[WDA] Multiple iOS devices detected:', udids);
        resolve(null);
      });
    });
  }

  /**
   * Stop iproxy process
   */
  private stopIproxy(): void {
    if (this.iproxyProcess) {
      this.iproxyProcess.kill();
      this.iproxyProcess = null;
    }
  }

  /**
   * Update capabilities based on WDA availability
   */
  private updateCapabilities(wdaConnected: boolean): void {
    // Check if device has a physical home button (for recents via double-tap)
    const hasHomeButton = this.deviceHasHomeButton();

    this._capabilities = {
      ...IOS_CAPABILITIES,
      supportsTouch: wdaConnected,
      supportsKeyboard: wdaConnected,
      supportsHomeButton: wdaConnected,
      supportsBackButton: wdaConnected,
      // Recents only works on devices with home button (double-tap triggers app switcher)
      supportsRecentsButton: wdaConnected && hasHomeButton,
      supportsVolumeControl: wdaConnected,
      // New capabilities enabled when WDA is connected
      supportsRotation: wdaConnected,
      supportsClipboard: wdaConnected,
      // App listing works via ideviceinstaller (no WDA needed), launching requires WDA
      // Show menu always, error on launch if WDA not connected
      supportsAppLaunch: true,
    };
    // Notify listeners of capability changes
    this.onCapabilitiesChanged?.(this._capabilities);
  }

  /**
   * Check if the device has a physical home button
   * iPhones with Face ID (X and later, except SE) don't have a home button
   */
  private deviceHasHomeButton(): boolean {
    const model = this._deviceInfo?.model;
    if (!model) {
      return false; // Unknown device, assume no home button
    }

    // Model identifiers for devices WITH home button:
    // - iPhone SE 2nd gen: iPhone12,8
    // - iPhone SE 3rd gen: iPhone14,6
    // - iPhone 8/8 Plus: iPhone10,1/10,2/10,4/10,5
    // - All iPads with Touch ID
    // - Older iPhones (6s, 7, etc.)

    // Model identifiers for devices WITHOUT home button (Face ID):
    // - iPhone X: iPhone10,3/10,6
    // - iPhone XS/XR/11/12/13/14/15/16 series (except SE)

    const modelLower = model.toLowerCase();

    // Check for SE models (have home button)
    if (modelLower.includes('se')) {
      return true;
    }

    // Check model identifier format (e.g., "iPhone14,6")
    const iPhoneMatch = model.match(/iphone(\d+),(\d+)/i);
    if (iPhoneMatch) {
      const majorVersion = parseInt(iPhoneMatch[1], 10);
      const minorVersion = parseInt(iPhoneMatch[2], 10);

      // iPhone 8/8 Plus: iPhone10,1/10,2/10,4/10,5 (have home button)
      if (majorVersion === 10 && [1, 2, 4, 5].includes(minorVersion)) {
        return true;
      }

      // iPhone X and later (majorVersion >= 10 with Face ID minorVersions) - no home button
      // iPhone X: 10,3 and 10,6
      if (majorVersion === 10 && [3, 6].includes(minorVersion)) {
        return false;
      }

      // iPhone SE 2nd gen: iPhone12,8 (has home button)
      if (majorVersion === 12 && minorVersion === 8) {
        return true;
      }

      // iPhone SE 3rd gen: iPhone14,6 (has home button)
      if (majorVersion === 14 && minorVersion === 6) {
        return true;
      }

      // All other iPhone 11+ series have Face ID (no home button)
      if (majorVersion >= 11) {
        return false;
      }

      // iPhone 9 and below (iPhone 7, 6s, etc.) have home button
      return true;
    }

    // iPads - check for Face ID models (iPad Pro 3rd gen and later)
    const iPadMatch = model.match(/ipad(\d+),(\d+)/i);
    if (iPadMatch) {
      const majorVersion = parseInt(iPadMatch[1], 10);
      // iPad Pro 3rd gen (2018) and later with Face ID: iPad8,x and above
      // Most iPads still have Touch ID/home button
      if (majorVersion >= 8) {
        // iPad Pro 11" and 12.9" 3rd gen+ don't have home button
        // But iPad Air, iPad mini, regular iPad still have it
        // For simplicity, assume iPads have home button (most do)
        return true;
      }
      return true;
    }

    // Check for human-readable names
    if (
      modelLower.includes('iphone 8') ||
      modelLower.includes('iphone 7') ||
      modelLower.includes('iphone 6') ||
      modelLower.includes('iphone se')
    ) {
      return true;
    }

    if (
      modelLower.includes('iphone x') ||
      modelLower.includes('iphone 11') ||
      modelLower.includes('iphone 12') ||
      modelLower.includes('iphone 13') ||
      modelLower.includes('iphone 14') ||
      modelLower.includes('iphone 15') ||
      modelLower.includes('iphone 16')
    ) {
      return false;
    }

    // Default: assume no home button for unknown models (safer)
    return false;
  }

  private async refreshWdaWindowSize(): Promise<void> {
    if (!this.wdaClient || !this.wdaReady) {
      return;
    }

    try {
      const size = await this.wdaClient.getWindowSize();
      this.wdaScreenWidth = size.width;
      this.wdaScreenHeight = size.height;
      console.log(`[WDA] Window size: ${size.width}x${size.height}`);
    } catch (error) {
      console.error('[WDA] Failed to get window size:', error);
    }
  }

  private getInputTargetSize(): { width: number; height: number } {
    if (this.wdaScreenWidth > 0 && this.wdaScreenHeight > 0) {
      return { width: this.wdaScreenWidth, height: this.wdaScreenHeight };
    }

    return { width: this._deviceWidth, height: this._deviceHeight };
  }

  /**
   * Parse binary protocol from helper stdout
   */
  private handleHelperData(chunk: Buffer): void {
    this.messageBuffer = Buffer.concat([this.messageBuffer, chunk]);

    // Process all complete messages in the buffer
    while (this.messageBuffer.length >= 5) {
      const type = this.messageBuffer.readUInt8(0);
      const length = this.messageBuffer.readUInt32BE(1);

      // Check if we have the complete message
      if (this.messageBuffer.length < 5 + length) {
        break; // Wait for more data
      }

      const payload = this.messageBuffer.subarray(5, 5 + length);
      this.messageBuffer = this.messageBuffer.subarray(5 + length);

      this.processMessage(type, payload);
    }
  }

  /**
   * Process a complete message from the helper
   */
  private processMessage(type: number, payload: Buffer): void {
    // Log message types (except video frames to avoid spam)
    if (type !== MessageType.VIDEO_FRAME) {
      console.log(
        `[iOSConnection] Received message type: 0x${type.toString(16)}, size: ${payload.length}`
      );
    }

    switch (type) {
      case MessageType.DEVICE_INFO:
        this.handleDeviceInfo(payload);
        break;
      case MessageType.VIDEO_CONFIG:
        this.handleVideoConfig(payload);
        break;
      case MessageType.VIDEO_FRAME:
        this.lastFrameTime = Date.now();
        if (!this.hasReceivedFirstFrame) {
          this.hasReceivedFirstFrame = true;
          this.screenOffNotified = false;
        }
        this.handleVideoFrame(payload);
        break;
      case MessageType.ERROR:
        this.onError?.(payload.toString('utf8'));
        break;
      case MessageType.STATUS: {
        const statusText = payload.toString('utf8');
        console.log(`[iOSConnection] STATUS message: "${statusText}"`);
        this.onStatus?.(statusText);
        // Start frame timeout detection when capture starts
        if (statusText === 'Capture started') {
          this.startFrameTimeoutDetection();
        }
        break;
      }
    }
  }

  /**
   * Handle device info message
   */
  private handleDeviceInfo(payload: Buffer): void {
    try {
      const info = JSON.parse(payload.toString('utf8'));
      this._deviceInfo = {
        serial: info.udid,
        name: info.name,
        model: info.model,
        platform: 'ios',
      };
    } catch {
      // Ignore parse errors
    }
  }

  /**
   * Handle video config message (SPS/PPS + dimensions)
   */
  private handleVideoConfig(payload: Buffer): void {
    if (payload.length < 8) {
      return;
    }

    // Parse dimensions
    this._deviceWidth = payload.readUInt32BE(0);
    this._deviceHeight = payload.readUInt32BE(4);

    if (this.wdaReady) {
      void this.refreshWdaWindowSize();
    }

    // Extract config data (SPS/PPS in Annex B format)
    const configData = new Uint8Array(payload.subarray(8));

    console.log(
      `[iOSConnection] VIDEO_CONFIG: ${this._deviceWidth}x${this._deviceHeight}, config size: ${configData.length}`
    );

    this.onStatus?.(`Streaming at ${this._deviceWidth}x${this._deviceHeight}`);

    // Send config to video renderer
    this.onVideoFrame?.(
      configData,
      true, // isConfig
      false, // isKeyFrame
      this._deviceWidth,
      this._deviceHeight,
      'h264' as VideoCodecType
    );
  }

  /**
   * Handle video frame message
   */
  private handleVideoFrame(payload: Buffer): void {
    if (payload.length < 9) {
      return;
    }

    // Parse flags
    const flags = payload.readUInt8(0);
    const isKeyFrame = (flags & 0x01) !== 0;
    const isConfig = (flags & 0x02) !== 0;

    // Skip PTS (8 bytes) and get frame data
    const frameData = new Uint8Array(payload.subarray(9));

    // Debug logging for first few frames
    if (!this._frameLogged || isKeyFrame) {
      console.log(
        `[iOSConnection] VIDEO_FRAME: size=${frameData.length}, isKeyFrame=${isKeyFrame}, isConfig=${isConfig}`
      );
      this._frameLogged = true;
    }

    this.onVideoFrame?.(
      frameData,
      isConfig,
      isKeyFrame,
      undefined,
      undefined,
      'h264' as VideoCodecType
    );
  }

  /**
   * Start periodic frame timeout detection
   * Shows helpful messages when device screen is off
   */
  private startFrameTimeoutDetection(): void {
    this.captureStartedTime = Date.now();
    this.hasReceivedFirstFrame = false;
    this.screenOffNotified = false;
    this.lastFrameTime = 0;

    console.log('[iOSConnection] Starting frame timeout detection');

    // Clear any existing timer
    if (this.frameTimeoutTimer) {
      clearInterval(this.frameTimeoutTimer);
    }

    // Check every 2 seconds
    this.frameTimeoutTimer = setInterval(() => {
      const now = Date.now();

      // Case 1: Never received any frames after capture started
      if (!this.hasReceivedFirstFrame) {
        const timeSinceCaptureStarted = now - this.captureStartedTime;
        console.log(
          `[iOSConnection] Frame check: no frames yet, ${timeSinceCaptureStarted}ms since capture started`
        );
        // Wait 5 seconds before showing the message
        if (timeSinceCaptureStarted > 5000 && !this.screenOffNotified) {
          this.screenOffNotified = true;
          this.onStatus?.('Wake your iOS device to start screen capture');
        }
        return;
      }

      // Case 2: Was receiving frames but they stopped
      const timeSinceLastFrame = now - this.lastFrameTime;
      console.log(`[iOSConnection] Frame check: ${timeSinceLastFrame}ms since last frame`);
      // If no frame for 3 seconds, device screen is likely off
      if (timeSinceLastFrame > 3000 && !this.screenOffNotified) {
        this.screenOffNotified = true;
        this.onStatus?.('Device screen is off - wake device to resume');
      } else if (timeSinceLastFrame < 1000 && this.screenOffNotified) {
        // Frames resumed, clear the notification
        this.screenOffNotified = false;
        this.onStatus?.(`Streaming at ${this._deviceWidth}x${this._deviceHeight}`);
      }
    }, 2000);
  }

  /**
   * Stop frame timeout detection
   */
  private stopFrameTimeoutDetection(): void {
    if (this.frameTimeoutTimer) {
      clearInterval(this.frameTimeoutTimer);
      this.frameTimeoutTimer = null;
    }
    this.hasReceivedFirstFrame = false;
    this.screenOffNotified = false;
  }

  disconnect(): void {
    this._connected = false;

    // Stop frame timeout detection
    this.stopFrameTimeoutDetection();

    // Stop helper process
    if (this.helperProcess) {
      this.helperProcess.kill();
      this.helperProcess = null;
    }

    // Cleanup WDA (Phase 8)
    if (this.wdaClient) {
      this.wdaClient.disconnect();
      this.wdaClient = null;
    }
    this.wdaReady = false;
    this.wdaUnavailable = false;

    // Stop iproxy
    this.stopIproxy();

    this.messageBuffer = Buffer.alloc(0);
  }

  getDeviceSerial(): string | null {
    return this.deviceSerial;
  }

  getDeviceInfo(): DeviceInfo | null {
    return this._deviceInfo;
  }

  /**
   * Get path to the ios-helper binary
   */
  private getHelperPath(): string {
    return resolveIOSHelperPath(this.customHelperPath);
  }

  // Input methods - implemented via WebDriverAgent (Phase 8)

  /**
   * Send touch event to device via WDA
   * @param action - 0: down, 1: up, 2: move
   * @param x - Normalized X coordinate (0-1)
   * @param y - Normalized Y coordinate (0-1)
   */
  sendTouch(action: number, x: number, y: number, _pointerId?: number): void {
    if (!this.wdaClient || !this.wdaReady) {
      return;
    }

    // Map action codes to WDA actions
    const actionMap: Record<number, 'down' | 'move' | 'up'> = {
      0: 'down',
      1: 'up',
      2: 'move',
    };

    const wdaAction = actionMap[action];
    if (!wdaAction) {
      return;
    }

    const { width, height } = this.getInputTargetSize();
    if (width <= 0 || height <= 0) {
      return;
    }

    // Denormalize coordinates to device coordinates (WDA expects screen points)
    const absX = x * width;
    const absY = y * height;

    // touch() is fire-and-forget with internal error handling
    this.wdaClient.touch(wdaAction, absX, absY);
  }

  /**
   * Send scroll event to device via WDA
   * @param x - Normalized X coordinate (0-1)
   * @param y - Normalized Y coordinate (0-1)
   * @param dx - Horizontal scroll delta
   * @param dy - Vertical scroll delta
   */
  sendScroll(x: number, y: number, dx: number, dy: number): void {
    if (!this.wdaClient || !this.wdaReady) {
      return;
    }

    const { width, height } = this.getInputTargetSize();
    if (width <= 0 || height <= 0) {
      return;
    }

    // Denormalize coordinates to device coordinates
    const absX = x * width;
    const absY = y * height;

    // scroll() is fire-and-forget with internal debouncing
    this.wdaClient.scroll(absX, absY, dx, dy);
  }

  /**
   * Send key event to device via WDA
   * Supports: home (3), back (4), volume up/down (24/25), app switcher (187)
   * @param action - 0: down, 1: up
   * @param keycode - Android keycode
   */
  sendKey(action: number, keycode: number, _metastate?: number): void {
    if (!this.wdaClient || !this.wdaReady) {
      return;
    }

    // Only handle key up to avoid double-press
    if (action !== 1) {
      return;
    }

    // Handle gesture-based "buttons" for iOS (keycodes that trigger swipe gestures)
    // BACK = 4: swipe from left edge to right (native iOS back gesture)
    if (keycode === 4) {
      this.wdaClient.performBackGesture();
      return;
    }

    // RECENTS/APP_SWITCH = 187: swipe up from bottom and hold (native iOS app switcher gesture)
    if (keycode === 187) {
      this.wdaClient.performAppSwitcherGesture();
      return;
    }

    // Map Android keycodes to WDA hardware buttons
    // HOME = 3, VOLUME_UP = 24, VOLUME_DOWN = 25
    const buttonMap: Record<number, 'home' | 'volumeUp' | 'volumeDown'> = {
      3: 'home',
      24: 'volumeUp',
      25: 'volumeDown',
    };

    const button = buttonMap[keycode];
    if (!button) {
      return;
    }

    this.wdaClient.pressButton(button).catch((error) => {
      console.error('[WDA] Button press failed:', error);
    });
  }

  /**
   * Inject text into device via WDA
   * @param text - Text to type
   */
  injectText(text: string): void {
    if (!this.wdaClient || !this.wdaReady) {
      return;
    }

    this.wdaClient.typeText(text).catch((error) => {
      console.error('[WDA] Text injection failed:', error);
    });
  }

  /**
   * Rotate the device screen via WDA
   * Uses 270 degrees (counter-clockwise) to match Android behavior
   */
  rotate?(): void {
    if (!this.wdaClient || !this.wdaReady) {
      return;
    }

    // Rotate counter-clockwise (same as Android's rotateDevice)
    // WDA uses clockwise degrees, so 270 = counter-clockwise 90
    this.wdaClient.rotateDevice(270).catch((error) => {
      console.error('[WDA] Rotation failed:', error);
    });
  }

  /**
   * Paste clipboard content from host to device via WDA
   */
  async pasteFromHost?(): Promise<void> {
    if (!this.wdaClient || !this.wdaReady) {
      return;
    }

    try {
      // Read from VS Code clipboard (via extension host)
      const vscode = await import('vscode');
      const text = await vscode.env.clipboard.readText();

      if (text) {
        await this.wdaClient.setClipboard(text);
      }
    } catch (error) {
      console.error('[WDA] Paste from host failed:', error);
    }
  }

  /**
   * Copy device clipboard content to host via WDA
   */
  async copyToHost?(): Promise<void> {
    if (!this.wdaClient || !this.wdaReady) {
      return;
    }

    try {
      const text = await this.wdaClient.getClipboard();

      if (text) {
        // Write to VS Code clipboard (via extension host)
        const vscode = await import('vscode');
        await vscode.env.clipboard.writeText(text);

        // Notify listeners of clipboard change
        this.onClipboardChange?.(text);
      }
    } catch (error) {
      console.error('[WDA] Copy to host failed:', error);
    }
  }

  /**
   * Launch an iOS app by bundle ID via WDA
   * @param bundleId - App bundle identifier (e.g., "com.apple.mobilesafari")
   */
  async launchApp(bundleId: string): Promise<void> {
    if (!this.wdaClient || !this.wdaReady) {
      throw new Error(
        'WebDriverAgent not connected. Use "Start iOS Input Control" from the menu to enable app launching.'
      );
    }

    await this.wdaClient.launchApp(bundleId);
  }

  /**
   * Get list of installed apps on the iOS device via ideviceinstaller
   * @returns Array of app info with appId (bundle ID) and displayName
   */
  async getInstalledApps(): Promise<Array<{ appId: string; displayName: string }>> {
    // Resolve the real UDID for libimobiledevice tools
    const udid = await this.resolveRealUdid();
    if (!udid) {
      throw new Error('Could not resolve device UDID');
    }

    return new Promise((resolve, reject) => {
      // Run ideviceinstaller to list user-installed apps
      execFile('ideviceinstaller', ['-u', udid, 'list'], (error, stdout, stderr) => {
        if (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(
              new Error('ideviceinstaller not found. Install with: brew install ideviceinstaller')
            );
          } else {
            reject(new Error(`Failed to list apps: ${stderr || error.message}`));
          }
          return;
        }

        // Parse output - format: "bundleId, version, displayName - bundleId"
        // Example: "com.apple.mobilesafari, 16.3, Safari - com.apple.mobilesafari"
        const apps: Array<{ appId: string; displayName: string }> = [];
        const lines = stdout.trim().split('\n');

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          // Try parsing "bundleId, version, displayName" format
          const parts = line.split(',').map((p) => p.trim());
          if (parts.length >= 3) {
            const bundleId = parts[0];
            // Display name might contain commas, so join everything after version
            // Also remove any trailing " - bundleId" suffix
            let displayName = parts.slice(2).join(', ');
            const dashIndex = displayName.lastIndexOf(' - ');
            if (dashIndex > 0) {
              displayName = displayName.substring(0, dashIndex);
            }

            apps.push({
              appId: bundleId,
              displayName: displayName || bundleId,
            });
          }
        }

        resolve(apps);
      });
    });
  }

  /**
   * Terminate an iOS app by bundle ID via WDA
   * @param bundleId - App bundle identifier
   */
  async terminateApp(bundleId: string): Promise<void> {
    if (!this.wdaClient || !this.wdaReady) {
      throw new Error('WDA not connected');
    }

    await this.wdaClient.terminateApp(bundleId);
  }

  async takeScreenshot(): Promise<Buffer | null> {
    if (!this.targetUDID) {
      return null;
    }

    const helperPath = this.getHelperPath();
    if (!helperPath) {
      throw new Error('iOS helper not found');
    }

    return new Promise((resolve, reject) => {
      const isNodeScript = helperPath.endsWith('.js');
      const command = isNodeScript ? 'node' : helperPath;
      const args = isNodeScript
        ? [helperPath, 'screenshot', this.targetUDID!]
        : ['screenshot', this.targetUDID!];

      const proc = spawn(command, args);
      const chunks: Buffer[] = [];

      proc.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      proc.stderr.on('data', (data: Buffer) => {
        console.error('[iOS Screenshot] stderr:', data.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Parse binary protocol: type(1) + length(4) + payload
          const data = Buffer.concat(chunks);
          if (data.length >= 5) {
            const type = data.readUInt8(0);
            const length = data.readUInt32BE(1);

            if (type === MessageType.SCREENSHOT && data.length >= 5 + length) {
              const pngData = data.slice(5, 5 + length);
              resolve(pngData);
              return;
            } else if (type === MessageType.ERROR) {
              const errorMsg = data.slice(5, 5 + length).toString('utf-8');
              reject(new Error(errorMsg));
              return;
            }
          }
          reject(new Error('Invalid screenshot response'));
        } else {
          reject(new Error(`Screenshot failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Check if WDA is ready for input
   */
  get isWdaReady(): boolean {
    return this.wdaReady;
  }

  /**
   * True when WDA init failed and auto-retries are paused
   */
  get isWdaUnavailable(): boolean {
    return this.wdaUnavailable;
  }

  /**
   * Get the resolved real iOS UDID (different from CoreMediaIO UID)
   * This is needed for libimobiledevice tools like ideviceinfo
   */
  get realUdid(): string | null {
    return this.resolvedWdaUdid;
  }

  /**
   * Resolve and return the real iOS UDID
   * Uses idevice_id to find the actual UDID for libimobiledevice tools
   */
  async resolveRealUdid(): Promise<string | null> {
    return this.resolveWdaDeviceUdid();
  }
}
