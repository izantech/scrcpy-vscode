/**
 * Centralized Application State Manager
 *
 * This class is the single source of truth for all application state.
 * Components subscribe to state changes and receive complete snapshots.
 */

import * as vscode from 'vscode';
import {
  AppState,
  AppStateSnapshot,
  DeviceState,
  DeviceDetailedInfo,
  ToolStatus,
  WebviewSettings,
  StatusMessage,
  DeviceUISettings,
} from './types/AppState';
import { ActionType, AppAction } from './types/Actions';

/**
 * Listener function type for state changes
 */
export type StateListener = (snapshot: AppStateSnapshot) => void;

/**
 * Unsubscribe function type
 */
export type Unsubscribe = () => void;

/**
 * Centralized state manager for the application
 */
export class AppStateManager {
  private static readonly ALLOWED_DEVICES_KEY = 'scrcpy.allowedAutoConnectDevices';
  private static readonly BLOCKED_DEVICES_KEY = 'scrcpy.blockedAutoConnectDevices';
  private static readonly CONTROL_CENTER_CACHE_KEY = 'controlCenterCache';

  private state: AppState;
  private listeners = new Set<StateListener>();
  private notifyScheduled = false;

  constructor(private storage?: vscode.Memento) {
    const allowedDevices = storage
      ? storage.get<string[]>(AppStateManager.ALLOWED_DEVICES_KEY, [])
      : [];
    const blockedDevices = storage
      ? storage.get<string[]>(AppStateManager.BLOCKED_DEVICES_KEY, [])
      : [];

    const controlCenterCache = storage
      ? storage.get<Record<string, DeviceUISettings>>(AppStateManager.CONTROL_CENTER_CACHE_KEY, {})
      : {};

    this.state = {
      devices: new Map(),
      activeDeviceId: null,
      settings: {
        showStats: false,
        showExtendedStats: false,
        audioEnabled: true,
        showTouchRipples: false,
      },
      toolStatus: {
        adbAvailable: true,
        scrcpyAvailable: true,
      },
      statusMessage: undefined,
      deviceInfo: new Map(),
      isMonitoring: false,
      allowedAutoConnectDevices: new Set(allowedDevices),
      blockedAutoConnectDevices: new Set(blockedDevices),
      controlCenterCache,
    };
  }

  /**
   * Dispatch an action to update the state
   */
  public dispatch(action: AppAction): void {
    if (this.reducer(action)) {
      this.notifyListeners();
    }
  }

