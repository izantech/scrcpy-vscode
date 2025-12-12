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

  constructor(
    deviceInfo: DeviceInfo,
    private videoFrameCallback: VideoFrameCallback,
    private statusCallback: StatusCallback,
    private errorCallback: ErrorCallback,
    private config: ScrcpyConfig,
    private clipboardAPI?: ClipboardAPI
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
      this.clipboardAPI
    );

    try {
      await this.connection.connect();
      await this.connection.startScrcpy();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorCallback(this.deviceId, message);
      throw error;
    }
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  async disconnect(): Promise<void> {
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
}

/**
 * Manages multiple device sessions
 */
export class DeviceManager {
  private sessions = new Map<string, DeviceSession>();
  private activeDeviceId: string | null = null;

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
      this.clipboardAPI
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

  private notifySessionListChanged(): void {
    const sessionList: SessionInfo[] = Array.from(this.sessions.values()).map(s => ({
      deviceId: s.deviceId,
      deviceInfo: s.deviceInfo,
      isActive: s.isActive
    }));
    this.sessionListCallback(sessionList);
  }
}
