/**
 * iOS Device Manager - handles device discovery via ios-helper CLI
 */

import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { DeviceInfo } from '../IDeviceConnection';
import { isIOSSupportAvailable } from '../PlatformCapabilities';
import { resolveIOSHelperPath } from './iosHelperPath';

/**
 * Message types from the iOS helper binary protocol
 */
enum MessageType {
  DEVICE_LIST = 0x01,
  PERMISSION_ERROR = 0x08,
}

/**
 * Permission error payload from ios-helper
 */
interface PermissionErrorPayload {
  type: string;
  message: string;
  guidance: string;
  settingsUrl: string;
}

/**
 * Manages iOS device discovery using the ios-helper CLI
 */
export class iOSDeviceManager {
  // Track if we've already shown the permission error notification this session
  private static permissionErrorShown = false;

  // Prevent concurrent ios-helper processes
  private static pendingListOperation: Promise<DeviceInfo[]> | null = null;

  /**
   * Reset the permission error shown flag (call when user explicitly retries)
   */
  static resetPermissionErrorFlag(): void {
    this.permissionErrorShown = false;
  }

  /**
   * Get list of connected iOS devices
   * Only one list operation runs at a time - concurrent calls return the same promise
   */
  static async getAvailableDevices(
    videoSource: 'display' | 'camera' = 'display'
  ): Promise<DeviceInfo[]> {
    this.killStaleHelpers('list');

    // If a list operation is already in progress, return its promise
    if (this.pendingListOperation) {
      console.log('[iOSDeviceManager] List operation already in progress, waiting...');
      return this.pendingListOperation;
    }

    // Start new operation and track it
    this.pendingListOperation = this.listDevicesInternal(videoSource).finally(() => {
      this.pendingListOperation = null;
    });

    return this.pendingListOperation;
  }

  /**
   * Internal method that actually lists devices
   */
  private static async listDevicesInternal(
    videoSource: 'display' | 'camera'
  ): Promise<DeviceInfo[]> {
    this.killStaleHelpers('list');

    if (!isIOSSupportAvailable()) {
      console.log('[iOSDeviceManager] iOS support not available');
      return [];
    }

    const helperPath = this.getHelperPath();
    console.log('[iOSDeviceManager] Looking for ios-helper at:', helperPath);

    // Check if helper exists
    if (!fs.existsSync(helperPath)) {
      console.warn('[iOSDeviceManager] ios-helper binary not found at:', helperPath);
      return [];
    }

    console.log('[iOSDeviceManager] ios-helper found, listing devices...');

    return new Promise((resolve) => {
      // If helper is a JS file, run with node
      const isNodeScript = helperPath.endsWith('.js');
      const command = isNodeScript ? 'node' : helperPath;
      const args = isNodeScript
        ? [helperPath, 'list', '--video-source', videoSource]
        : ['list', '--video-source', videoSource];

      const proc = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const chunks: Buffer[] = [];

      proc.stdout.on('data', (data: Buffer) => {
        chunks.push(data);
      });

      proc.stderr.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message) {
          console.log('[ios-helper]', message);
        }
      });

      proc.on('close', () => {
        try {
          const buffer = Buffer.concat(chunks);

          // Parse protocol: scan for messages
          // Format: type (1 byte) + length (4 bytes) + payload
          let offset = 0;
          let devices: DeviceInfo[] = [];
          let permissionError: PermissionErrorPayload | null = null;

          while (offset + 5 <= buffer.length) {
            const type = buffer.readUInt8(offset);
            const length = buffer.readUInt32BE(offset + 1);

            if (offset + 5 + length > buffer.length) {
              break; // Incomplete message
            }

            const payload = buffer.subarray(offset + 5, offset + 5 + length);

            if (type === MessageType.DEVICE_LIST) {
              const deviceList = JSON.parse(payload.toString('utf8'));
              console.log(
                '[iOSDeviceManager] Found',
                deviceList.length,
                'iOS device(s):',
                deviceList
              );

              devices = deviceList.map(
                (d: { udid: string; name: string; model: string; isCameraFallback?: boolean }) => ({
                  serial: d.udid,
                  name: d.name,
                  model: d.model,
                  platform: 'ios' as const,
                  isCameraFallback: d.isCameraFallback ?? false,
                })
              );
            } else if (type === MessageType.PERMISSION_ERROR) {
              permissionError = JSON.parse(payload.toString('utf8'));
              console.log('[iOSDeviceManager] Permission error:', permissionError);
            }

            offset += 5 + length; // Move to next message
          }

          // Show permission error notification ONCE if present and no devices found
          if (permissionError && devices.length === 0 && !this.permissionErrorShown) {
            this.permissionErrorShown = true;
            this.showPermissionErrorNotification(permissionError);
          }

          resolve(devices);
        } catch (error) {
          console.error('[iOSDeviceManager] Failed to parse device list:', error);
          resolve([]);
        }
      });

      proc.on('error', (error) => {
        console.error('[iOSDeviceManager] Failed to spawn ios-helper:', error);
        resolve([]);
      });

      // Timeout after 20 seconds
      setTimeout(() => {
        proc.kill();
        resolve([]);
      }, 20000);
    });
  }

  /**
   * Prewarm CoreMediaIO capture to make muxed devices appear faster
   */
  static async prewarm(videoSource: 'display' | 'camera' = 'display'): Promise<void> {
    if (!isIOSSupportAvailable()) {
      return;
    }

    this.killStaleHelpers('prewarm');

    const helperPath = this.getHelperPath();
    if (!fs.existsSync(helperPath)) {
      return;
    }

    const isNodeScript = helperPath.endsWith('.js');
    const command = isNodeScript ? 'node' : helperPath;
    const args = isNodeScript
      ? [helperPath, 'prewarm', '--video-source', videoSource]
      : ['prewarm', '--video-source', videoSource];

    // Fire-and-forget prewarm; logs go to stderr/stdout for diagnostics
    spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] }).on('error', (error) => {
      console.warn('[iOSDeviceManager] prewarm failed:', error);
    });
  }

  /**
   * Kill stale ios-helper processes for the given command to avoid conflicts
   */
  static killStaleHelpers(command: 'list' | 'stream' | 'prewarm'): void {
    if (process.platform !== 'darwin') {
      return;
    }

    try {
      // Best-effort: ignore errors (pkill returns 1 if no process matched)
      spawnSync('pkill', ['-f', `ios-helper ${command}`], { stdio: 'ignore' });
    } catch {
      // Ignore failures; we'll continue with a fresh process
    }
  }

  /**
   * Get path to the ios-helper binary
   */
  private static getHelperPath(): string {
    return resolveIOSHelperPath();
  }

  /**
   * Show a permission error notification with an action button to open settings
   */
  private static showPermissionErrorNotification(error: PermissionErrorPayload): void {
    const openSettingsButton = 'Open Settings';

    vscode.window
      .showErrorMessage(
        `iOS Screen Capture: ${error.message}\n\n${error.guidance}`,
        openSettingsButton
      )
      .then((selection) => {
        if (selection === openSettingsButton && error.settingsUrl) {
          vscode.env.openExternal(vscode.Uri.parse(error.settingsUrl));
        }
      });
  }
}