  /**
   * Reducer to handle state transitions
   * Returns true if state was modified
   */
  private reducer(action: AppAction): boolean {
    switch (action.type) {
      case ActionType.ADD_DEVICE: {
        this.state.devices.set(action.payload.deviceId, { ...action.payload });
        return true;
      }
      case ActionType.REMOVE_DEVICE: {
        const { deviceId } = action.payload;
        const device = this.state.devices.get(deviceId);
        if (this.state.devices.delete(deviceId)) {
          if (device) {
            this.state.deviceInfo.delete(device.serial);
          }
          if (this.state.activeDeviceId === deviceId) {
            this.state.activeDeviceId = null;
          }
          return true;
        }
        return false;
      }
      case ActionType.UPDATE_DEVICE: {
        const { deviceId, updates } = action.payload;
        const device = this.state.devices.get(deviceId);
        if (device) {
          this.state.devices.set(deviceId, { ...device, ...updates });
          return true;
        }
        return false;
      }
      case ActionType.SET_ACTIVE_DEVICE: {
        const { deviceId } = action.payload;
        if (this.state.activeDeviceId !== deviceId) {
          // Update isActive flags
          for (const [id, device] of this.state.devices) {
            const isActive = id === deviceId;
            if (device.isActive !== isActive) {
              this.state.devices.set(id, { ...device, isActive });
            }
          }
          this.state.activeDeviceId = deviceId;
          return true;
        }
        return false;
      }
      case ActionType.UPDATE_SETTINGS: {
        this.state.settings = { ...this.state.settings, ...action.payload };
        return true;
      }
      case ActionType.UPDATE_TOOL_STATUS: {
        this.state.toolStatus = { ...action.payload };
        return true;
      }
      case ActionType.SET_STATUS_MESSAGE: {
        const newMessage = action.payload ? { ...action.payload } : undefined;
        // Simple equality check
        const currentJson = JSON.stringify(this.state.statusMessage);
        const newJson = JSON.stringify(newMessage);
        if (currentJson !== newJson) {
          this.state.statusMessage = newMessage;
          return true;
        }
        return false;
      }
      case ActionType.SET_DEVICE_INFO: {
        this.state.deviceInfo.set(action.payload.serial, { ...action.payload.info });
        return true;
      }
      case ActionType.REMOVE_DEVICE_INFO: {
        if (this.state.deviceInfo.delete(action.payload.serial)) {
          return true;
        }
        return false;
      }
      case ActionType.CLEAR_DEVICE_INFO: {
        if (this.state.deviceInfo.size > 0) {
          this.state.deviceInfo.clear();
          return true;
        }
        return false;
      }
      case ActionType.SET_MONITORING: {
        if (this.state.isMonitoring !== action.payload.isMonitoring) {
          this.state.isMonitoring = action.payload.isMonitoring;
          // Monitoring state change does not trigger UI update
          return false;
        }
        return false;
      }
      case ActionType.CLEAR_ALL_DEVICES: {
        if (
          this.state.devices.size > 0 ||
          this.state.activeDeviceId !== null ||
          this.state.deviceInfo.size > 0
        ) {
          this.state.devices.clear();
          this.state.activeDeviceId = null;
          this.state.deviceInfo.clear();
          return true;
        }
        return false;
      }
      case ActionType.RESET: {
        this.state.devices.clear();
        this.state.activeDeviceId = null;
        this.state.statusMessage = undefined;
        this.state.deviceInfo.clear();
        this.state.isMonitoring = false;
        return true;
      }
      case ActionType.SET_ALLOWED_AUTO_CONNECT: {
        this.state.allowedAutoConnectDevices = new Set(action.payload.serials);
        this.persistAllowedDevices();
        return true;
      }
      case ActionType.ADD_ALLOWED_AUTO_CONNECT: {
        if (!this.state.allowedAutoConnectDevices.has(action.payload.serial)) {
          this.state.allowedAutoConnectDevices.add(action.payload.serial);
          this.persistAllowedDevices();
          return true;
        }
        return false;
      }
      case ActionType.REMOVE_ALLOWED_AUTO_CONNECT: {
        if (this.state.allowedAutoConnectDevices.delete(action.payload.serial)) {
          this.persistAllowedDevices();
          return true;
        }
        return false;
      }
      case ActionType.ADD_BLOCKED_AUTO_CONNECT: {
        if (!this.state.blockedAutoConnectDevices.has(action.payload.serial)) {
          this.state.blockedAutoConnectDevices.add(action.payload.serial);
          this.persistBlockedDevices();
          return true;
        }
        return false;
      }
      case ActionType.REMOVE_BLOCKED_AUTO_CONNECT: {
        if (this.state.blockedAutoConnectDevices.delete(action.payload.serial)) {
          this.persistBlockedDevices();
          return true;
        }
        return false;
      }
      case ActionType.SET_CONTROL_CENTER_CACHE: {
        this.state.controlCenterCache = action.payload.cache;
        this.persistControlCenterCache();
        return true;
      }
      case ActionType.SAVE_CONTROL_CENTER_TO_CACHE: {
        this.state.controlCenterCache[action.payload.deviceId] = action.payload.settings;
        this.persistControlCenterCache();
        return true;
      }
      case ActionType.UPDATE_DEVICE_SETTING_IN_CACHE: {
        const { deviceId, setting, value } = action.payload;
        if (this.state.controlCenterCache[deviceId]) {
          (this.state.controlCenterCache[deviceId] as unknown as Record<string, unknown>)[setting] =
            value;
          this.persistControlCenterCache();
          return true;
        }
        return false;
      }
    }
    return false;
  }

  /**
   * Get a serializable snapshot of the current state
   * (Converts Maps to arrays/records for postMessage)
   */
  getSnapshot(): AppStateSnapshot {
    return {
      devices: Array.from(this.state.devices.values()),
      activeDeviceId: this.state.activeDeviceId,
      settings: { ...this.state.settings },
      toolStatus: { ...this.state.toolStatus },
      statusMessage: this.state.statusMessage ? { ...this.state.statusMessage } : undefined,
      deviceInfo: Object.fromEntries(this.state.deviceInfo),
      allowedAutoConnectDevices: Array.from(this.state.allowedAutoConnectDevices),
      blockedAutoConnectDevices: Array.from(this.state.blockedAutoConnectDevices),
      controlCenterCache: { ...this.state.controlCenterCache },
    };
  }

