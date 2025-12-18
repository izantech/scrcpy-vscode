/**
 * iOS Device Manager - handles device discovery via ios-helper CLI
 */

import { spawn } from 'child_process';
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

  /**
   * Reset the permission error shown flag (call when user explicitly retries)
   */
  static resetPermissionErrorFlag(): void {
    this.permissionErrorShown = false;
  }

  /**
   * Get list of connected iOS devices
   */
  static async getAvailableDevices(
    videoSource: 'display' | 'camera' = 'display'
  ): Promise<DeviceInfo[]> {
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

      // Timeout after 10 seconds
      setTimeout(() => {
        proc.kill();
        resolve([]);
      }, 10000);
    });
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
