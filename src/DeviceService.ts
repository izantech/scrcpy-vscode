/**
 * Device Service - manages device connections and operations
 *
 * This service handles all device connection logic but delegates state
 * ownership to AppStateManager. It manages ScrcpyConnection instances
 * and device monitoring.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
  ScrcpyConnection,
  ScrcpyConfig,
  ClipboardAPI,
  VideoCodecType,
} from './android/ScrcpyConnection';
import { execFile, execFileSync, spawn, ChildProcess } from 'child_process';
import { AppStateManager } from './AppStateManager';
import { DeviceInfo, DeviceDetailedInfo, ConnectionState, VideoCodec } from './types/AppState';
import { getCapabilities, isIOSSupportAvailable } from './PlatformCapabilities';
import { iOSConnection, iOSDeviceManager, mapIOSProductType } from './ios';
import type { iOSConnectionConfig } from './ios/iOSConnection';

// Re-export types for backward compatibility
export type { DeviceInfo, DeviceDetailedInfo, ConnectionState };

/**
 * Callback types for video/audio frames (high-frequency, bypass state)
 */
export type VideoFrameCallback = (
  deviceId: string,
  data: Uint8Array,
  isConfig: boolean,
  isKeyFrame: boolean,
  width?: number,
  height?: number,
  codec?: VideoCodecType
) => void;

export type AudioFrameCallback = (deviceId: string, data: Uint8Array, isConfig: boolean) => void;

/**
 * Callback for status messages
 */
export type StatusCallback = (deviceId: string, status: string) => void;

/**
 * Callback for errors
 * @param deviceId - The device ID associated with the error
 * @param message - Human-readable error message
 * @param error - Optional original error object for type checking
 */
export type ErrorCallback = (deviceId: string, message: string, error?: Error) => void;

/**
 * Internal session data for a connected device
 */
interface DeviceSession {
  deviceId: string;
  deviceInfo: DeviceInfo;
  connection: ScrcpyConnection | iOSConnection | null;
  isPaused: boolean;
  retryCount: number;
  isReconnecting: boolean;
  isDisposed: boolean;
  effectiveCodec: 'h264' | 'h265' | 'av1';

  // Replay state for tab switching
  lastWidth: number;
  lastHeight: number;
  lastConfigData: Uint8Array | null;
  lastKeyFrameData: Uint8Array | null;
  lastCodec: VideoCodecType;
}

// Codec fallback chain: av1 -> h265 -> h264
const CODEC_FALLBACK: Record<string, 'h264' | 'h265' | 'av1' | null> = {
  av1: 'h265',
  h265: 'h264',
  h264: null, // No fallback for h264
};

const RETRY_DELAY_MS = 1500;
const INFO_CACHE_TTL = 30000; // 30 seconds

/**
 * Service for managing device connections
 *
 * Delegates state ownership to AppStateManager but manages connections,
 * device monitoring, and operations.
 */
export class DeviceService {
  // Internal session data (connections, replay state)
  private sessions = new Map<string, DeviceSession>();

  // Device monitoring
  private trackDevicesProcess: ChildProcess | null = null;
  private trackDevicesRestartTimeout: NodeJS.Timeout | null = null;
  private knownDeviceSerials = new Set<string>();
  private deviceListUpdateChain: Promise<void> = Promise.resolve();

  // Device info caching
  private deviceInfoCache = new Map<string, { info: DeviceDetailedInfo; timestamp: number }>();
  private deviceInfoRefreshInterval: NodeJS.Timeout | null = null;

  // iOS device polling (since there's no equivalent to adb track-devices)
  private iosDevicePollingInterval: NodeJS.Timeout | null = null;
  private isPollingIOS = false;
  private knownIOSDeviceSerials = new Set<string>();
  private iosPrewarmDone = false;

  // iOS configuration (Phase 8)
  private iosConfig: iOSConnectionConfig = {
    enabled: false,
    webDriverAgentEnabled: false,
    webDriverAgentPort: 8100,
  };

  constructor(
    private appState: AppStateManager,
    private videoFrameCallback: VideoFrameCallback,
    private audioFrameCallback: AudioFrameCallback,
    private statusCallback: StatusCallback,
    private errorCallback: ErrorCallback,
    private config: ScrcpyConfig,
    private clipboardAPI?: ClipboardAPI
  ) {}

  /**
   * Update iOS configuration (Phase 8)
   */
  setIOSConfig(config: iOSConnectionConfig): void {
    this.iosConfig = config;
  }

  /**
   * Get the ADB command path from config
   */
  private getAdbCommand(): string {
    if (this.config.adbPath) {
      return path.join(this.config.adbPath, 'adb');
    }
    return 'adb';
  }

  /**
   * Get list of available devices (Android via ADB + iOS via CoreMediaIO on macOS)
   */
  async getAvailableDevices(): Promise<DeviceInfo[]> {
    // Get Android devices
    const androidDevices = await this.getAndroidDevices();

    // Get iOS devices if enabled and on macOS
    let iosDevices: DeviceInfo[] = [];
    console.log(
      '[DeviceService] iOS config:',
      this.iosConfig,
      'isIOSSupportAvailable:',
      isIOSSupportAvailable()
    );
    if (this.iosConfig.enabled && isIOSSupportAvailable()) {
      try {
        iosDevices = await iOSDeviceManager.getAvailableDevices(this.config.videoSource);
        console.log('[DeviceService] Found iOS devices:', iosDevices.length);
      } catch (error) {
        console.error('Failed to get iOS devices:', error);
      }
    }

    return [...androidDevices, ...iosDevices];
  }

