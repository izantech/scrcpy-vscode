import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile } from 'child_process';
import { MockChildProcess, resetMocks as resetChildProcessMocks } from '../mocks/child_process';

// Mock modules before importing ToolChecker
vi.mock('child_process', () => import('../mocks/child_process'));
vi.mock('vscode', () => import('../mocks/vscode'));

// Import after mocks are set up
import {
  checkAdb,
  checkScrcpy,
  checkAllTools,
  getInstallInstructions,
  clearCache,
  formatMissingToolsMessage,
  ToolCheckResult,
} from '../../src/ToolChecker';

describe('ToolChecker', () => {
  beforeEach(() => {
    clearCache();
    resetChildProcessMocks();
    vi.clearAllMocks();
  });

  describe('checkAdb', () => {
    it('should return available when adb command succeeds', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'Android Debug Bridge version 34.0.5\nInstalled as /usr/local/bin/adb\n', '');
          return new MockChildProcess();
        }
      );

      const result = await checkAdb();

      expect(result.isAvailable).toBe(true);
      expect(result.version).toBe('34.0.5');
      expect(result.error).toBeUndefined();
    });

    it('should return unavailable when adb command fails', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(new Error('ENOENT: command not found'), '', 'adb: command not found');
          return new MockChildProcess();
        }
      );

      const result = await checkAdb();

      expect(result.isAvailable).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.version).toBeUndefined();
    });

    it('should use custom path when provided', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'Android Debug Bridge version 34.0.5', '');
          return new MockChildProcess();
        }
      );

      await checkAdb('/custom/android/sdk');

      expect(execFile).toHaveBeenCalledWith(
        expect.stringContaining('/custom/android/sdk'),
        expect.any(Array),
        expect.any(Function)
      );
    });

    it('should handle version without patch number', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'Android Debug Bridge version 1.0.41\n', '');
          return new MockChildProcess();
        }
      );

      const result = await checkAdb();

      expect(result.isAvailable).toBe(true);
      expect(result.version).toBe('1.0.41');
    });

    it('should return available with undefined version if version not parseable', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'Some unknown adb output', '');
          return new MockChildProcess();
        }
      );

      const result = await checkAdb();

      expect(result.isAvailable).toBe(true);
      expect(result.version).toBeUndefined();
    });
  });

  describe('checkScrcpy', () => {
    it('should return available when scrcpy --version succeeds', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'scrcpy 3.3.3 <https://github.com/Genymobile/scrcpy>', '');
          return new MockChildProcess();
        }
      );

      const result = await checkScrcpy();

      expect(result.isAvailable).toBe(true);
      expect(result.version).toBe('3.3.3');
      expect(result.error).toBeUndefined();
    });

    it('should return unavailable when scrcpy not found', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(new Error('ENOENT'), '', 'scrcpy: command not found');
          return new MockChildProcess();
        }
      );

      const result = await checkScrcpy();

      expect(result.isAvailable).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should use custom path when provided', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'scrcpy 3.3.3', '');
          return new MockChildProcess();
        }
      );

      await checkScrcpy('/opt/scrcpy');

      expect(execFile).toHaveBeenCalledWith(
        expect.stringContaining('/opt/scrcpy'),
        expect.any(Array),
        expect.any(Function)
      );
    });

    it('should handle version without patch number', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'scrcpy 2.1', '');
          return new MockChildProcess();
        }
      );

      const result = await checkScrcpy();

      expect(result.isAvailable).toBe(true);
      expect(result.version).toBe('2.1');
    });
  });

  describe('checkAllTools', () => {
    it('should return allAvailable true when both tools present', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (file === 'adb' || file.includes('adb')) {
            cb?.(null, 'Android Debug Bridge version 34.0.5', '');
          } else {
            cb?.(null, 'scrcpy 3.3.3', '');
          }
          return new MockChildProcess();
        }
      );

      const result = await checkAllTools();

      expect(result.allAvailable).toBe(true);
      expect(result.adb.isAvailable).toBe(true);
      expect(result.scrcpy.isAvailable).toBe(true);
    });

    it('should return allAvailable false when adb missing', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (file === 'adb' || file.includes('adb')) {
            cb?.(new Error('ENOENT'), '', 'adb: command not found');
          } else {
            cb?.(null, 'scrcpy 3.3.3', '');
          }
          return new MockChildProcess();
        }
      );

      const result = await checkAllTools();

      expect(result.allAvailable).toBe(false);
      expect(result.adb.isAvailable).toBe(false);
      expect(result.scrcpy.isAvailable).toBe(true);
    });

    it('should return allAvailable false when scrcpy missing', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (file === 'adb' || file.includes('adb')) {
            cb?.(null, 'Android Debug Bridge version 34.0.5', '');
          } else {
            cb?.(new Error('ENOENT'), '', 'scrcpy: command not found');
          }
          return new MockChildProcess();
        }
      );

      const result = await checkAllTools();

      expect(result.allAvailable).toBe(false);
      expect(result.adb.isAvailable).toBe(true);
      expect(result.scrcpy.isAvailable).toBe(false);
    });

    it('should return allAvailable false when both missing', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(new Error('ENOENT'), '', 'command not found');
          return new MockChildProcess();
        }
      );

      const result = await checkAllTools();

      expect(result.allAvailable).toBe(false);
      expect(result.adb.isAvailable).toBe(false);
      expect(result.scrcpy.isAvailable).toBe(false);
    });

    it('should cache results within TTL', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (file === 'adb' || file.includes('adb')) {
            cb?.(null, 'Android Debug Bridge version 34.0.5', '');
          } else {
            cb?.(null, 'scrcpy 3.3.3', '');
          }
          return new MockChildProcess();
        }
      );

      await checkAllTools();
      await checkAllTools();

      // Should only call twice for the first checkAllTools (once for adb, once for scrcpy)
      // The second call should use cache
      expect(execFile).toHaveBeenCalledTimes(2);
    });

    it('should use custom paths when provided', async () => {
      const adbCalls: string[] = [];
      const scrcpyCalls: string[] = [];

      vi.mocked(execFile).mockImplementation(
        (
          file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (file.includes('adb')) {
            adbCalls.push(file);
            cb?.(null, 'Android Debug Bridge version 34.0.5', '');
          } else {
            scrcpyCalls.push(file);
            cb?.(null, 'scrcpy 3.3.3', '');
          }
          return new MockChildProcess();
        }
      );

      await checkAllTools('/custom/adb/path', '/custom/scrcpy/path');

      expect(adbCalls[0]).toContain('/custom/adb/path');
      expect(scrcpyCalls[0]).toContain('/custom/scrcpy/path');
    });
  });

  describe('getInstallInstructions', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return platform-specific instructions for darwin', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const instructions = getInstallInstructions();

      expect(instructions.platform).toBe('darwin');
      expect(instructions.adb.command).toContain('brew');
      expect(instructions.adb.command).toContain('android-platform-tools');
      expect(instructions.scrcpy.command).toContain('brew');
      expect(instructions.scrcpy.command).toContain('scrcpy');
      expect(instructions.adb.url).toContain('android.com');
      expect(instructions.scrcpy.url).toContain('github.com');
    });

    it('should return platform-specific instructions for linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const instructions = getInstallInstructions();

      expect(instructions.platform).toBe('linux');
      expect(instructions.adb.command).toContain('apt');
      expect(instructions.scrcpy.command).toContain('apt');
    });

    it('should return platform-specific instructions for windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const instructions = getInstallInstructions();

      expect(instructions.platform).toBe('win32');
      expect(instructions.adb.command).toContain('scoop');
      expect(instructions.scrcpy.command).toContain('scoop');
    });

    it('should default to win32 instructions for unknown platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });

      const instructions = getInstallInstructions();

      expect(instructions.platform).toBe('win32');
    });
  });

  describe('clearCache', () => {
    it('should force re-check after clearing cache', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          file: string,
          _args: unknown,
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (file === 'adb' || file.includes('adb')) {
            cb?.(null, 'Android Debug Bridge version 34.0.5', '');
          } else {
            cb?.(null, 'scrcpy 3.3.3', '');
          }
          return new MockChildProcess();
        }
      );

      await checkAllTools();
      clearCache();
      await checkAllTools();

      // Should call 4 times (2 for each checkAllTools after cache clear)
      expect(execFile).toHaveBeenCalledTimes(4);
    });

    it('should not throw when called multiple times', () => {
      expect(() => {
        clearCache();
        clearCache();
        clearCache();
      }).not.toThrow();
    });
  });

  describe('formatMissingToolsMessage', () => {
    it('should return empty string when all tools available', () => {
      const result: ToolCheckResult = {
        adb: { isAvailable: true, version: '34.0.5' },
        scrcpy: { isAvailable: true, version: '3.3.3' },
        allAvailable: true,
      };

      expect(formatMissingToolsMessage(result)).toBe('');
    });

    it('should return ADB when only adb is missing', () => {
      const result: ToolCheckResult = {
        adb: { isAvailable: false, error: 'not found' },
        scrcpy: { isAvailable: true, version: '3.3.3' },
        allAvailable: false,
      };

      expect(formatMissingToolsMessage(result)).toBe('ADB');
    });

    it('should return scrcpy when only scrcpy is missing', () => {
      const result: ToolCheckResult = {
        adb: { isAvailable: true, version: '34.0.5' },
        scrcpy: { isAvailable: false, error: 'not found' },
        allAvailable: false,
      };

      expect(formatMissingToolsMessage(result)).toBe('scrcpy');
    });

    it('should return "ADB and scrcpy" when both are missing', () => {
      const result: ToolCheckResult = {
        adb: { isAvailable: false, error: 'not found' },
        scrcpy: { isAvailable: false, error: 'not found' },
        allAvailable: false,
      };

      expect(formatMissingToolsMessage(result)).toBe('ADB and scrcpy');
    });
  });
});
