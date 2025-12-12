import { ScrcpyConnection, ScrcpyConfig, ClipboardAPI } from './ScrcpyConnection';
import { exec } from 'child_process';

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

  constructor(
    deviceInfo: DeviceInfo,
    private videoFrameCallback: VideoFrameCallback,
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
      (error) => this.handleDisconnect(error) // onError for unexpected disconnects
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
    private statusCallback: StatusCallback,
    private sessionListCallback: SessionListCallback,
    private errorCallback: ErrorCallback,
    private config: ScrcpyConfig,
    private clipboardAPI?: ClipboardAPI
  ) {}

  /**
   * Get list of available ADB devices
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
            const modelMatch = lines[i].match(/model:([^\s]+)/);
            const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : undefined;
            devices.push({
              serial: parts[0],
              name: model || parts[0],
              model
            });
          }
        }

        resolve(devices);
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
      this.statusCallback,
      this.errorCallback,
      this.config,
      this.clipboardAPI,
      (deviceId) => this.handleSessionFailed(deviceId)
    );

    this.sessions.set(session.deviceId, session);

    // If first device or no active device, make it active
    if (this.activeDeviceId === null) {
      this.activeDeviceId = session.deviceId;
      session.isActive = true;
    } else {
      // New device starts paused
      session.isPaused = true;
    }

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
   * Remove device session
   */
  async removeDevice(deviceId: string): Promise<void> {
    const session = this.sessions.get(deviceId);
    if (!session) return;

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
   * Check for newly connected devices and auto-connect
   */
  private async checkForNewDevices(): Promise<void> {
    if (!this.config.autoConnect) return;

    const devices = await this.getAvailableDevices();
    const currentSerials = new Set(devices.map(d => d.serial));

    // Find new devices (present now but not known before)
    for (const device of devices) {
      if (!this.knownDeviceSerials.has(device.serial) && !this.isDeviceConnected(device.serial)) {
        // New device detected - auto-connect
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
    for (const serial of Array.from(this.knownDeviceSerials)) {
      if (!currentSerials.has(serial)) {
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