  /**
   * Subscribe to state changes
   * @returns Unsubscribe function
   */
  subscribe(listener: StateListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state change
   * Uses microtask scheduling to batch multiple mutations
   */
  private notifyListeners(): void {
    if (this.notifyScheduled) {
      return;
    }
    this.notifyScheduled = true;

    queueMicrotask(() => {
      this.notifyScheduled = false;
      const snapshot = this.getSnapshot();
      this.listeners.forEach((listener) => {
        try {
          listener(snapshot);
        } catch (error) {
          console.error('Error in state listener:', error);
        }
      });
    });
  }

  // ==================== Read-Only Accessors ====================

  /**
   * Get a device by ID
   */
  getDevice(deviceId: string): Readonly<DeviceState> | undefined {
    return this.state.devices.get(deviceId);
  }

  /**
   * Check if a device exists
   */
  hasDevice(deviceId: string): boolean {
    return this.state.devices.has(deviceId);
  }

  /**
   * Get device by serial
   */
  getDeviceBySerial(serial: string): Readonly<DeviceState> | undefined {
    for (const device of this.state.devices.values()) {
      if (device.serial === serial) {
        return device;
      }
    }
    return undefined;
  }

  /**
   * Get all device IDs
   */
  getDeviceIds(): string[] {
    return Array.from(this.state.devices.keys());
  }

  /**
   * Get device count
   */
  getDeviceCount(): number {
    return this.state.devices.size;
  }

  /**
   * Get the active device ID
   */
  getActiveDeviceId(): string | null {
    return this.state.activeDeviceId;
  }

  /**
   * Get the active device state
   */
  getActiveDevice(): Readonly<DeviceState> | undefined {
    if (!this.state.activeDeviceId) {
      return undefined;
    }
    return this.state.devices.get(this.state.activeDeviceId);
  }

  /**
   * Get current settings
   */
  getSettings(): Readonly<WebviewSettings> {
    return { ...this.state.settings };
  }

  /**
   * Get tool status
   */
  getToolStatus(): Readonly<ToolStatus> {
    return { ...this.state.toolStatus };
  }

  /**
   * Get status message
   */
  getStatusMessage(): Readonly<StatusMessage> | undefined {
    return this.state.statusMessage ? { ...this.state.statusMessage } : undefined;
  }

  /**
   * Get device detailed info
   */
  getDeviceInfo(serial: string): Readonly<DeviceDetailedInfo> | undefined {
    return this.state.deviceInfo.get(serial);
  }

  /**
   * Get monitoring state
   */
  isMonitoring(): boolean {
    return this.state.isMonitoring;
  }

  /**
   * Check if a device is allowed to auto-connect
   */
  isAllowedAutoConnectDevice(serial: string): boolean {
    return this.state.allowedAutoConnectDevices.has(serial);
  }

  /**
   * Check if a device is blocked from auto-connect (manual disconnect)
   */
  isBlockedAutoConnectDevice(serial: string): boolean {
    return this.state.blockedAutoConnectDevices.has(serial);
  }

  /**
   * Get cached settings for a device
   */
  getControlCenterFromCache(deviceId: string): DeviceUISettings | undefined {
    return this.state.controlCenterCache[deviceId];
  }

  /**
   * Get full control center cache
   */
  getControlCenterCache(): Readonly<Record<string, DeviceUISettings>> {
    return this.state.controlCenterCache;
  }

  // ==================== Auto-Connect State (Actions) ====================

  private persistAllowedDevices(): void {
    if (this.storage) {
      this.storage.update(
        AppStateManager.ALLOWED_DEVICES_KEY,
        Array.from(this.state.allowedAutoConnectDevices)
      );
    }
  }

  private persistBlockedDevices(): void {
    if (this.storage) {
      this.storage.update(
        AppStateManager.BLOCKED_DEVICES_KEY,
        Array.from(this.state.blockedAutoConnectDevices)
      );
    }
  }

  // ==================== Control Center Cache (Actions) ====================

  private persistControlCenterCache(): void {
    if (this.storage) {
      this.storage.update(AppStateManager.CONTROL_CENTER_CACHE_KEY, this.state.controlCenterCache);
    }
  }
}