  /**
   * Get list of available ADB devices (excludes mDNS devices for cleaner UI)
   */
  private async getAndroidDevices(): Promise<DeviceInfo[]> {
    const adbCmd = this.getAdbCommand();
    return new Promise((resolve) => {
      execFile(adbCmd, ['devices', '-l'], (error, stdout) => {
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
              model,
              platform: 'android',
            });
          }
        }

        resolve(devices);
      });
    });
  }

  /**
   * Get detailed device information via ADB commands
   */
  async getDeviceInfo(serial: string): Promise<DeviceDetailedInfo> {
    const adbCmd = this.getAdbCommand();
    const execAdb = (args: string[]): Promise<string> => {
      return new Promise((resolve, reject) => {
        execFile(adbCmd, ['-s', serial, ...args], { timeout: 5000 }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve(stdout.trim());
          }
        });
      });
    };

    try {
      // Fetch all device properties in parallel for better performance
      const [
        model,
        manufacturer,
        androidVersion,
        sdkVersion,
        batteryInfo,
        storageInfo,
        resolutionInfo,
        ipInfo,
      ] = await Promise.all([
        execAdb(['shell', 'getprop', 'ro.product.model']).catch(() => 'Unknown'),
        execAdb(['shell', 'getprop', 'ro.product.manufacturer']).catch(() => 'Unknown'),
        execAdb(['shell', 'getprop', 'ro.build.version.release']).catch(() => 'Unknown'),
        execAdb(['shell', 'getprop', 'ro.build.version.sdk']).catch(() => '0'),
        execAdb(['shell', 'dumpsys', 'battery']).catch(() => ''),
        execAdb(['shell', 'df', '/data']).catch(() => ''),
        execAdb(['shell', 'wm', 'size']).catch(() => ''),
        execAdb(['shell', 'sh', '-c', 'ip route | grep wlan']).catch(() => ''),
      ]);

      // Parse battery info
      let batteryLevel = 0;
      let batteryCharging = false;
      if (batteryInfo) {
        const levelMatch = batteryInfo.match(/level:\s*(\d+)/);
        if (levelMatch) {
          batteryLevel = parseInt(levelMatch[1], 10);
        }
        // Check if charging (status: 2 = charging, 5 = full)
        const statusMatch = batteryInfo.match(/status:\s*(\d+)/);
        if (statusMatch) {
          const status = parseInt(statusMatch[1], 10);
          batteryCharging = status === 2 || status === 5;
        }
      }

      // Parse storage info (df output format: Filesystem Size Used Avail Use% Mounted)
      let storageTotal = 0;
      let storageUsed = 0;
      if (storageInfo) {
        const lines = storageInfo.split('\n');
        // Find the line with /data (usually the second line)
        for (const line of lines) {
          if (line.includes('/data')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3) {
              // Convert from KB to bytes (df uses 1K blocks by default)
              storageTotal = this.parseStorageSize(parts[1]);
              storageUsed = this.parseStorageSize(parts[2]);
              break;
            }
          }
        }
      }

      // Parse screen resolution
      let screenResolution = 'Unknown';
      if (resolutionInfo) {
        const match = resolutionInfo.match(/Physical size:\s*(\d+)x(\d+)/);
        if (match) {
          screenResolution = `${match[1]}x${match[2]}`;
        }
      }

      // Parse IP address (extract IP from wlan route)
      let ipAddress: string | undefined;
      if (ipInfo) {
        const match = ipInfo.match(/src\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        if (match) {
          ipAddress = match[1];
        }
      }

      const info: DeviceDetailedInfo = {
        serial,
        model,
        manufacturer,
        androidVersion,
        sdkVersion: parseInt(sdkVersion, 10) || 0,
        batteryLevel,
        batteryCharging,
        storageTotal,
        storageUsed,
        screenResolution,
        ipAddress,
      };

      // Update AppState with device info
      this.appState.setDeviceInfo(serial, info);

      return info;
    } catch {
      // Return partial info if commands fail
      const info: DeviceDetailedInfo = {
        serial,
        model: 'Unknown',
        manufacturer: 'Unknown',
        androidVersion: 'Unknown',
        sdkVersion: 0,
        batteryLevel: 0,
        batteryCharging: false,
        storageTotal: 0,
        storageUsed: 0,
        screenResolution: 'Unknown',
        ipAddress: undefined,
      };
      return info;
    }
  }

  /**
   * Parse storage size from df output (handles K, M, G suffixes)
   */
  private parseStorageSize(sizeStr: string): number {
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)([KMG])?$/);
    if (!match) {
      return 0;
    }

    const value = parseFloat(match[1]);
    const unit = match[2] || 'K'; // Default to KB

    switch (unit) {
      case 'K':
        return value * 1024;
      case 'M':
        return value * 1024 * 1024;
      case 'G':
        return value * 1024 * 1024 * 1024;
      default:
        return value;
    }
  }

  /**
   * Find a session by its device serial number
   */
  private findSessionBySerial(serial: string): DeviceSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.deviceInfo.serial === serial) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Detect the platform (android/ios) for a device serial
   */
  private detectPlatformBySerial(serial: string): 'android' | 'ios' {
    const session = this.findSessionBySerial(serial);
    return session?.deviceInfo.platform || 'android';
  }

  /**
   * Get WDA status for an iOS device
   */
  private getWDAStatusForSerial(
    serial: string
  ): 'connected' | 'unavailable' | 'disabled' | undefined {
    const session = this.findSessionBySerial(serial);
    if (!session?.connection || !this.isiOSConnection(session.connection)) {
      return undefined;
    }

    if (!this.iosConfig.webDriverAgentEnabled) {
      return 'disabled';
    }

    return session.connection.isWdaReady ? 'connected' : 'unavailable';
  }

  /**
   * Get fallback device info for iOS when ideviceinfo is unavailable
   */
  private getIOSFallbackInfo(serial: string): DeviceDetailedInfo {
    const session = this.findSessionBySerial(serial);
    const connection = session?.connection;

    let screenResolution = 'Unknown';
    if (connection && this.isiOSConnection(connection)) {
      if (connection.deviceWidth && connection.deviceHeight) {
        screenResolution = `${connection.deviceWidth}x${connection.deviceHeight}`;
      }
    }

    return {
      serial,
      model: session?.deviceInfo.model || 'iOS Device',
      manufacturer: 'Apple',
      androidVersion: '', // iOS version unknown
      sdkVersion: 0,
      batteryLevel: 0,
      batteryCharging: false,
      storageTotal: 0,
      storageUsed: 0,
      screenResolution,
      wdaStatus: this.getWDAStatusForSerial(serial),
    };
  }

  /**
   * Get detailed device information for iOS devices via ideviceinfo
   */
  async getiOSDeviceInfo(serial: string): Promise<DeviceDetailedInfo> {
    // Handle window-based capture devices (e.g., "window:12345")
    if (serial.startsWith('window:')) {
      return this.getIOSFallbackInfo(serial);
    }

    // Get the real iOS UDID from the connection (CoreMediaIO UID != iOS UDID)
    const session = this.findSessionBySerial(serial);
    let realUdid: string | null = null;
    if (session?.connection && this.isiOSConnection(session.connection)) {
      // Try to get already-resolved UDID, or resolve it now
      realUdid = session.connection.realUdid || (await session.connection.resolveRealUdid());
    }

    // If we couldn't get the real UDID, return fallback info
    if (!realUdid) {
      console.warn('[DeviceService] Could not resolve real iOS UDID for:', serial);
      return this.getIOSFallbackInfo(serial);
    }

    const execIdevice = (args: string[]): Promise<string> => {
      return new Promise((resolve, reject) => {
        execFile('ideviceinfo', ['-u', realUdid!, ...args], { timeout: 5000 }, (error, stdout) => {
          if (error) {
            reject(error);
          } else {
            resolve(stdout.trim());
          }
        });
      });
    };

    try {
      // Fetch all device properties in parallel for better performance
      const [batteryInfo, iosVersion, productType, diskUsage] = await Promise.all([
        execIdevice(['-q', 'com.apple.mobile.battery']).catch(() => ''),
        execIdevice(['-k', 'ProductVersion']).catch(() => ''),
        execIdevice(['-k', 'ProductType']).catch(() => ''),
        execIdevice(['-q', 'com.apple.disk_usage']).catch(() => ''),
      ]);

      // Parse battery info
      let batteryLevel = 0;
      let batteryCharging = false;
      if (batteryInfo) {
        const capacityMatch = batteryInfo.match(/BatteryCurrentCapacity:\s*(\d+)/);
        if (capacityMatch) {
          batteryLevel = parseInt(capacityMatch[1], 10);
        }
        const chargingMatch = batteryInfo.match(/BatteryIsCharging:\s*(true|false)/i);
        if (chargingMatch) {
          batteryCharging = chargingMatch[1].toLowerCase() === 'true';
        }
      }

      // Parse storage info
      let storageTotal = 0;
      let storageUsed = 0;
      if (diskUsage) {
        const totalMatch = diskUsage.match(/TotalDiskCapacity:\s*(\d+)/);
        const availMatch = diskUsage.match(/AmountDataAvailable:\s*(\d+)/);
        if (totalMatch) {
          storageTotal = parseInt(totalMatch[1], 10);
        }
        if (availMatch && totalMatch) {
          const available = parseInt(availMatch[1], 10);
          storageUsed = storageTotal - available;
        }
      }

      // Get screen resolution from active session
      let screenResolution = 'Unknown';
      const session = this.findSessionBySerial(serial);
      if (session?.connection && this.isiOSConnection(session.connection)) {
        const conn = session.connection;
        if (conn.deviceWidth && conn.deviceHeight) {
          screenResolution = `${conn.deviceWidth}x${conn.deviceHeight}`;
        }
      }

      // Map ProductType to readable model name
      const model = mapIOSProductType(productType) || session?.deviceInfo.model || 'iOS Device';

      const info: DeviceDetailedInfo = {
        serial,
        model,
        manufacturer: 'Apple',
        androidVersion: iosVersion || '', // Reuse field for iOS version
        sdkVersion: 0, // Not applicable for iOS
        batteryLevel,
        batteryCharging,
        storageTotal,
        storageUsed,
        screenResolution,
        wdaStatus: this.getWDAStatusForSerial(serial),
      };

      // Update AppState with device info
      this.appState.setDeviceInfo(serial, info);

      return info;
    } catch (error) {
      // Check if ideviceinfo is not installed
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(
          '[DeviceService] ideviceinfo not found. Install with: brew install libimobiledevice'
        );
      }
      return this.getIOSFallbackInfo(serial);
    }
  }

  /**
   * Get cached device info or fetch if not cached/expired
   */
  async getCachedDeviceInfo(
    serial: string,
    forceRefresh: boolean = false
  ): Promise<DeviceDetailedInfo> {
    const now = Date.now();
    const cached = this.deviceInfoCache.get(serial);

    if (!forceRefresh && cached && now - cached.timestamp < INFO_CACHE_TTL) {
      return cached.info;
    }

    // Fetch fresh info based on platform
    const platform = this.detectPlatformBySerial(serial);
    const info =
      platform === 'ios' ? await this.getiOSDeviceInfo(serial) : await this.getDeviceInfo(serial);
    this.deviceInfoCache.set(serial, { info, timestamp: now });
    return info;
  }

  /**
   * Start periodic refresh of device info for active sessions
   */
  private startDeviceInfoRefresh(): void {
    if (this.deviceInfoRefreshInterval) {
      return;
    }

    this.deviceInfoRefreshInterval = setInterval(async () => {
      // Refresh info for all connected devices
      for (const session of this.sessions.values()) {
        try {
          await this.getCachedDeviceInfo(session.deviceInfo.serial, true);
        } catch {
          // Ignore errors during refresh
        }
      }
    }, INFO_CACHE_TTL);
  }

  /**
   * Stop periodic refresh of device info
   */
  private stopDeviceInfoRefresh(): void {
    if (this.deviceInfoRefreshInterval) {
      clearInterval(this.deviceInfoRefreshInterval);
      this.deviceInfoRefreshInterval = null;
    }
  }

  /**
   * Start polling for iOS device connections/disconnections
   * Since there's no event-based monitoring like adb track-devices,
   * we poll periodically to detect device changes.
   */
  private startIOSDevicePolling(): void {
    if (!this.iosConfig.enabled || !isIOSSupportAvailable()) {
      console.log(
        '[DeviceService] iOS polling not started - enabled:',
        this.iosConfig.enabled,
        'available:',
        isIOSSupportAvailable()
      );
      return;
    }

    console.log('[DeviceService] Starting iOS device polling');

    // Poll every 3 seconds for iOS device changes
    this.iosDevicePollingInterval = setInterval(async () => {
      if (!this.appState.isMonitoring() || this.isPollingIOS) {
        return;
      }

      // Skip polling if we have an active iOS connection to avoid CoreMediaIO conflicts
      if (this.hasActiveIOSSession()) {
        return;
      }

      this.isPollingIOS = true;

      try {
        const iosDevices = await iOSDeviceManager.getAvailableDevices(this.config.videoSource);
        const currentSerials = new Set(iosDevices.map((d) => d.serial));

        // Re-check active session after potentially long poll
        if (this.hasActiveIOSSession()) {
          this.isPollingIOS = false;
          return;
        }

        console.log(
          '[DeviceService] iOS poll: found',
          iosDevices.length,
          'devices, known:',
          this.knownIOSDeviceSerials.size,
          'autoConnect:',
          this.config.autoConnect
        );

        // Find new iOS devices and auto-connect
        if (this.config.autoConnect) {
          for (const device of iosDevices) {
            // ... (rest of new device detection)
            // Skip if already known or already has a session (any state)
            if (this.knownIOSDeviceSerials.has(device.serial)) {
              continue;
            }
            if (this.findSessionBySerial(device.serial)) {
              continue;
            }

            console.log('[DeviceService] New iOS device detected:', device.serial);
            this.knownIOSDeviceSerials.add(device.serial);
            this.statusCallback('', vscode.l10n.t('Connecting to {0}...', device.name));

            try {
              await this.addDevice(device);
              console.log('[DeviceService] iOS device connected successfully:', device.serial);
            } catch (error) {
              console.error('[DeviceService] Failed to connect to iOS device:', error);
            }
          }
        }

        // Handle disconnected iOS devices
        // ONLY if no active session (double-check to avoid killing a session that just started)
        if (!this.hasActiveIOSSession()) {
          for (const serial of Array.from(this.knownIOSDeviceSerials)) {
            if (!currentSerials.has(serial)) {
              console.log('[DeviceService] iOS device disconnected:', serial);
              this.knownIOSDeviceSerials.delete(serial);

              const session = this.findSessionBySerial(serial);
              if (session) {
                this.removeDevice(session.deviceId);
              }
            }
          }
        }
      } catch (error) {
        console.error('[DeviceService] iOS device polling error:', error);
      } finally {
        this.isPollingIOS = false;
      }
    }, 3000);
  }

  /**
   * Check if there is any active iOS session
   */
  private hasActiveIOSSession(): boolean {
    for (const session of this.sessions.values()) {
      if (session.deviceInfo.platform === 'ios' && !session.isDisposed && session.connection) {
        return true;
      }
    }
    return false;
  }

  /**
   * Stop iOS device polling
   */
  private stopIOSDevicePolling(): void {
    if (this.iosDevicePollingInterval) {
      clearInterval(this.iosDevicePollingInterval);
      this.iosDevicePollingInterval = null;
    }
    this.knownIOSDeviceSerials.clear();
  }

  /**
   * Stop all iOS connections and disable iOS support
   */
  stopAllIOSConnections(): void {
    console.log('[DeviceService] Stopping all iOS connections');

    // Stop polling
    this.stopIOSDevicePolling();

    // Stop all iOS sessions
    for (const [deviceId, session] of this.sessions) {
      if (session.deviceInfo.platform === 'ios' && session.connection) {
        console.log(`[DeviceService] Stopping iOS connection: ${deviceId}`);
        session.connection.disconnect();
        session.connection = null;
        this.appState.updateDeviceConnectionState(deviceId, 'disconnected');
      }
    }

    // Remove iOS devices from known devices
    this.knownIOSDeviceSerials.clear();
  }

  /**
   * Pair with a device over WiFi using Android 11+ Wireless Debugging
   */
  async pairWifi(address: string, pairingCode: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const adb = spawn(this.getAdbCommand(), ['pair', address]);

      let stdout = '';
      let stderr = '';
      let pairingCodeSent = false;

      adb.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        stdout += output;

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

        if (
          code === 0 &&
          (output.includes('successfully paired') || output.includes('paired to'))
        ) {
          resolve();
        } else if (output.includes('failed') || output.includes('error') || code !== 0) {
          reject(new Error(stderr || stdout || 'Pairing failed'));
        } else {
          resolve();
        }
      });

      adb.on('error', (error: Error) => {
        reject(error);
      });

      setTimeout(() => {
        adb.kill();
        reject(new Error('Pairing timed out'));
      }, 30000);
    });
  }

  /**
   * Connect to a device over WiFi using ADB
   */
  async connectWifi(ipAddress: string, port: number = 5555): Promise<DeviceInfo> {
    const address = `${ipAddress}:${port}`;
    const adbCmd = this.getAdbCommand();

    return new Promise((resolve, reject) => {
      execFile(adbCmd, ['connect', address], (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        const output = stdout.toLowerCase();
        if (output.includes('connected to') || output.includes('already connected')) {
          try {
            const modelOutput = execFileSync(
              adbCmd,
              ['-s', address, 'shell', 'getprop', 'ro.product.model'],
              {
                timeout: 5000,
                encoding: 'utf8',
              }
            ).trim();

            resolve({
              serial: address,
              name: modelOutput || address,
              model: modelOutput || undefined,
              platform: 'android',
            });
          } catch {
            resolve({
              serial: address,
              name: address,
              model: undefined,
              platform: 'android',
            });
          }
        } else if (
          output.includes('failed') ||
          output.includes('unable') ||
          output.includes('cannot')
        ) {
          let errorMsg = stdout.trim();
          if (output.includes('connection refused') || output.includes('failed to connect')) {
            errorMsg +=
              '\n\n' +
              vscode.l10n.t(
                'For Android 11+, you need to pair the device first using "Pair new device".'
              );
          }
          reject(new Error(errorMsg));
        } else {
          resolve({
            serial: address,
            name: address,
            model: undefined,
            platform: 'android',
          });
        }
      });
    });
  }

  /**
   * Disconnect a WiFi device from ADB
   */
  async disconnectWifi(address: string): Promise<void> {
    const adbCmd = this.getAdbCommand();
    return new Promise((resolve, reject) => {
      execFile(adbCmd, ['disconnect', address], (error, stdout, stderr) => {
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
      throw new Error(vscode.l10n.t('Device already connected'));
    }

    const deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Create internal session
    const session: DeviceSession = {
      deviceId,
      deviceInfo,
      connection: null,
      isPaused: false,
      retryCount: 0,
      isReconnecting: false,
      isDisposed: false,
      effectiveCodec: this.config.videoCodec,
      lastWidth: 0,
      lastHeight: 0,
      lastConfigData: null,
      lastKeyFrameData: null,
      lastCodec: 'h264',
    };

    this.sessions.set(deviceId, session);

    // Pause the currently active session (if any)
    const currentActiveId = this.appState.getActiveDeviceId();
    if (currentActiveId) {
      const oldSession = this.sessions.get(currentActiveId);
      if (oldSession) {
        oldSession.isPaused = true;
      }
    }

    // Add device to AppState
    this.appState.addDevice({
      deviceId,
      serial: deviceInfo.serial,
      name: deviceInfo.name,
      model: deviceInfo.model,
      platform: deviceInfo.platform,
      capabilities: getCapabilities(deviceInfo.platform),
      connectionState: 'connecting',
      isActive: true,
    });

    // Set as active device
    this.appState.setActiveDevice(deviceId);

    try {
      await this.connectSession(session);
    } catch {
      // Error already reported via callback
      // Remove failed session
      this.sessions.delete(deviceId);
      this.appState.removeDevice(deviceId);

      // Switch to first available session
      const deviceIds = this.appState.getDeviceIds();
      if (deviceIds.length > 0) {
        this.switchToDevice(deviceIds[0]);
      }
      throw new Error(vscode.l10n.t('Failed to connect'));
    }

    return deviceId;
  }

  /**
   * Connect a session (routes to platform-specific connection handler)
   */
  private async connectSession(session: DeviceSession): Promise<void> {
    // Update state to connecting
    this.appState.updateDeviceConnectionState(session.deviceId, 'connecting');

    if (session.deviceInfo.platform === 'ios') {
      await this.connectiOSSession(session);
    } else {
      await this.connectWithCodecFallback(session);
    }
  }

  /**
   * Connect an iOS device session
   */
  private async connectiOSSession(session: DeviceSession): Promise<void> {
    // Pass iOS config for WDA support (Phase 8)
    const connection = new iOSConnection(
      session.deviceInfo.serial,
      undefined, // customHelperPath
      this.iosConfig,
      this.config.videoSource
    );

    // Wire up video frame callback
    connection.onVideoFrame = (data, isConfig, isKeyFrame, width, height, codec) => {
      // Store dimensions, config data, and codec for replay on resume
      if (width && height) {
        session.lastWidth = width;
        session.lastHeight = height;
        this.appState.updateDeviceVideoDimensions(
          session.deviceId,
          width,
          height,
          codec as VideoCodec | undefined
        );
      }
      if (codec) {
        session.lastCodec = codec;
      }
      if (isConfig && data.length > 0) {
        session.lastConfigData = data;
      }
      if (isKeyFrame && data.length > 0) {
        session.lastKeyFrameData = data;
      }

      // Only forward frames if not paused
      if (!session.isPaused) {
        this.videoFrameCallback(session.deviceId, data, isConfig, isKeyFrame, width, height, codec);
      }
    };

    // Wire up status and error callbacks
    connection.onStatus = (status) => {
      if (this.isiOSConnection(connection) && status.startsWith('WDA:')) {
        return; // Keep WDA handling transparent; use overlay instead
      }
      this.statusCallback(session.deviceId, status);
    };
    connection.onError = (error) => this.handleDisconnect(session, error);

    // Wire up capabilities change callback (for WDA connection status)
    connection.onCapabilitiesChanged = (capabilities) => {
      this.appState.updateDevice(session.deviceId, { capabilities });
    };

    session.connection = connection;

    try {
      await connection.connect(session.deviceInfo.serial);
      await connection.startStreaming({});

      // Reset retry count on successful connection
      session.retryCount = 0;

      // Update state to connected
      this.appState.updateDeviceConnectionState(session.deviceId, 'connected');

      // Clear any loading status message
      this.appState.clearStatusMessage();

      // Set initial WDA status immediately, then fetch full device info
      const wdaStatus: 'connected' | 'unavailable' | 'disabled' = this.iosConfig
        .webDriverAgentEnabled
        ? connection.isWdaReady
          ? 'connected'
          : 'unavailable'
        : 'disabled';

      // Set initial device info with screen resolution from video stream
      const initialInfo: DeviceDetailedInfo = {
        serial: session.deviceInfo.serial,
        model: session.deviceInfo.model || 'iOS Device',
        manufacturer: 'Apple',
        androidVersion: '', // Will be populated by getiOSDeviceInfo
        sdkVersion: 0,
        batteryLevel: 0,
        batteryCharging: false,
        storageTotal: 0,
        storageUsed: 0,
        screenResolution:
          connection.deviceWidth && connection.deviceHeight
            ? `${connection.deviceWidth}x${connection.deviceHeight}`
            : 'Unknown',
        wdaStatus,
      };
      this.appState.setDeviceInfo(session.deviceInfo.serial, initialInfo);

      // Fetch full device info in background (non-blocking)
      this.getiOSDeviceInfo(session.deviceInfo.serial)
        .then((info) => {
          // Update with full info while preserving WDA status
          this.appState.setDeviceInfo(session.deviceInfo.serial, {
            ...info,
            wdaStatus: this.getWDAStatusForSerial(session.deviceInfo.serial) || wdaStatus,
          });
        })
        .catch((error) => {
          console.error('[DeviceService] Failed to fetch iOS device info:', error);
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appState.updateDeviceConnectionState(session.deviceId, 'disconnected');
      this.errorCallback(session.deviceId, message, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Attempt connection with codec fallback on failure
   */
  private async connectWithCodecFallback(session: DeviceSession): Promise<void> {
    const effectiveConfig: ScrcpyConfig = {
      ...this.config,
      videoCodec: session.effectiveCodec,
    };

    session.connection = new ScrcpyConnection(
      (data, isConfig, isKeyFrame, width, height, codec) => {
        // Store dimensions, config data, and codec for replay on resume
        if (width && height) {
          session.lastWidth = width;
          session.lastHeight = height;
          // Update AppState with dimensions
          this.appState.updateDeviceVideoDimensions(
            session.deviceId,
            width,
            height,
            codec as VideoCodec | undefined
          );
        }
        if (codec) {
          session.lastCodec = codec;
        }
        if (isConfig && data.length > 0) {
          session.lastConfigData = data;
        }
        if (isKeyFrame && data.length > 0) {
          session.lastKeyFrameData = data;
        }

        // Only forward frames if not paused
        if (!session.isPaused) {
          this.videoFrameCallback(
            session.deviceId,
            data,
            isConfig,
            isKeyFrame,
            width,
            height,
            codec
          );
        }
      },
      (status) => this.statusCallback(session.deviceId, status),
      effectiveConfig,
      session.deviceInfo.serial,
      undefined,
      this.clipboardAPI,
      (error) => this.handleDisconnect(session, error),
      (data, isConfig) => {
        if (!session.isPaused) {
          this.audioFrameCallback(session.deviceId, data, isConfig);
        }
      }
    );

    try {
      await session.connection.connect();
      await session.connection.startScrcpy();
      // Reset retry count on successful connection
      session.retryCount = 0;

      // Update state to connected
      this.appState.updateDeviceConnectionState(session.deviceId, 'connected');

      // Clear any loading status message now that we're connected
      this.appState.clearStatusMessage();

      // Notify if we fell back to a different codec
      if (session.effectiveCodec !== this.config.videoCodec) {
        this.statusCallback(
          session.deviceId,
          vscode.l10n.t(
            'Using {0} codec (fallback from {1})',
            session.effectiveCodec,
            this.config.videoCodec
          )
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Check if we can fall back to another codec
      const fallbackCodec = CODEC_FALLBACK[session.effectiveCodec];
      if (fallbackCodec) {
        this.statusCallback(
          session.deviceId,
          vscode.l10n.t(
            '{0} codec failed, trying {1}...',
            session.effectiveCodec.toUpperCase(),
            fallbackCodec.toUpperCase()
          )
        );
        session.effectiveCodec = fallbackCodec;

        // Clean up failed connection
        if (session.connection) {
          await session.connection.disconnect();
          session.connection = null;
        }

        // Retry with fallback codec
        await this.connectWithCodecFallback(session);
        return;
      }

      // No more fallbacks available
      this.appState.updateDeviceConnectionState(session.deviceId, 'disconnected');
      this.errorCallback(session.deviceId, message, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Handle unexpected disconnect with auto-reconnect
   */
  private async handleDisconnect(session: DeviceSession, error: string): Promise<void> {
    // Don't reconnect if disposed or already reconnecting
    if (session.isDisposed || session.isReconnecting) {
      return;
    }

    const maxRetries = this.config.autoReconnect ? this.config.reconnectRetries : 0;

    // Retry loop
    while (session.retryCount < maxRetries && !session.isDisposed) {
      session.isReconnecting = true;
      session.retryCount++;

      this.appState.updateDeviceConnectionState(session.deviceId, 'reconnecting');

      this.statusCallback(
        session.deviceId,
        vscode.l10n.t('Reconnecting (attempt {0}/{1})...', session.retryCount, maxRetries)
      );

      // Wait before reconnecting
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

      if (session.isDisposed) {
        session.isReconnecting = false;
        return;
      }

      try {
        // Cleanup old connection
        if (session.connection) {
          await session.connection.disconnect();
          session.connection = null;
        }

        // Try to reconnect
        await this.connectSession(session);
        session.isReconnecting = false;
        return; // Success!
      } catch {
        session.isReconnecting = false;
      }
    }

    // All retries exhausted
    this.appState.updateDeviceConnectionState(session.deviceId, 'disconnected');
    this.errorCallback(session.deviceId, error);
    this.handleSessionFailed(session.deviceId);
  }

  /**
   * Switch active device tab
   */
  switchToDevice(deviceId: string): void {
    const newSession = this.sessions.get(deviceId);
    if (!newSession) {
      return;
    }

    const currentActiveId = this.appState.getActiveDeviceId();

    // Pause old active session
    if (currentActiveId && currentActiveId !== deviceId) {
      const oldSession = this.sessions.get(currentActiveId);
      if (oldSession) {
        oldSession.isPaused = true;
      }
    }

    // Activate new session
    newSession.isPaused = false;
    this.appState.setActiveDevice(deviceId);

    // Resume - send cached frames
    this.resumeSession(newSession);
  }

  /**
   * Resume a session by sending cached config and keyframe
   */
  private resumeSession(session: DeviceSession): void {
    if (session.lastWidth && session.lastHeight) {
      // First re-send config/dimensions with codec
      if (session.lastConfigData) {
        this.videoFrameCallback(
          session.deviceId,
          session.lastConfigData,
          true,
          false,
          session.lastWidth,
          session.lastHeight,
          session.lastCodec
        );
      } else {
        // Just dimensions with codec
        this.videoFrameCallback(
          session.deviceId,
          new Uint8Array(0),
          true,
          false,
          session.lastWidth,
          session.lastHeight,
          session.lastCodec
        );
      }

      // Then re-send last keyframe
      if (session.lastKeyFrameData) {
        this.videoFrameCallback(
          session.deviceId,
          session.lastKeyFrameData,
          false,
          true,
          undefined,
          undefined,
          session.lastCodec
        );
      }
    }
  }

  /**
   * Remove device session (user-initiated close)
   */
  async removeDevice(deviceId: string): Promise<void> {
    const session = this.sessions.get(deviceId);
    if (!session) {
      return;
    }

    // Mark as manually closed to prevent auto-reconnect
    const deviceSerial = session.deviceInfo.serial;
    this.knownDeviceSerials.add(deviceSerial);

    session.isDisposed = true;
    if (session.connection) {
      await session.connection.disconnect();
      session.connection = null;
    }
    this.sessions.delete(deviceId);

    // Remove from AppState
    this.appState.removeDevice(deviceId);

    // Check remaining devices
    const deviceIds = this.appState.getDeviceIds();

    if (deviceIds.length === 0) {
      // No devices left - clear any error/loading messages and show empty state
      this.appState.setStatusMessage({
        type: 'empty',
        text: vscode.l10n.t('No devices found.\n\nConnect a device via USB to get started.'),
      });
    } else if (this.appState.getActiveDeviceId() === null) {
      // If removed active device, switch to first available
      this.switchToDevice(deviceIds[0]);
    }
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
   * Get session by device ID
   */
  private getSession(deviceId: string): DeviceSession | undefined {
    return this.sessions.get(deviceId);
  }

  /**
   * Get active session
   */
  private getActiveSession(): DeviceSession | undefined {
    const activeId = this.appState.getActiveDeviceId();
    return activeId ? this.sessions.get(activeId) : undefined;
  }

  // ==================== Device Control Methods ====================

  /**
   * Type guard to check if connection is a ScrcpyConnection (Android)
   */
  private isScrcpyConnection(
    connection: ScrcpyConnection | iOSConnection | null
  ): connection is ScrcpyConnection {
    return connection !== null && connection.platform === 'android';
  }

  /**
   * Type guard to check if connection is an iOSConnection
   */
  private isiOSConnection(
    connection: ScrcpyConnection | iOSConnection | null
  ): connection is iOSConnection {
    return connection !== null && connection.platform === 'ios';
  }

  /**
   * Get active Android connection (returns null for iOS devices)
   */
  private getActiveAndroidConnection(): ScrcpyConnection | null {
    const connection = this.getActiveSession()?.connection ?? null;
    return this.isScrcpyConnection(connection) ? connection : null;
  }

  /**
   * Get active connection that supports input (Android or iOS with WDA)
   * Returns the connection if it supports touch input, otherwise null
   */
  private getActiveInputConnection(): ScrcpyConnection | iOSConnection | null {
    const connection = this.getActiveSession()?.connection ?? null;
    if (connection && connection.capabilities.supportsTouch) {
      return connection;
    }
    return null;
  }

  sendTouch(
    x: number,
    y: number,
    action: 'down' | 'move' | 'up',
    screenWidth: number,
    screenHeight: number
  ): void {
    const connection = this.getActiveInputConnection();
    if (!connection) {
      return;
    }

    if (this.isScrcpyConnection(connection)) {
      // Android: use existing sendTouch method
      connection.sendTouch(x, y, action, screenWidth, screenHeight);
    } else if (this.isiOSConnection(connection)) {
      // iOS: convert action to code and call sendTouch
      const actionCode = action === 'down' ? 0 : action === 'up' ? 1 : 2;
      connection.sendTouch(actionCode, x, y);
    }
  }

  sendMultiTouch(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    action: 'down' | 'move' | 'up',
    screenWidth: number,
    screenHeight: number
  ): void {
    // Multi-touch only supported on Android currently
    this.getActiveAndroidConnection()?.sendMultiTouch(
      x1,
      y1,
      x2,
      y2,
      action,
      screenWidth,
      screenHeight
    );
  }

  sendKeyDown(keycode: number): void {
    const connection = this.getActiveInputConnection();
    if (!connection) {
      return;
    }

    if (this.isScrcpyConnection(connection)) {
      connection.sendKeyDown(keycode);
    } else if (this.isiOSConnection(connection)) {
      connection.sendKey(0, keycode); // 0 = down
    }
  }

  sendKeyUp(keycode: number): void {
    const connection = this.getActiveInputConnection();
    if (!connection) {
      return;
    }

    if (this.isScrcpyConnection(connection)) {
      connection.sendKeyUp(keycode);
    } else if (this.isiOSConnection(connection)) {
      connection.sendKey(1, keycode); // 1 = up
    }
  }

  sendText(text: string): void {
    const connection = this.getActiveInputConnection();
    if (!connection) {
      return;
    }

    if (this.isScrcpyConnection(connection)) {
      connection.sendText(text);
    } else if (this.isiOSConnection(connection)) {
      connection.injectText(text);
    }
  }

  sendKeyWithMeta(keycode: number, action: 'down' | 'up', metastate: number): void {
    // Meta keys only supported on Android
    this.getActiveAndroidConnection()?.sendKeyWithMeta(keycode, action, metastate);
  }

  sendScroll(x: number, y: number, deltaX: number, deltaY: number): void {
    const connection = this.getActiveInputConnection();
    if (!connection) {
      return;
    }

    if (this.isScrcpyConnection(connection)) {
      connection.sendScroll(x, y, deltaX, deltaY);
    } else if (this.isiOSConnection(connection)) {
      connection.sendScroll(x, y, deltaX, deltaY);
    }
  }

  updateDimensions(deviceId: string, width: number, height: number): void {
    const session = this.sessions.get(deviceId);
    const connection = session?.connection ?? null;
    if (this.isScrcpyConnection(connection)) {
      connection.updateDimensions(width, height);
    }
  }

  async pasteFromHost(): Promise<void> {
    const connection = this.getActiveSession()?.connection;
    await connection?.pasteFromHost?.();
  }

  async copyToHost(): Promise<void> {
    const connection = this.getActiveSession()?.connection;
    await connection?.copyToHost?.();
  }

  /**
   * Manually start WebDriverAgent for the current (or specified) iOS session
   */
  async startIOSInput(deviceId?: string): Promise<void> {
    const session = deviceId ? this.sessions.get(deviceId) : this.getActiveSession();
    if (!session || session.deviceInfo.platform !== 'ios') {
      return;
    }

    if (!this.iosConfig.webDriverAgentEnabled) {
      this.statusCallback(
        session.deviceId,
        vscode.l10n.t('Enable WebDriverAgent in settings to start iOS input control.')
      );
      return;
    }

    const connection = session.connection;
    if (!connection || !this.isiOSConnection(connection)) {
      return;
    }

    if (connection.isWdaReady) {
      return;
    }

    const serial = session.deviceInfo.serial;
    const existingInfo = this.appState.getDeviceInfo(serial) ?? this.getIOSFallbackInfo(serial);
    this.appState.setDeviceInfo(serial, { ...existingInfo, wdaStatus: 'connecting' });

    const success = await connection.startWda();

    const latestInfo = this.appState.getDeviceInfo(serial) ?? existingInfo;
    const wdaStatus: 'connected' | 'unavailable' = success ? 'connected' : 'unavailable';
    this.appState.setDeviceInfo(serial, { ...latestInfo, wdaStatus });

    if (!success) {
      this.statusCallback(
        session.deviceId,
        vscode.l10n.t('WebDriverAgent unavailable. Use the setup script to start it.')
      );
      return;
    }

    // Ensure capabilities propagate after WDA connects
    this.appState.updateDevice(session.deviceId, { capabilities: connection.capabilities });
  }

  rotateDevice(): void {
    const connection = this.getActiveSession()?.connection;
    connection?.rotate?.();
  }

  expandNotificationPanel(): void {
    this.getActiveAndroidConnection()?.expandNotificationPanel();
  }

  expandSettingsPanel(): void {
    this.getActiveAndroidConnection()?.expandSettingsPanel();
  }

  collapsePanels(): void {
    this.getActiveAndroidConnection()?.collapsePanels();
  }

  async takeScreenshot(): Promise<Buffer> {
    const connection = this.getActiveSession()?.connection;
    if (!connection?.takeScreenshot) {
      throw new Error(vscode.l10n.t('No active device or screenshot not supported'));
    }
    const screenshot = await connection.takeScreenshot();
    if (!screenshot) {
      throw new Error(vscode.l10n.t('Screenshot not available'));
    }
    return screenshot;
  }

  async listCameras(): Promise<string> {
    const connection = this.getActiveAndroidConnection();
    if (!connection) {
      throw new Error(vscode.l10n.t('No active Android device'));
    }
    return connection.listCameras();
  }

  async installApk(filePath: string): Promise<void> {
    const connection = this.getActiveAndroidConnection();
    if (!connection) {
      throw new Error(vscode.l10n.t('APK installation is only supported on Android devices'));
    }
    await connection.installApk(filePath);
  }

  async pushFiles(filePaths: string[], destPath?: string): Promise<void> {
    const connection = this.getActiveAndroidConnection();
    if (!connection) {
      throw new Error(vscode.l10n.t('File upload is only supported on Android devices'));
    }
    await connection.pushFiles(filePaths, destPath);
  }

  async launchApp(appId: string): Promise<void> {
    const connection = this.getActiveSession()?.connection;
    if (!connection?.launchApp) {
      throw new Error(vscode.l10n.t('No active device or app launch not supported'));
    }
    await connection.launchApp(appId);
  }

  async getInstalledApps(): Promise<Array<{ appId: string; displayName: string }>> {
    const connection = this.getActiveSession()?.connection;
    if (!connection?.getInstalledApps) {
      throw new Error(vscode.l10n.t('No active device or app listing not supported'));
    }
    return connection.getInstalledApps();
  }

  async getDisplays(deviceId?: string): Promise<Array<{ id: number; info: string }>> {
    const session = deviceId ? this.sessions.get(deviceId) : this.getActiveSession();
    const connection = session?.connection ?? null;
    if (!this.isScrcpyConnection(connection)) {
      throw new Error(vscode.l10n.t('No active Android device'));
    }
    return connection.listDisplays();
  }

  // ==================== Session Management ====================

  /**
   * Disconnect all sessions
   */
  async disconnectAll(): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.values()).map(async (s) => {
        s.isDisposed = true;
        if (s.connection) {
          await s.connection.disconnect();
        }
      })
    );
    this.sessions.clear();
    this.deviceInfoCache.clear();
    this.stopDeviceInfoRefresh();

    // Clear all devices from AppState
    this.appState.clearAllDevices();
  }

  /**
   * Update config for future connections
   */
  updateConfig(config: ScrcpyConfig): void {
    this.config = config;
  }

  /**
   * Handle session failure (all reconnect attempts exhausted)
   */
  private handleSessionFailed(deviceId: string): void {
    const session = this.sessions.get(deviceId);
    if (!session) {
      return;
    }

    const deviceSerial = session.deviceInfo.serial;

    // Remove the failed session
    this.sessions.delete(deviceId);
    this.appState.removeDevice(deviceId);

    // Remove from known devices so auto-connect can pick it up again
    this.knownDeviceSerials.delete(deviceSerial);

    // Switch to first available session if any
    const deviceIds = this.appState.getDeviceIds();
    if (deviceIds.length > 0 && this.appState.getActiveDeviceId() === null) {
      this.switchToDevice(deviceIds[0]);
    }
  }

  // ==================== Device Monitoring ====================

  /**
   * Start monitoring for new devices using adb track-devices
   */
  async startDeviceMonitoring(): Promise<void> {
    if (this.appState.isMonitoring()) {
      return;
    }
    this.appState.setMonitoring(true);

    // Initialize known devices with currently connected sessions
    this.knownDeviceSerials.clear();
    this.knownIOSDeviceSerials.clear();
    for (const session of this.sessions.values()) {
      const serial = session.deviceInfo.serial;
      if (session.deviceInfo.platform === 'ios') {
        this.knownIOSDeviceSerials.add(serial);
      } else {
        this.knownDeviceSerials.add(serial);
      }
    }

    // Mark existing devices as known if we have active sessions
    if (this.sessions.size > 0) {
      const devices = await this.getAvailableDevices();
      for (const device of devices) {
        if (device.platform === 'ios') {
          this.knownIOSDeviceSerials.add(device.serial);
        } else {
          this.knownDeviceSerials.add(device.serial);
        }
      }
    }

    // Start adb track-devices process
    this.startTrackDevices();

    // Prewarm iOS screen capture to make muxed devices appear faster
    if (this.iosConfig.enabled && this.config.videoSource === 'display' && !this.iosPrewarmDone) {
      this.iosPrewarmDone = true;
      void iOSDeviceManager.prewarm(this.config.videoSource).catch((error) => {
        console.warn('[DeviceService] iOS prewarm failed:', error);
      });
    }

    // Start iOS device polling (if enabled)
    this.startIOSDevicePolling();

    // Start periodic device info refresh
    this.startDeviceInfoRefresh();
  }

  /**
   * Start the adb track-devices process
   */
  private startTrackDevices(): void {
    if (!this.appState.isMonitoring()) {
      return;
    }

    if (this.trackDevicesRestartTimeout) {
      clearTimeout(this.trackDevicesRestartTimeout);
      this.trackDevicesRestartTimeout = null;
    }

    if (this.trackDevicesProcess) {
      this.trackDevicesProcess.kill();
    }

    this.trackDevicesProcess = spawn(this.getAdbCommand(), ['track-devices']);
    let buffer = '';

    this.trackDevicesProcess.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();

      // Parse track-devices output: <4-char hex length><device list>
      while (buffer.length >= 4) {
        const lengthHex = buffer.substring(0, 4);
        const length = parseInt(lengthHex, 16);

        if (isNaN(length)) {
          buffer = '';
          break;
        }

        if (buffer.length < 4 + length) {
          break;
        }

        const deviceList = buffer.substring(4, 4 + length);
        buffer = buffer.substring(4 + length);

        this.enqueueDeviceListUpdate(deviceList);
      }
    });

    this.trackDevicesProcess.on('error', (error) => {
      console.error('track-devices error:', error);
    });

    this.trackDevicesProcess.on('close', () => {
      if (this.appState.isMonitoring()) {
        this.trackDevicesRestartTimeout = setTimeout(() => this.startTrackDevices(), 1000);
      }
    });
  }

  /**
   * Ensure device list updates are processed sequentially
   */
  private enqueueDeviceListUpdate(deviceList: string): void {
    this.deviceListUpdateChain = this.deviceListUpdateChain
      .then(async () => {
        await this.handleDeviceListUpdate(deviceList);
      })
      .catch((error) => {
        console.error('Failed to handle device list update:', error);
      });
  }

  /**
   * Handle device list update from track-devices
   */
  private async handleDeviceListUpdate(deviceList: string): Promise<void> {
    if (!this.appState.isMonitoring() || !this.config.autoConnect) {
      return;
    }

    const lines = deviceList
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);
    const currentDevices: DeviceInfo[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[1] === 'device') {
        const serial = parts[0];
        if (serial.includes('_adb-tls-connect')) {
          continue;
        }
        currentDevices.push({
          serial,
          name: serial,
          model: undefined,
          platform: 'android',
        });
      }
    }

    const currentSerials = new Set(currentDevices.map((d) => d.serial));

    // Find new USB devices and auto-connect
    for (const device of currentDevices) {
      if (!this.appState.isMonitoring()) {
        return;
      }
      // Skip WiFi devices for auto-connect
      if (this.isWifiDevice(device.serial)) {
        continue;
      }

      if (!this.knownDeviceSerials.has(device.serial) && !this.isDeviceConnected(device.serial)) {
        // Get device model name
        try {
          const modelOutput = execFileSync(
            this.getAdbCommand(),
            ['-s', device.serial, 'shell', 'getprop', 'ro.product.model'],
            {
              timeout: 5000,
              encoding: 'utf8',
            }
          ).trim();
          device.name = modelOutput || device.serial;
          device.model = modelOutput || undefined;
        } catch {
          // Keep serial as name
        }

        this.statusCallback('', vscode.l10n.t('Connecting to {0}...', device.name));

        try {
          if (!this.appState.isMonitoring()) {
            return;
          }
          await this.addDevice(device);
          this.knownDeviceSerials.add(device.serial);
        } catch {
          // Failed to connect
        }
      }
    }

    // Remove unplugged USB devices from known list
    for (const serial of Array.from(this.knownDeviceSerials)) {
      if (!currentSerials.has(serial) && !this.isWifiDevice(serial)) {
        this.knownDeviceSerials.delete(serial);
      }
    }
  }

  /**
   * Stop monitoring for new devices
   */
  stopDeviceMonitoring(): void {
    this.appState.setMonitoring(false);
    if (this.trackDevicesRestartTimeout) {
      clearTimeout(this.trackDevicesRestartTimeout);
      this.trackDevicesRestartTimeout = null;
    }
    if (this.trackDevicesProcess) {
      this.trackDevicesProcess.kill();
      this.trackDevicesProcess = null;
    }
    this.knownDeviceSerials.clear();
    this.stopDeviceInfoRefresh();
    this.stopIOSDevicePolling();
  }

  /**
   * Check if a device serial represents a WiFi connection
   */
  private isWifiDevice(serial: string): boolean {
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(serial);
  }
}
