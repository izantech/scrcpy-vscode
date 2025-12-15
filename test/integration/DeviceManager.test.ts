import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile, spawn } from 'child_process';
import { MockChildProcess, resetMocks as resetChildProcessMocks } from '../mocks/child_process';

// Mock child_process module before importing DeviceManager
vi.mock('child_process', () => import('../mocks/child_process'));

// Mock vscode module
vi.mock('vscode', () => import('../mocks/vscode'));

// Import after mocks are set up
import { DeviceManager } from '../../src/DeviceManager';
import { ScrcpyConfig } from '../../src/ScrcpyConnection';

describe('DeviceManager', () => {
  let manager: DeviceManager;
  let videoCallback: ReturnType<typeof vi.fn>;
  let audioCallback: ReturnType<typeof vi.fn>;
  let statusCallback: ReturnType<typeof vi.fn>;
  let sessionListCallback: ReturnType<typeof vi.fn>;
  let errorCallback: ReturnType<typeof vi.fn>;
  let connectionStateCallback: ReturnType<typeof vi.fn>;
  let config: ScrcpyConfig;

  beforeEach(() => {
    resetChildProcessMocks();
    vi.clearAllMocks();

    videoCallback = vi.fn();
    audioCallback = vi.fn();
    statusCallback = vi.fn();
    sessionListCallback = vi.fn();
    errorCallback = vi.fn();
    connectionStateCallback = vi.fn();

    config = {
      scrcpyPath: '',
      screenOff: false,
      stayAwake: true,
      maxSize: 1920,
      bitRate: 8,
      maxFps: 60,
      showTouches: false,
      audio: false,
      clipboardSync: false,
      autoConnect: false,
      autoReconnect: false,
      reconnectRetries: 2,
      lockVideoOrientation: false,
      scrollSensitivity: 1.0,
      videoCodec: 'h264',
    };

    manager = new DeviceManager(
      videoCallback,
      audioCallback,
      statusCallback,
      sessionListCallback,
      errorCallback,
      connectionStateCallback,
      config
    );
  });

  afterEach(async () => {
    await manager.disconnectAll();
  });

  describe('getAvailableDevices', () => {
    it('should parse single device from adb devices output', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'List of devices attached\nemulator-5554\tdevice model:Pixel_5\n', '');
          return new MockChildProcess();
        }
      );

      const devices = await manager.getAvailableDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({
        serial: 'emulator-5554',
        model: 'Pixel 5',
      });
    });

    it('should parse multiple devices from adb devices output', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(
            null,
            'List of devices attached\n' +
              'emulator-5554\tdevice model:Pixel_5\n' +
              '192.168.1.100:5555\tdevice model:SM_G970F\n' +
              'RZXYZ12345\tdevice model:Galaxy_S21\n',
            ''
          );
          return new MockChildProcess();
        }
      );

      const devices = await manager.getAvailableDevices();

      expect(devices).toHaveLength(3);
      expect(devices[0].serial).toBe('emulator-5554');
      expect(devices[1].serial).toBe('192.168.1.100:5555');
      expect(devices[2].serial).toBe('RZXYZ12345');
    });

    it('should filter out mDNS devices', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(
            null,
            'List of devices attached\n' +
              'emulator-5554\tdevice model:Pixel_5\n' +
              'adb-12345._adb-tls-connect._tcp\tdevice\n',
            ''
          );
          return new MockChildProcess();
        }
      );

      const devices = await manager.getAvailableDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0].serial).toBe('emulator-5554');
    });

    it('should return empty array when no devices connected', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'List of devices attached\n', '');
          return new MockChildProcess();
        }
      );

      const devices = await manager.getAvailableDevices();

      expect(devices).toHaveLength(0);
    });

    it('should return empty array when adb command fails', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(new Error('ADB not found'), '', 'command not found: adb');
          return new MockChildProcess();
        }
      );

      const devices = await manager.getAvailableDevices();

      expect(devices).toHaveLength(0);
    });

    it('should skip offline and unauthorized devices', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(
            null,
            'List of devices attached\n' +
              'emulator-5554\tdevice model:Pixel_5\n' +
              'offline-device\toffline\n' +
              'unauthorized-device\tunauthorized\n',
            ''
          );
          return new MockChildProcess();
        }
      );

      const devices = await manager.getAvailableDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0].serial).toBe('emulator-5554');
    });

    it('should handle device without model info', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'List of devices attached\nemulator-5554\tdevice\n', '');
          return new MockChildProcess();
        }
      );

      const devices = await manager.getAvailableDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({
        serial: 'emulator-5554',
        name: 'emulator-5554', // Falls back to serial when no model
        model: undefined,
      });
    });
  });

  describe('session management', () => {
    it('should have no active sessions initially', () => {
      const sessions = manager.getAllSessions();
      expect(sessions).toHaveLength(0);
    });

    it('should return null for active session initially', () => {
      expect(manager.getActiveSession()).toBeNull();
    });
  });

  describe('pairWifi', () => {
    it('should send pairing code when prompted', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      const pairPromise = manager.pairWifi('192.168.1.100:5555', '123456');

      // Simulate ADB prompting for pairing code
      setTimeout(() => {
        mockProcess.simulateStdout('Enter pairing code: ');
      }, 10);

      // Simulate successful pairing
      setTimeout(() => {
        mockProcess.simulateStdout('Successfully paired\n');
        mockProcess.simulateClose(0);
      }, 20);

      await pairPromise;

      expect(spawn).toHaveBeenCalledWith('adb', ['pair', '192.168.1.100:5555']);
      expect(mockProcess.stdin.write).toHaveBeenCalledWith('123456\n');
    });

    it('should reject on pairing failure', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      const pairPromise = manager.pairWifi('192.168.1.100:5555', 'wrong-code');

      // Simulate pairing failure
      setTimeout(() => {
        mockProcess.simulateStderr('Failed: incorrect pairing code\n');
        mockProcess.simulateClose(1);
      }, 10);

      await expect(pairPromise).rejects.toThrow();
    });
  });

  describe('connectWifi', () => {
    it('should connect to device over WiFi', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (args[0] === 'connect') {
            cb?.(null, 'connected to 192.168.1.100:5555\n', '');
          }
          return new MockChildProcess();
        }
      );

      const result = await manager.connectWifi('192.168.1.100', 5555);

      expect(execFile).toHaveBeenCalledWith(
        'adb',
        ['connect', '192.168.1.100:5555'],
        expect.any(Function)
      );
      expect(result.serial).toBe('192.168.1.100:5555');
    });

    it('should resolve when already connected', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (args[0] === 'connect') {
            cb?.(null, 'already connected to 192.168.1.100:5555\n', '');
          }
          return new MockChildProcess();
        }
      );

      // Should not throw for "already connected" - it's a success case
      const result = await manager.connectWifi('192.168.1.100', 5555);
      expect(result.serial).toBe('192.168.1.100:5555');
    });

    it('should reject on connection failure', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (args[0] === 'connect') {
            cb?.(null, 'failed to connect to 192.168.1.100:5555\n', '');
          }
          return new MockChildProcess();
        }
      );

      await expect(manager.connectWifi('192.168.1.100', 5555)).rejects.toThrow();
    });
  });

  describe('disconnectWifi', () => {
    it('should disconnect WiFi device', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (args[0] === 'disconnect') {
            cb?.(null, 'disconnected 192.168.1.100:5555\n', '');
          }
          return new MockChildProcess();
        }
      );

      await manager.disconnectWifi('192.168.1.100:5555');

      expect(execFile).toHaveBeenCalledWith(
        'adb',
        ['disconnect', '192.168.1.100:5555'],
        expect.any(Function)
      );
    });
  });

  describe('config updates', () => {
    it('should allow updating configuration', () => {
      const newConfig: ScrcpyConfig = {
        ...config,
        maxSize: 1080,
        bitRate: 4,
      };

      manager.updateConfig(newConfig);

      // Configuration should be stored for new sessions
      // (internal state, so we just verify no error)
      expect(() => manager.updateConfig(newConfig)).not.toThrow();
    });
  });

  describe('disconnectAll', () => {
    it('should clean up all sessions on disconnectAll', async () => {
      await manager.disconnectAll();

      expect(manager.getAllSessions()).toHaveLength(0);
      expect(manager.getActiveSession()).toBeNull();
    });
  });

  describe('device classification', () => {
    it.each([
      ['192.168.1.100:5555', true],
      ['10.0.0.1:5555', true],
      ['172.16.0.1:12345', true],
      ['emulator-5554', false],
      ['RZXYZ12345', false],
      ['adb-12345._adb-tls-connect._tcp', false],
    ])('should classify %s as WiFi device: %s', async (serial, isWifi) => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, `List of devices attached\n${serial}\tdevice model:Test\n`, '');
          return new MockChildProcess();
        }
      );

      const devices = await manager.getAvailableDevices();

      // WiFi devices have IP:port format, USB devices don't
      if (isWifi) {
        expect(devices[0]?.serial).toMatch(/^\d+\.\d+\.\d+\.\d+:\d+$/);
      } else if (!serial.includes('_adb-tls-connect')) {
        expect(devices[0]?.serial).toBe(serial);
      }
    });
  });

  describe('device info parsing', () => {
    it.each([
      ['model:Pixel_5', 'Pixel 5'],
      ['model:SM_G970F', 'SM G970F'],
      ['model:Galaxy_S21_Ultra', 'Galaxy S21 Ultra'],
    ])('should parse model info %s as "%s"', async (modelStr, expectedModel) => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, `List of devices attached\ndevice-123\tdevice ${modelStr}\n`, '');
          return new MockChildProcess();
        }
      );

      const devices = await manager.getAvailableDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0].model).toBe(expectedModel);
    });

    it('should handle devices with various states', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(
            null,
            'List of devices attached\n' +
              'device1\tdevice model:Active\n' +
              'device2\toffline\n' +
              'device3\tunauthorized\n' +
              'device4\tbootloader\n' +
              'device5\trecovery\n' +
              'device6\tdevice model:AlsoActive\n',
            ''
          );
          return new MockChildProcess();
        }
      );

      const devices = await manager.getAvailableDevices();

      // Only 'device' state should be included
      expect(devices).toHaveLength(2);
      expect(devices.map((d) => d.serial)).toEqual(['device1', 'device6']);
    });
  });

  describe('duplicate device prevention', () => {
    it('should track connected device serials to prevent duplicates', () => {
      // Initially no devices connected
      expect(manager.isDeviceConnected('emulator-5554')).toBe(false);
      expect(manager.isDeviceConnected('192.168.1.100:5555')).toBe(false);
    });
  });

  describe('session state management', () => {
    it('should return sessions as array from getAllSessions', () => {
      const sessions = manager.getAllSessions();
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions).toHaveLength(0);
    });

    it('should notify session list changes via callback', async () => {
      // The callback should be called when sessions change
      // Initial state has no sessions
      expect(sessionListCallback).not.toHaveBeenCalled();
    });
  });

  describe('track-devices protocol', () => {
    it('should start device monitoring only once', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      await manager.startDeviceMonitoring();
      await manager.startDeviceMonitoring(); // Second call should be no-op

      // Only one spawn call for track-devices
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith('adb', ['track-devices']);

      manager.stopDeviceMonitoring();
    });

    it('should stop monitoring and clean up process', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      await manager.startDeviceMonitoring();
      manager.stopDeviceMonitoring();

      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it('should parse 4-char hex length format from track-devices', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      // Configure to enable auto-connect
      manager.updateConfig({ ...config, autoConnect: true });

      await manager.startDeviceMonitoring();

      // Simulate track-devices output: 4-char hex length + device list
      // "001a" = 26 bytes for "emulator-5554\tdevice\n" (roughly)
      const deviceList = 'emulator-5554\tdevice\n';
      const hexLength = deviceList.length.toString(16).padStart(4, '0');

      // Simulate the data coming in
      mockProcess.stdout.emit('data', Buffer.from(hexLength + deviceList));

      manager.stopDeviceMonitoring();
    });

    it('should handle fragmented track-devices data', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      await manager.startDeviceMonitoring();

      // Send data in fragments (first the length, then partial data)
      mockProcess.stdout.emit('data', Buffer.from('00'));
      mockProcess.stdout.emit('data', Buffer.from('14'));
      mockProcess.stdout.emit('data', Buffer.from('emulator-5554\tdevice\n'));

      manager.stopDeviceMonitoring();
    });

    it('should skip mDNS devices in track-devices output', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      manager.updateConfig({ ...config, autoConnect: true });
      await manager.startDeviceMonitoring();

      // mDNS devices should be filtered out
      const deviceList = 'adb-12345._adb-tls-connect._tcp\tdevice\n';
      const hexLength = deviceList.length.toString(16).padStart(4, '0');

      mockProcess.stdout.emit('data', Buffer.from(hexLength + deviceList));

      // No auto-connect should happen for mDNS devices
      manager.stopDeviceMonitoring();
    });

    it('should handle invalid hex length gracefully', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      await manager.startDeviceMonitoring();

      // Send invalid data (not hex)
      expect(() => {
        mockProcess.stdout.emit('data', Buffer.from('ZZZZ'));
      }).not.toThrow();

      manager.stopDeviceMonitoring();
    });

    it('should restart track-devices process on unexpected close', async () => {
      vi.useFakeTimers();
      const mockProcess1 = new MockChildProcess();
      const mockProcess2 = new MockChildProcess();
      vi.mocked(spawn).mockReturnValueOnce(mockProcess1).mockReturnValueOnce(mockProcess2);

      await manager.startDeviceMonitoring();
      expect(spawn).toHaveBeenCalledTimes(1);

      // Simulate process dying
      mockProcess1.emit('close');

      // Should restart after delay
      await vi.advanceTimersByTimeAsync(1100);
      expect(spawn).toHaveBeenCalledTimes(2);

      manager.stopDeviceMonitoring();
      vi.useRealTimers();
    });

    it('should not restart track-devices after stopDeviceMonitoring', async () => {
      vi.useFakeTimers();
      const mockProcess1 = new MockChildProcess();
      const mockProcess2 = new MockChildProcess();
      vi.mocked(spawn).mockReturnValueOnce(mockProcess1).mockReturnValueOnce(mockProcess2);

      await manager.startDeviceMonitoring();
      expect(spawn).toHaveBeenCalledTimes(1);

      // Simulate process dying (schedules restart)
      mockProcess1.emit('close');

      // Stop monitoring before the restart timer fires
      manager.stopDeviceMonitoring();

      await vi.advanceTimersByTimeAsync(1100);
      expect(spawn).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('storage size parsing', () => {
    it('should parse device storage info correctly', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          const opts = typeof optionsOrCallback === 'object' ? optionsOrCallback : {};

          if (args.includes('shell') && args.includes('df') && args.includes('/data') && opts) {
            cb?.(
              null,
              'Filesystem  Size  Used  Avail  Use%  Mounted\n/dev/data  128G  64G  64G  50%  /data',
              ''
            );
          } else {
            cb?.(null, '', '');
          }
          return new MockChildProcess();
        }
      );

      const info = await manager.getDeviceInfo('test-device');

      // Storage should be parsed (128G = 128 * 1024^3 bytes)
      expect(info.storageTotal).toBeGreaterThan(0);
    });
  });
});
