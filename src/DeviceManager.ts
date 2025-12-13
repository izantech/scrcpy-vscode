import { ScrcpyConnection, ScrcpyConfig, ClipboardAPI } from './ScrcpyConnection';
import { exec, execSync, spawn } from 'child_process';

/**
 * Device information
 */
export interface DeviceInfo {
  serial: string;
  name: string;
  model?: string;
}

/**
 * Session information sent to webview
 */
export interface SessionInfo {
  deviceId: string;
  deviceInfo: DeviceInfo;
  isActive: boolean;
}

/**
 * Callback types
 */
type VideoFrameCallback = (
  deviceId: string,
  data: Uint8Array,
  isConfig: boolean,
  width?: number,
  height?: number
) => void;

type AudioFrameCallback = (
  deviceId: string,
  data: Uint8Array,
  isConfig: boolean
) => void;

type StatusCallback = (deviceId: string, status: string) => void;
type SessionListCallback = (sessions: SessionInfo[]) => void;
type ErrorCallback = (deviceId: string, message: string) => void;

/**
 * Manages a single device session
 */
class DeviceSession {
  public readonly deviceId: string;
  public readonly deviceInfo: DeviceInfo;
  public isActive = false;
  public isPaused = false;

  private connection: ScrcpyConnection | null = null;
  private retryCount = 0;
  private isReconnecting = false;
  private isDisposed = false;
  private static readonly RETRY_DELAY_MS = 1500;

  // Store last video dimensions, config, and keyframe for replay on resume
  private lastWidth = 0;
  private lastHeight = 0;
  private lastConfigData: Uint8Array | null = null;
  private lastKeyframeData: Uint8Array | null = null;

  constructor(
    deviceInfo: DeviceInfo,
    private videoFrameCallback: VideoFrameCallback,
    private audioFrameCallback: AudioFrameCallback,
    private statusCallback: StatusCallback,
    private errorCallback: ErrorCallback,
    private config: ScrcpyConfig,
    private clipboardAPI?: ClipboardAPI,
    private onSessionFailed?: (deviceId: string) => void
  ) {
    this.deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.deviceInfo = deviceInfo;
  }

  async connect(): Promise<void> {
    this.connection = new ScrcpyConnection(
      (data, isConfig, width, height) => {
        // Store dimensions and config data for replay on resume
        if (width && height) {
          this.lastWidth = width;
          this.lastHeight = height;
        }
        if (isConfig) {
          this.lastConfigData = data;
        } else if (this.containsKeyFrame(data)) {
          // Store keyframes for replay on resume
          this.lastKeyframeData = data;
        }

        // Only forward frames if not paused
        if (!this.isPaused) {
          this.videoFrameCallback(this.deviceId, data, isConfig, width, height);
        }
      },
      (status) => this.statusCallback(this.deviceId, status),
      this.config,
      this.deviceInfo.serial,
      undefined, // onClipboard callback (handled internally by ScrcpyConnection)
      this.clipboardAPI,
      (error) => this.handleDisconnect(error), // onError for unexpected disconnects
      (data, isConfig) => {
        // Only forward audio frames if not paused
        if (!this.isPaused) {
          this.audioFrameCallback(this.deviceId, data, isConfig);
        }
      }
    );

    try {
      await this.connection.connect();
      await this.connection.startScrcpy();
      // Reset retry count on successful connection
      this.retryCount = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorCallback(this.deviceId, message);
      throw error;
    }
  }

