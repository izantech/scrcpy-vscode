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

  // WebDriverAgent integration (Phase 8)
  private wdaClient: WDAClient | null = null;
  private wdaReady = false;
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
    if (this.wdaEnabled) {
      await this.initializeWDA();
    }
  }

  /**
   * Initialize WebDriverAgent connection via iproxy
   */
  private async initializeWDA(): Promise<void> {
    if (!this.deviceSerial) {
      return;
    }

    this.onStatus?.('Initializing WebDriverAgent...');

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
        this.updateCapabilities(true);
        await this.refreshWdaWindowSize();
        this.onStatus?.('WDA: Connected, input enabled');
        return;
      } else {
        this.onStatus?.('WDA: Not ready, input disabled');
        this.wdaClient = null;
        return;
      }
    } catch (error) {
      console.log('[WDA] Direct connection unavailable, trying iproxy...');
    }

    // Fall back to starting iproxy (best-effort).
    const iproxyStarted = await this.startIproxy();
    if (!iproxyStarted) {
      this.onStatus?.('WDA: iproxy not available, input disabled');
      this.wdaClient = null;
      return;
    }

    // Give iproxy a moment to establish the connection
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      const wdaClient = this.wdaClient;
      if (!wdaClient) {
        this.onStatus?.('WDA: Client not available, input disabled');
        return;
      }

      const status = await wdaClient.checkStatus();
      if (status?.ready !== false) {
        // Pre-create session to avoid latency on first touch
        await wdaClient.initSession();
        this.wdaReady = true;
        this.updateCapabilities(true);
        await this.refreshWdaWindowSize();
        this.onStatus?.('WDA: Connected, input enabled');
      } else {
        this.onStatus?.('WDA: Not ready, input disabled');
        this.wdaClient = null;
      }
    } catch (error) {
      console.error('[WDA] Connection failed:', error);
      this.onStatus?.('WDA: Connection failed, input disabled');
      this.wdaClient = null;
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
    this._capabilities = {
      ...IOS_CAPABILITIES,
      supportsTouch: wdaConnected,
      supportsKeyboard: wdaConnected,
      supportsSystemButtons: wdaConnected, // home button only
      supportsVolumeControl: wdaConnected,
    };
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
        this.handleVideoFrame(payload);
        break;
      case MessageType.ERROR:
        this.onError?.(payload.toString('utf8'));
        break;
      case MessageType.STATUS:
        this.onStatus?.(payload.toString('utf8'));
        break;
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

  disconnect(): void {
    this._connected = false;

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
   * Only supports home button (keycode 3)
   * @param action - 0: down, 1: up
   * @param keycode - Android keycode (only 3/HOME supported)
   */
  sendKey(action: number, keycode: number, _metastate?: number): void {
    if (!this.wdaClient || !this.wdaReady) {
      return;
    }

    // Only handle key up to avoid double-press
    if (action !== 1) {
      return;
    }

    // Map Android keycodes to WDA buttons
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

  rotate?(): void {
    // Not supported on iOS via WDA
  }

  pasteFromHost?(): void {
    // Not supported on iOS via WDA
  }

  copyToHost?(): void {
    // Not supported on iOS via WDA
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
}
