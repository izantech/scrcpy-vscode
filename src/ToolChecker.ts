/**
 * Utility for checking availability of required tools (adb, scrcpy)
 * and providing platform-specific installation instructions.
 */

import { execFile } from 'child_process';
import * as path from 'path';

export interface ToolStatus {
  isAvailable: boolean;
  version?: string;
  error?: string;
}

export interface ToolCheckResult {
  adb: ToolStatus;
  scrcpy: ToolStatus;
  allAvailable: boolean;
}

export interface InstallInstructions {
  platform: 'darwin' | 'linux' | 'win32';
  adb: {
    command: string;
    url: string;
  };
  scrcpy: {
    command: string;
    url: string;
  };
}

// Cache for tool check results
let cachedResult: ToolCheckResult | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60000; // 1 minute

/**
 * Check if ADB is available
 */
export async function checkAdb(customPath?: string): Promise<ToolStatus> {
  const adbCommand = customPath ? path.join(customPath, 'adb') : 'adb';

  return new Promise((resolve) => {
    execFile(adbCommand, ['version'], (error, stdout) => {
      if (error) {
        resolve({
          isAvailable: false,
          error: error.message,
        });
        return;
      }

      // Parse version from output like "Android Debug Bridge version 34.0.5"
      const match = stdout.match(/Android Debug Bridge version (\d+\.\d+\.\d+)/);
      resolve({
        isAvailable: true,
        version: match ? match[1] : undefined,
      });
    });
  });
}

/**
 * Check if scrcpy is available
 */
export async function checkScrcpy(customPath?: string): Promise<ToolStatus> {
  const scrcpyCommand = customPath ? path.join(customPath, 'scrcpy') : 'scrcpy';

  return new Promise((resolve) => {
    execFile(scrcpyCommand, ['--version'], (error, stdout) => {
      if (error) {
        resolve({
          isAvailable: false,
          error: error.message,
        });
        return;
      }

      // Parse version from output like "scrcpy 3.3.3 <https://...>"
      const match = stdout.match(/scrcpy\s+(\d+\.\d+(?:\.\d+)?)/);
      resolve({
        isAvailable: true,
        version: match ? match[1] : undefined,
      });
    });
  });
}

/**
 * Check all required tools
 */
export async function checkAllTools(
  adbPath?: string,
  scrcpyPath?: string
): Promise<ToolCheckResult> {
  // Check cache
  const now = Date.now();
  if (cachedResult && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedResult;
  }

  // Check both tools in parallel
  const [adb, scrcpy] = await Promise.all([checkAdb(adbPath), checkScrcpy(scrcpyPath)]);

  const result: ToolCheckResult = {
    adb,
    scrcpy,
    allAvailable: adb.isAvailable && scrcpy.isAvailable,
  };

  // Update cache
  cachedResult = result;
  cacheTimestamp = now;

  return result;
}

/**
 * Get platform-specific installation instructions
 */
export function getInstallInstructions(): InstallInstructions {
  const platform = process.platform as 'darwin' | 'linux' | 'win32';

  switch (platform) {
    case 'darwin':
      return {
        platform: 'darwin',
        adb: {
          command: 'brew install android-platform-tools',
          url: 'https://developer.android.com/studio/releases/platform-tools',
        },
        scrcpy: {
          command: 'brew install scrcpy',
          url: 'https://github.com/Genymobile/scrcpy',
        },
      };

    case 'linux':
      return {
        platform: 'linux',
        adb: {
          command: 'sudo apt install android-tools-adb',
          url: 'https://developer.android.com/studio/releases/platform-tools',
        },
        scrcpy: {
          command: 'sudo apt install scrcpy',
          url: 'https://github.com/Genymobile/scrcpy',
        },
      };

    case 'win32':
    default:
      return {
        platform: 'win32',
        adb: {
          command: 'scoop install adb',
          url: 'https://developer.android.com/studio/releases/platform-tools',
        },
        scrcpy: {
          command: 'scoop install scrcpy',
          url: 'https://github.com/Genymobile/scrcpy',
        },
      };
  }
}

/**
 * Clear the cached tool check results
 * Call this when settings change to force a re-check
 */
export function clearCache(): void {
  cachedResult = null;
  cacheTimestamp = 0;
}

/**
 * Format a user-friendly message listing missing tools
 */
export function formatMissingToolsMessage(result: ToolCheckResult): string {
  const missing: string[] = [];
  if (!result.adb.isAvailable) {
    missing.push('ADB');
  }
  if (!result.scrcpy.isAvailable) {
    missing.push('scrcpy');
  }
  return missing.join(' and ');
}