  /**
   * Handle unexpected disconnect with auto-reconnect
   */
  private async handleDisconnect(error: string): Promise<void> {
    // Don't reconnect if disposed or already reconnecting
    if (this.isDisposed || this.isReconnecting) return;

    const maxRetries = this.config.autoReconnect ? this.config.reconnectRetries : 0;

    // Retry loop
    while (this.retryCount < maxRetries && !this.isDisposed) {
      this.isReconnecting = true;
      this.retryCount++;

      this.statusCallback(this.deviceId, `Reconnecting (attempt ${this.retryCount}/${maxRetries})...`);

      // Wait before reconnecting (gives ADB time to recover)
      await new Promise(resolve => setTimeout(resolve, DeviceSession.RETRY_DELAY_MS));

      // Check if disposed during wait
      if (this.isDisposed) {
        this.isReconnecting = false;
        return;
      }

      try {
        // Cleanup old connection
        if (this.connection) {
          await this.connection.disconnect();
          this.connection = null;
        }

        // Try to reconnect
        await this.connect();
        this.isReconnecting = false;
        return; // Success! Exit the retry loop
      } catch {
        // Retry failed, continue to next attempt
        this.isReconnecting = false;
      }
    }

    // All retries exhausted (or auto-reconnect disabled), show error
    this.errorCallback(this.deviceId, error);
    // Notify that session has failed so it can be removed
    if (this.onSessionFailed) {
      this.onSessionFailed(this.deviceId);
    }
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;

    // Replay stored config, dimensions, and keyframe so the renderer can display immediately
    if (this.lastWidth && this.lastHeight) {
      // Send config packet first (SPS/PPS) with dimensions
      if (this.lastConfigData) {
        this.videoFrameCallback(this.deviceId, this.lastConfigData, true, this.lastWidth, this.lastHeight);
      }

      // Send last keyframe so decoder can display something immediately
      // Without this, we'd have to wait for the next keyframe from the server
      if (this.lastKeyframeData) {
        this.videoFrameCallback(this.deviceId, this.lastKeyframeData, false, this.lastWidth, this.lastHeight);
      }
    }
  }

  /**
   * Check if data contains a keyframe (IDR NAL unit)
   */
  private containsKeyFrame(data: Uint8Array): boolean {
    // Look for IDR NAL unit (type 5) in the data
    for (let i = 0; i < data.length - 4; i++) {
      // Find start code (0x000001 or 0x00000001)
      if ((data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) ||
          (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1)) {
        const offset = data[i + 2] === 1 ? 3 : 4;
        if (i + offset < data.length) {
          const nalType = data[i + offset] & 0x1F;
          if (nalType === 5) { // IDR
            return true;
          }
        }
      }
    }
    return false;
  }

  async disconnect(): Promise<void> {
    this.isDisposed = true; // Prevent auto-reconnect attempts
    if (this.connection) {
      await this.connection.disconnect();
      this.connection = null;
    }
  }

  sendTouch(
    x: number,
    y: number,
    action: 'down' | 'move' | 'up',
    screenWidth: number,
    screenHeight: number
  ): void {
    this.connection?.sendTouch(x, y, action, screenWidth, screenHeight);
  }

  sendKeyDown(keycode: number): void {
    this.connection?.sendKeyDown(keycode);
  }

  sendKeyUp(keycode: number): void {
    this.connection?.sendKeyUp(keycode);
  }

  sendText(text: string): void {
    this.connection?.sendText(text);
  }

  sendKeyWithMeta(keycode: number, action: 'down' | 'up', metastate: number): void {
    this.connection?.sendKeyWithMeta(keycode, action, metastate);
  }

  updateDimensions(width: number, height: number): void {
    this.connection?.updateDimensions(width, height);
  }

  async pasteFromHost(): Promise<void> {
    await this.connection?.pasteFromHost();
  }

  async copyToHost(): Promise<void> {
    await this.connection?.copyToHost();
  }

  rotateDevice(): void {
    this.connection?.rotateDevice();
  }

  async takeScreenshot(): Promise<Buffer> {
    if (!this.connection) {
      throw new Error('No connection');
    }
    return this.connection.takeScreenshot();
  }
}

/**
 * Manages multiple device sessions
 */
export class DeviceManager {
  private sessions = new Map<string, DeviceSession>();
  private activeDeviceId: string | null = null;
  private deviceMonitorInterval: NodeJS.Timeout | null = null;
  private knownDeviceSerials = new Set<string>();
  private isMonitoring = false;
  private static readonly DEVICE_POLL_INTERVAL_MS = 2000;

  constructor(
    private videoFrameCallback: VideoFrameCallback,
    private audioFrameCallback: AudioFrameCallback,
    private statusCallback: StatusCallback,
    private sessionListCallback: SessionListCallback,
    private errorCallback: ErrorCallback,
    private config: ScrcpyConfig,
    private clipboardAPI?: ClipboardAPI
  ) {}

  /**
   * Get list of available ADB devices (excludes mDNS devices for cleaner UI)
   */
  async getAvailableDevices(): Promise<DeviceInfo[]> {
    return new Promise((resolve) => {
      exec('adb devices -l', (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        const lines = stdout.trim().split('\n');
        const devices: DeviceInfo[] = [];

        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].trim().split(/\s+/);
          if (parts.length >= 2 && parts[1] === 'device') {
            const serial = parts[0];
            // Skip mDNS devices (they're duplicates of WiFi connections)
            if (serial.includes('._adb-tls-connect._tcp')) {
              continue;
            }
            const modelMatch = lines[i].match(/model:([^\s]+)/);
            const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : undefined;
            devices.push({
              serial,
              name: model || serial,
              model
            });
          }
        }

        resolve(devices);
      });
    });
  }

  /**
   * Pair with a device over WiFi using Android 11+ Wireless Debugging
   * @param address The pairing address (IP:port) from "Pair device with pairing code"
   * @param pairingCode The 6-digit pairing code
   */
  async pairWifi(address: string, pairingCode: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use spawn to handle the interactive pairing process
      const adb = spawn('adb', ['pair', address]);

      let stdout = '';
      let stderr = '';
      let pairingCodeSent = false;

      adb.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        stdout += output;

        // When ADB prompts for the pairing code, send it
        if (!pairingCodeSent && output.toLowerCase().includes('enter pairing code')) {
          adb.stdin.write(pairingCode + '\n');
          pairingCodeSent = true;
        }
      });

      adb.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      adb.on('close', (code: number) => {
        const output = (stdout + stderr).toLowerCase();

        if (code === 0 && (output.includes('successfully paired') || output.includes('paired to'))) {
          resolve();
        } else if (output.includes('failed') || output.includes('error') || code !== 0) {
          reject(new Error(stderr || stdout || 'Pairing failed'));
        } else {
          // Assume success if no explicit failure
          resolve();
        }
      });

      adb.on('error', (error: Error) => {
        reject(error);
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        adb.kill();
        reject(new Error('Pairing timed out'));
      }, 30000);
    });
  }

  /**
   * Connect to a device over WiFi using ADB
   * @param ipAddress The IP address of the device
   * @param port The port (default 5555)
   * @returns The device info if connection was successful
   */
  async connectWifi(ipAddress: string, port: number = 5555): Promise<DeviceInfo> {
    const address = `${ipAddress}:${port}`;

    return new Promise((resolve, reject) => {
      exec(`adb connect ${address}`, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        // Check if connection was successful
        // Output is typically "connected to ip:port" or "already connected to ip:port"
        const output = stdout.toLowerCase();
        if (output.includes('connected to') || output.includes('already connected')) {
          // Get device model name
          try {
            const modelOutput = execSync(`adb -s ${address} shell getprop ro.product.model`, {
              timeout: 5000,
              encoding: 'utf8'
            }).trim();

            resolve({
              serial: address,
              name: modelOutput || address,
              model: modelOutput || undefined
            });
          } catch {
            // If we can't get the model, just use the address
            resolve({
              serial: address,
              name: address,
              model: undefined
            });
          }
        } else if (output.includes('failed') || output.includes('unable') || output.includes('cannot')) {
          // Provide helpful error message for common failure cases
          let errorMsg = stdout.trim();
          if (output.includes('connection refused') || output.includes('failed to connect')) {
            errorMsg += '\n\nFor Android 11+, you need to pair the device first using "Pair new device".';
          }
          reject(new Error(errorMsg));
        } else {
          // Unknown response, try to connect anyway
          resolve({
            serial: address,
            name: address,
            model: undefined
          });
        }
      });
    });
  }

  /**
   * Disconnect a WiFi device from ADB
   * @param address The IP:port address of the device
   */
  async disconnectWifi(address: string): Promise<void> {
    return new Promise((resolve, reject) => {
      exec(`adb disconnect ${address}`, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Add and connect to a new device
   */
  async addDevice(deviceInfo: DeviceInfo): Promise<string> {
    // Prevent duplicate connections
    if (this.isDeviceConnected(deviceInfo.serial)) {
      throw new Error('Device already connected');
    }

    const session = new DeviceSession(
      deviceInfo,
      this.videoFrameCallback,
      this.audioFrameCallback,
      this.statusCallback,
      this.errorCallback,
      this.config,
      this.clipboardAPI,
      (deviceId) => this.handleSessionFailed(deviceId)
    );

    this.sessions.set(session.deviceId, session);

    // Pause the currently active session (if any)
    if (this.activeDeviceId) {
      const oldSession = this.sessions.get(this.activeDeviceId);
      if (oldSession) {
        oldSession.isActive = false;
        oldSession.pause();
      }
    }

    // Make the new device active
    this.activeDeviceId = session.deviceId;
    session.isActive = true;

    this.notifySessionListChanged();

    try {
      await session.connect();
    } catch {
      // Error already reported via callback
      // Remove failed session
      this.sessions.delete(session.deviceId);
      if (this.activeDeviceId === session.deviceId) {
        this.activeDeviceId = null;
        // Switch to first available session
        const firstSession = this.sessions.values().next().value as DeviceSession | undefined;
        if (firstSession) {
          this.switchToDevice(firstSession.deviceId);
        }
      }
      this.notifySessionListChanged();
      throw new Error('Failed to connect');
    }

    return session.deviceId;
  }

  /**
   * Switch active device tab
   */
  switchToDevice(deviceId: string): void {
    const newSession = this.sessions.get(deviceId);
    if (!newSession) return;

    // Pause old active session
    if (this.activeDeviceId && this.activeDeviceId !== deviceId) {
      const oldSession = this.sessions.get(this.activeDeviceId);
      if (oldSession) {
        oldSession.isActive = false;
        oldSession.pause();
      }
    }

    // Activate new session
    this.activeDeviceId = deviceId;
    newSession.isActive = true;
    newSession.resume();

    this.notifySessionListChanged();
  }

  /**
   * Remove device session (user-initiated close)
   */
  async removeDevice(deviceId: string): Promise<void> {
    const session = this.sessions.get(deviceId);
    if (!session) return;

    // Mark as manually closed to prevent auto-reconnect
    const deviceSerial = session.deviceInfo.serial;
    this.knownDeviceSerials.add(deviceSerial);

    await session.disconnect();
    this.sessions.delete(deviceId);

    // If removed active device, switch to first available
    if (this.activeDeviceId === deviceId) {
      this.activeDeviceId = null;
      const firstSession = this.sessions.values().next().value as DeviceSession | undefined;
      if (firstSession) {
        this.switchToDevice(firstSession.deviceId);
      }
    }

    this.notifySessionListChanged();
  }

  /**
   * Get active session
   */
  getActiveSession(): DeviceSession | null {
    return this.activeDeviceId ? this.sessions.get(this.activeDeviceId) ?? null : null;
  }

  /**
   * Get all sessions
   */
  getAllSessions(): DeviceSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Check if device is already connected
   */
  isDeviceConnected(serial: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.deviceInfo.serial === serial) {
        return true;
      }
    }
    return false;
  }

  /**
   * Send touch to active device
   */
  sendTouch(
    x: number,
    y: number,
    action: 'down' | 'move' | 'up',
    screenWidth: number,
    screenHeight: number
  ): void {
    this.getActiveSession()?.sendTouch(x, y, action, screenWidth, screenHeight);
  }

  /**
   * Send key down to active device
   */
  sendKeyDown(keycode: number): void {
    this.getActiveSession()?.sendKeyDown(keycode);
  }

  /**
   * Send key up to active device
   */
  sendKeyUp(keycode: number): void {
    this.getActiveSession()?.sendKeyUp(keycode);
  }

  /**
   * Send text to active device
   */
  sendText(text: string): void {
    this.getActiveSession()?.sendText(text);
  }

  /**
   * Send key with metastate to active device (for keyboard input with modifiers)
   */
  sendKeyWithMeta(keycode: number, action: 'down' | 'up', metastate: number): void {
    this.getActiveSession()?.sendKeyWithMeta(keycode, action, metastate);
  }

  /**
   * Update dimensions for a specific device (called when webview detects rotation)
   */
  updateDimensions(deviceId: string, width: number, height: number): void {
    const session = this.sessions.get(deviceId);
    session?.updateDimensions(width, height);
  }

  /**
   * Paste from host clipboard to active device
   */
  async pasteFromHost(): Promise<void> {
    await this.getActiveSession()?.pasteFromHost();
  }

  /**
   * Copy from active device to host clipboard
   */
  async copyToHost(): Promise<void> {
    await this.getActiveSession()?.copyToHost();
  }

  /**
   * Rotate active device screen counter-clockwise
   */
  rotateDevice(): void {
    this.getActiveSession()?.rotateDevice();
  }

  /**
   * Take screenshot from active device (original resolution, lossless PNG)
   */
  async takeScreenshot(): Promise<Buffer> {
    const session = this.getActiveSession();
    if (!session) {
      throw new Error('No active device');
    }
    return session.takeScreenshot();
  }

  /**
   * Disconnect all sessions
   */
  async disconnectAll(): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.values()).map(s => s.disconnect())
    );
    this.sessions.clear();
    this.activeDeviceId = null;
    this.notifySessionListChanged();
  }

  /**
   * Update config for future connections
   */
  updateConfig(config: ScrcpyConfig): void {
    this.config = config;
  }

  /**
   * Handle session failure (all reconnect attempts exhausted)
   * Removes the session to allow auto-connect to work for the same device
   */
  private handleSessionFailed(deviceId: string): void {
    const session = this.sessions.get(deviceId);
    if (!session) return;

    const deviceSerial = session.deviceInfo.serial;

    // Remove the failed session
    this.sessions.delete(deviceId);

    // Remove from known devices so auto-connect can pick it up again
    this.knownDeviceSerials.delete(deviceSerial);

    // If this was the active device, clear active state
    if (this.activeDeviceId === deviceId) {
      this.activeDeviceId = null;
      // Switch to first available session if any
      const firstSession = this.sessions.values().next().value as DeviceSession | undefined;
      if (firstSession) {
        this.switchToDevice(firstSession.deviceId);
      }
    }

    this.notifySessionListChanged();
  }

  /**
   * Start monitoring for new devices (auto-connect)
   */
  async startDeviceMonitoring(): Promise<void> {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    // Initialize known devices with currently connected sessions
    this.knownDeviceSerials.clear();
    for (const session of this.sessions.values()) {
      this.knownDeviceSerials.add(session.deviceInfo.serial);
    }

    // Only mark existing ADB devices as "known" if we have active sessions
    // This prevents the race condition where a device plugged in during startup
    // gets marked as known and never auto-connects
    if (this.sessions.size > 0) {
      const devices = await this.getAvailableDevices();
      for (const device of devices) {
        this.knownDeviceSerials.add(device.serial);
      }
    }

    this.deviceMonitorInterval = setInterval(() => {
      this.checkForNewDevices();
    }, DeviceManager.DEVICE_POLL_INTERVAL_MS);
  }

  /**
   * Stop monitoring for new devices
   */
  stopDeviceMonitoring(): void {
    this.isMonitoring = false;
    if (this.deviceMonitorInterval) {
      clearInterval(this.deviceMonitorInterval);
      this.deviceMonitorInterval = null;
    }
    this.knownDeviceSerials.clear();
  }

  /**
   * Check if a device serial represents a WiFi connection (IP:port format)
   */
  private isWifiDevice(serial: string): boolean {
    // WiFi devices have format like "192.168.1.100:5555" or include IP addresses
    // Also match mDNS format like "adb-XXXXX._adb-tls-connect._tcp"
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(serial) ||
           serial.includes('._adb-tls-connect._tcp');
  }

  /**
   * Check for newly connected devices and auto-connect
   * Only auto-connects USB devices, not WiFi/network devices
   */
  private async checkForNewDevices(): Promise<void> {
    if (!this.config.autoConnect) return;

    const devices = await this.getAvailableDevices();
    const currentSerials = new Set(devices.map(d => d.serial));

    // Find new devices (present now but not known before)
    for (const device of devices) {
      // Skip WiFi/network devices - auto-connect is only for USB
      if (this.isWifiDevice(device.serial)) {
        continue;
      }

      if (!this.knownDeviceSerials.has(device.serial) && !this.isDeviceConnected(device.serial)) {
        // New USB device detected - auto-connect
        // Clear any error state by sending status before connecting
        this.statusCallback('', `Connecting to ${device.name}...`);

        try {
          await this.addDevice(device);
          // Successfully connected - mark as known
          this.knownDeviceSerials.add(device.serial);
        } catch {
          // Failed to connect - don't mark as known so we retry next poll
        }
      }
    }

    // Remove devices that are no longer present (unplugged)
    // But only for USB devices - keep WiFi devices in known list
    for (const serial of Array.from(this.knownDeviceSerials)) {
      if (!currentSerials.has(serial) && !this.isWifiDevice(serial)) {
        this.knownDeviceSerials.delete(serial);
      }
    }
  }

  private notifySessionListChanged(): void {
    const sessionList: SessionInfo[] = Array.from(this.sessions.values()).map(s => ({
      deviceId: s.deviceId,
      deviceInfo: s.deviceInfo,
      isActive: s.isActive
    }));
    this.sessionListCallback(sessionList);
  }
}
