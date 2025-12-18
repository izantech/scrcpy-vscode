import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile, spawn } from 'child_process';
import { MockChildProcess, resetMocks as resetChildProcessMocks } from '../mocks/child_process';
import { MockSocket, MockServer, createServer, resetMocks as resetNetMocks } from '../mocks/net';

// Mock modules before importing ScrcpyConnection
vi.mock('child_process', () => import('../mocks/child_process'));
vi.mock('net', () => import('../mocks/net'));
vi.mock('vscode', () => import('../mocks/vscode'));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Import after mocks are set up
import { ScrcpyConnection, ScrcpyConfig } from '../../src/android/ScrcpyConnection';
import { ControlMessageType, MotionEventAction, KeyAction } from '../../src/android/ScrcpyProtocol';
import { nextTick } from '../helpers/protocol';

describe('ScrcpyConnection', () => {
  let connection: ScrcpyConnection;
  let videoCallback: ReturnType<typeof vi.fn>;
  let statusCallback: ReturnType<typeof vi.fn>;
  let errorCallback: ReturnType<typeof vi.fn>;
  let audioCallback: ReturnType<typeof vi.fn>;
  let config: ScrcpyConfig;

  beforeEach(() => {
    resetChildProcessMocks();
    resetNetMocks();
    vi.clearAllMocks();

    videoCallback = vi.fn();
    statusCallback = vi.fn();
    errorCallback = vi.fn();
    audioCallback = vi.fn();

    config = {
      scrcpyPath: '',
      adbPath: '',
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

    connection = new ScrcpyConnection(
      videoCallback,
      statusCallback,
      config,
      undefined, // targetDeviceSerial
      undefined, // onClipboard
      undefined, // clipboardAPI
      errorCallback,
      audioCallback
    );
  });

  afterEach(() => {
    // Don't await disconnect as it may hang on unmocked sockets
    // Just clear mocks
    vi.clearAllMocks();
  });

  describe('connect', () => {
    it('should call status callback with connecting message', async () => {
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

      await connection.connect();

      expect(statusCallback).toHaveBeenCalledWith(expect.stringContaining('Connecting'));
    });

    it('should throw when no devices are found', async () => {
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

      await expect(connection.connect()).rejects.toThrow('No Android devices found');
    });

    it('should throw when ADB is not installed', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(new Error('command not found: adb'), '', 'command not found: adb');
          return new MockChildProcess();
        }
      );

      await expect(connection.connect()).rejects.toThrow(/ADB not found/);
    });

    it('should connect to first device when no target specified', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'List of devices attached\nemulator-5554\tdevice\nRZXYZ12345\tdevice\n', '');
          return new MockChildProcess();
        }
      );

      await connection.connect();

      expect(statusCallback).toHaveBeenCalledWith(expect.stringContaining('emulator-5554'));
    });

    it('should connect to target device when specified', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'List of devices attached\nemulator-5554\tdevice\nRZXYZ12345\tdevice\n', '');
          return new MockChildProcess();
        }
      );

      const targetConnection = new ScrcpyConnection(
        videoCallback,
        statusCallback,
        config,
        'RZXYZ12345'
      );

      await targetConnection.connect();

      expect(statusCallback).toHaveBeenCalledWith(expect.stringContaining('RZXYZ12345'));
    });

    it('should throw when target device is not found', async () => {
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

      const targetConnection = new ScrcpyConnection(
        videoCallback,
        statusCallback,
        config,
        'non-existent-device'
      );

      await expect(targetConnection.connect()).rejects.toThrow('not found');
    });
  });

  describe('sendTouch', () => {
    it('should create touch message with correct format', () => {
      // Access private properties for testing
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      connection.sendTouch(0.5, 0.5, 'down', 1080, 1920);

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;

      // Touch message is 32 bytes
      expect(buffer.length).toBe(32);

      // First byte is message type (INJECT_TOUCH_EVENT = 2)
      expect(buffer[0]).toBe(ControlMessageType.INJECT_TOUCH_EVENT);

      // Byte 1 is action (DOWN = 0)
      expect(buffer[1]).toBe(MotionEventAction.DOWN);
    });

    it('should send up action correctly', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      connection.sendTouch(0.5, 0.5, 'up', 1080, 1920);

      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;
      expect(buffer[1]).toBe(MotionEventAction.UP);
    });

    it('should send move action correctly', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      connection.sendTouch(0.5, 0.5, 'move', 1080, 1920);

      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;
      expect(buffer[1]).toBe(MotionEventAction.MOVE);
    });

    it('should not send if not connected', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = false;

      connection.sendTouch(0.5, 0.5, 'down', 1080, 1920);

      expect(mockSocket.write).not.toHaveBeenCalled();
    });
  });

  describe('sendKeyDown / sendKeyUp', () => {
    it('should send key down message', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;

      connection.sendKeyDown(66); // KEYCODE_ENTER

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;

      // First byte is INJECT_KEYCODE = 0
      expect(buffer[0]).toBe(ControlMessageType.INJECT_KEYCODE);

      // Second byte is action (DOWN = 0)
      expect(buffer[1]).toBe(KeyAction.DOWN);
    });

    it('should send key up message', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;

      connection.sendKeyUp(66);

      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;

      // Second byte is action (UP = 1)
      expect(buffer[1]).toBe(KeyAction.UP);
    });
  });

  describe('sendText', () => {
    it('should send text injection message', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;

      connection.sendText('hello');

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;

      // First byte is INJECT_TEXT = 1
      expect(buffer[0]).toBe(ControlMessageType.INJECT_TEXT);

      // Text length is at bytes 1-4 (big endian)
      const textLength = buffer.readUInt32BE(1);
      expect(textLength).toBe(5); // 'hello'.length

      // Text content follows
      const text = buffer.toString('utf-8', 5, 5 + textLength);
      expect(text).toBe('hello');
    });

    it('should handle unicode text', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;

      connection.sendText('こんにちは'); // Japanese

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;

      // Get text from buffer
      const textLength = buffer.readUInt32BE(1);
      const text = buffer.toString('utf-8', 5, 5 + textLength);
      expect(text).toBe('こんにちは');
    });
  });

  describe('sendScroll', () => {
    it('should send scroll event message', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      connection.sendScroll(0.5, 0.5, 0, 0.5);

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;

      // First byte is INJECT_SCROLL_EVENT = 3
      expect(buffer[0]).toBe(ControlMessageType.INJECT_SCROLL_EVENT);

      // Scroll message is 21 bytes
      expect(buffer.length).toBe(21);
    });

    it('should split large scroll deltas into multiple messages', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      // Large delta that exceeds [-1, 1] range
      connection.sendScroll(0.5, 0.5, 0, 2.5);

      // Should be split into multiple messages: 1.0 + 1.0 + 0.5 = 3 messages
      expect(mockSocket.write.mock.calls.length).toBe(3);
    });

    it('should apply scroll sensitivity from config', () => {
      const sensitiveConfig = { ...config, scrollSensitivity: 2.0 };
      const sensitiveConnection = new ScrcpyConnection(
        videoCallback,
        statusCallback,
        sensitiveConfig
      );

      const conn = sensitiveConnection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      sensitiveConnection.sendScroll(0.5, 0.5, 0, 0.25);

      // With 2x sensitivity, 0.25 becomes 0.5
      expect(mockSocket.write).toHaveBeenCalled();
    });
  });

  describe('rotateDevice', () => {
    it('should send rotate message', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;

      connection.rotateDevice();

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;

      // Rotate message is 1 byte (just the type)
      expect(buffer.length).toBe(1);
      expect(buffer[0]).toBe(ControlMessageType.ROTATE_DEVICE);
    });
  });

  describe('updateDimensions', () => {
    it('should store new dimensions', () => {
      const conn = connection as unknown as {
        deviceWidth: number;
        deviceHeight: number;
      };

      connection.updateDimensions(1080, 1920);

      expect(conn.deviceWidth).toBe(1080);
      expect(conn.deviceHeight).toBe(1920);
    });
  });

  describe('disconnect', () => {
    it('should clean up sockets', async () => {
      const conn = connection as unknown as {
        videoSocket: MockSocket;
        controlSocket: MockSocket;
        audioSocket: MockSocket;
        isConnected: boolean;
      };

      const videoSocket = new MockSocket();
      const controlSocket = new MockSocket();
      const audioSocket = new MockSocket();

      conn.videoSocket = videoSocket;
      conn.controlSocket = controlSocket;
      conn.audioSocket = audioSocket;
      conn.isConnected = true;

      await connection.disconnect();

      expect(videoSocket.destroy).toHaveBeenCalled();
      expect(controlSocket.destroy).toHaveBeenCalled();
      expect(audioSocket.destroy).toHaveBeenCalled();
    });

    it('should remove the scrcpy reverse for the active session', async () => {
      const conn = connection as unknown as {
        deviceSerial: string;
        scid: string;
      };

      conn.deviceSerial = 'emulator-5554';
      conn.scid = 'deadbeef';

      await connection.disconnect();

      expect(execFile).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'reverse', '--remove', 'localabstract:scrcpy_deadbeef'],
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('takeScreenshot', () => {
    it('should execute adb screencap command', async () => {
      const conn = connection as unknown as {
        deviceSerial: string;
        isConnected: boolean;
      };
      conn.deviceSerial = 'emulator-5554';
      conn.isConnected = true;

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      const screenshotPromise = connection.takeScreenshot();

      // Simulate PNG data coming back
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      setTimeout(() => {
        mockProcess.simulateStdout(pngHeader);
        mockProcess.simulateClose(0);
      }, 10);

      const result = await screenshotPromise;

      expect(spawn).toHaveBeenCalledWith('adb', [
        '-s',
        'emulator-5554',
        'exec-out',
        'screencap',
        '-p',
      ]);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('installApk', () => {
    it('should execute adb install command', async () => {
      const conn = connection as unknown as {
        deviceSerial: string;
        isConnected: boolean;
      };
      conn.deviceSerial = 'emulator-5554';
      conn.isConnected = true;

      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (args.includes('install')) {
            cb?.(null, 'Success\n', '');
          }
          return new MockChildProcess();
        }
      );

      await connection.installApk('/path/to/app.apk');

      expect(execFile).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'install', '-r', '/path/to/app.apk'],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should throw on installation failure', async () => {
      const conn = connection as unknown as {
        deviceSerial: string;
        isConnected: boolean;
      };
      conn.deviceSerial = 'emulator-5554';
      conn.isConnected = true;

      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(new Error('Installation failed'), '', 'INSTALL_FAILED_INSUFFICIENT_STORAGE');
          return new MockChildProcess();
        }
      );

      await expect(connection.installApk('/path/to/app.apk')).rejects.toThrow();
    });
  });

  describe('pushFiles', () => {
    it('should execute adb push command', async () => {
      const conn = connection as unknown as {
        deviceSerial: string;
        isConnected: boolean;
      };
      conn.deviceSerial = 'emulator-5554';
      conn.isConnected = true;

      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (args.includes('push')) {
            cb?.(null, '1 file pushed\n', '');
          }
          return new MockChildProcess();
        }
      );

      await connection.pushFiles(['/path/to/file.txt']);

      expect(execFile).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'push', '/path/to/file.txt', '/sdcard/Download/'],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should push to custom destination path', async () => {
      const conn = connection as unknown as {
        deviceSerial: string;
        isConnected: boolean;
      };
      conn.deviceSerial = 'emulator-5554';
      conn.isConnected = true;

      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, '1 file pushed\n', '');
          return new MockChildProcess();
        }
      );

      await connection.pushFiles(['/path/to/file.txt'], '/sdcard/Custom/');

      expect(execFile).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'push', '/path/to/file.txt', '/sdcard/Custom/'],
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('sendMultiTouch', () => {
    it('should send multi-touch message with two pointers', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      connection.sendMultiTouch(0.25, 0.25, 0.75, 0.75, 'down', 1080, 1920);

      // Should send two touch messages (one for each pointer)
      expect(mockSocket.write.mock.calls.length).toBe(2);

      // Both should be INJECT_TOUCH_EVENT
      const buffer1 = mockSocket.write.mock.calls[0][0] as Buffer;
      const buffer2 = mockSocket.write.mock.calls[1][0] as Buffer;
      expect(buffer1[0]).toBe(ControlMessageType.INJECT_TOUCH_EVENT);
      expect(buffer2[0]).toBe(ControlMessageType.INJECT_TOUCH_EVENT);
    });

    it.each([
      ['down', MotionEventAction.DOWN],
      ['move', MotionEventAction.MOVE],
      ['up', MotionEventAction.UP],
    ])('should send correct action for multi-touch %s', (action, expectedAction) => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      connection.sendMultiTouch(
        0.25,
        0.25,
        0.75,
        0.75,
        action as 'down' | 'move' | 'up',
        1080,
        1920
      );

      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;
      expect(buffer[1]).toBe(expectedAction);
    });
  });

  describe('sendScroll edge cases', () => {
    it('should handle negative scroll deltas (scroll up/left)', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      connection.sendScroll(0.5, 0.5, -0.5, -0.5);

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;

      // Check that scroll message was sent
      expect(buffer[0]).toBe(ControlMessageType.INJECT_SCROLL_EVENT);
    });

    it('should handle zero scroll delta', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      connection.sendScroll(0.5, 0.5, 0, 0);

      // Zero delta might not send anything or send a zero message
      // Just verify no crash
      expect(() => connection.sendScroll(0.5, 0.5, 0, 0)).not.toThrow();
    });

    it('should handle horizontal scroll', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      connection.sendScroll(0.5, 0.5, 0.5, 0);

      expect(mockSocket.write).toHaveBeenCalled();
    });
  });

  describe('panel commands', () => {
    it('should send expand notification panel command', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;

      connection.expandNotificationPanel();

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;
      expect(buffer[0]).toBe(ControlMessageType.EXPAND_NOTIFICATION_PANEL);
    });

    it('should send expand settings panel command', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;

      connection.expandSettingsPanel();

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;
      expect(buffer[0]).toBe(ControlMessageType.EXPAND_SETTINGS_PANEL);
    });

    it('should send collapse panels command', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;

      connection.collapsePanels();

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;
      expect(buffer[0]).toBe(ControlMessageType.COLLAPSE_PANELS);
    });
  });

  describe('sendKeyWithMeta', () => {
    it('should send key with metastate for modifiers', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;

      // Ctrl+A (keycode 29 for 'A', CTRL meta)
      connection.sendKeyWithMeta(29, 'down', 0x1000);

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;

      expect(buffer[0]).toBe(ControlMessageType.INJECT_KEYCODE);
      expect(buffer[1]).toBe(KeyAction.DOWN);
    });

    it('should send key up with metastate', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;

      connection.sendKeyWithMeta(29, 'up', 0x1000);

      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;
      expect(buffer[1]).toBe(KeyAction.UP);
    });
  });

  describe('touch coordinate mapping', () => {
    it.each([
      ['top-left corner', 0, 0],
      ['bottom-right corner', 1, 1],
      ['center', 0.5, 0.5],
      ['arbitrary position', 0.33, 0.67],
    ])('should send valid touch message for %s', (_name, x, y) => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
        deviceWidth: number;
        deviceHeight: number;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = true;
      conn.deviceWidth = 1080;
      conn.deviceHeight = 1920;

      connection.sendTouch(x, y, 'down', 1080, 1920);

      expect(mockSocket.write).toHaveBeenCalled();
      const buffer = mockSocket.write.mock.calls[0][0] as Buffer;

      // Touch message should be 32 bytes
      expect(buffer.length).toBe(32);
      // First byte should be INJECT_TOUCH_EVENT
      expect(buffer[0]).toBe(ControlMessageType.INJECT_TOUCH_EVENT);
      // Second byte should be action DOWN
      expect(buffer[1]).toBe(MotionEventAction.DOWN);
    });
  });

  describe('connection state', () => {
    it('should not send commands when not connected', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket;
        isConnected: boolean;
      };

      const mockSocket = new MockSocket();
      conn.controlSocket = mockSocket;
      conn.isConnected = false;

      connection.rotateDevice();
      connection.expandNotificationPanel();
      connection.collapsePanels();
      connection.sendKeyDown(66);
      connection.sendText('test');

      expect(mockSocket.write).not.toHaveBeenCalled();
    });

    it('should not send commands when socket is null', () => {
      const conn = connection as unknown as {
        controlSocket: MockSocket | null;
        isConnected: boolean;
      };

      conn.controlSocket = null;
      conn.isConnected = true;

      // These should not throw
      expect(() => connection.rotateDevice()).not.toThrow();
      expect(() => connection.sendKeyDown(66)).not.toThrow();
    });
  });

  describe('getInstalledApps', () => {
    it('should execute pm list packages command', async () => {
      const conn = connection as unknown as {
        deviceSerial: string;
        isConnected: boolean;
      };
      conn.deviceSerial = 'emulator-5554';
      conn.isConnected = true;

      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (args.includes('pm') && args.includes('list') && args.includes('packages')) {
            cb?.(null, 'package:com.example.app1\npackage:com.example.app2\n', '');
          }
          return new MockChildProcess();
        }
      );

      const apps = await connection.getInstalledApps();

      expect(execFile).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'pm', 'list', 'packages'],
        expect.any(Object),
        expect.any(Function)
      );
      expect(apps).toBeInstanceOf(Array);
    });

    it('should filter third-party apps only when requested', async () => {
      const conn = connection as unknown as {
        deviceSerial: string;
        isConnected: boolean;
      };
      conn.deviceSerial = 'emulator-5554';
      conn.isConnected = true;

      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'package:com.example.app\n', '');
          return new MockChildProcess();
        }
      );

      await connection.getInstalledAppsFiltered(true);

      expect(execFile).toHaveBeenCalledWith(
        'adb',
        ['-s', 'emulator-5554', 'shell', 'pm', 'list', 'packages', '-3'],
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('listDisplays', () => {
    it('should parse dumpsys display output', async () => {
      const conn = connection as unknown as {
        deviceSerial: string;
        isConnected: boolean;
      };
      conn.deviceSerial = 'emulator-5554';
      conn.isConnected = true;

      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (args.includes('dumpsys') && args.includes('display')) {
            cb?.(
              null,
              'Display Devices:\n' +
                'mDisplayId=0\n' +
                '  mDisplayInfo: DisplayInfo{"Built-in Screen", displayId 0}\n',
              ''
            );
          }
          return new MockChildProcess();
        }
      );

      const displays = await connection.listDisplays();

      expect(displays).toBeInstanceOf(Array);
    });
  });

  describe('listCameras', () => {
    it('should throw when no device is connected', async () => {
      const conn = connection as unknown as {
        deviceSerial: string | undefined;
      };
      conn.deviceSerial = undefined;

      await expect(connection.listCameras()).rejects.toThrow('No device connected');
    });
  });

  describe('adbPath configuration', () => {
    it('should use custom adb path when configured', async () => {
      const customConfig = { ...config, adbPath: '/custom/android/sdk' };
      const customConnection = new ScrcpyConnection(
        videoCallback,
        statusCallback,
        customConfig,
        undefined,
        undefined,
        undefined,
        errorCallback,
        audioCallback
      );

      vi.mocked(execFile).mockImplementation(
        (
          file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'List of devices attached\ndevice1\tdevice\n', '');
          return new MockChildProcess();
        }
      );

      await customConnection.connect();

      expect(execFile).toHaveBeenCalledWith(
        '/custom/android/sdk/adb',
        expect.any(Array),
        expect.any(Function)
      );
    });

    it('should use default adb when adbPath is empty', async () => {
      const defaultConfig = { ...config, adbPath: '' };
      const defaultConnection = new ScrcpyConnection(
        videoCallback,
        statusCallback,
        defaultConfig,
        undefined,
        undefined,
        undefined,
        errorCallback,
        audioCallback
      );

      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, 'List of devices attached\ndevice1\tdevice\n', '');
          return new MockChildProcess();
        }
      );

      await defaultConnection.connect();

      expect(execFile).toHaveBeenCalledWith('adb', expect.any(Array), expect.any(Function));
    });

    it('should show platform-specific error when adb not found', async () => {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(new Error('ENOENT'), '', 'adb: command not found');
          return new MockChildProcess();
        }
      );

      // Error message should include platform-specific install instructions
      // On macOS it would be "brew", on Linux "apt", on Windows "scoop"
      await expect(connection.connect()).rejects.toThrow(/adb/i);
    });

    it('should use custom adb path for takeScreenshot', async () => {
      const customConfig = { ...config, adbPath: '/opt/android-sdk' };
      const customConnection = new ScrcpyConnection(
        videoCallback,
        statusCallback,
        customConfig,
        undefined,
        undefined,
        undefined,
        errorCallback,
        audioCallback
      );

      const conn = customConnection as unknown as {
        deviceSerial: string;
        isConnected: boolean;
      };
      conn.deviceSerial = 'emulator-5554';
      conn.isConnected = true;

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess);

      const screenshotPromise = customConnection.takeScreenshot();

      // Simulate PNG data coming back
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      setTimeout(() => {
        mockProcess.simulateStdout(pngHeader);
        mockProcess.simulateClose(0);
      }, 10);

      await screenshotPromise;

      expect(spawn).toHaveBeenCalledWith('/opt/android-sdk/adb', expect.any(Array));
    });

    it('should use custom adb path for installApk', async () => {
      const customConfig = { ...config, adbPath: '/usr/local/android' };
      const customConnection = new ScrcpyConnection(
        videoCallback,
        statusCallback,
        customConfig,
        undefined,
        undefined,
        undefined,
        errorCallback,
        audioCallback
      );

      const conn = customConnection as unknown as {
        deviceSerial: string;
        isConnected: boolean;
      };
      conn.deviceSerial = 'emulator-5554';
      conn.isConnected = true;

      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          if (args.includes('install')) {
            cb?.(null, 'Success\n', '');
          }
          return new MockChildProcess();
        }
      );

      await customConnection.installApk('/path/to/app.apk');

      expect(execFile).toHaveBeenCalledWith(
        '/usr/local/android/adb',
        ['-s', 'emulator-5554', 'install', '-r', '/path/to/app.apk'],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should use custom adb path for pushFiles', async () => {
      const customConfig = { ...config, adbPath: '/home/user/android-sdk' };
      const customConnection = new ScrcpyConnection(
        videoCallback,
        statusCallback,
        customConfig,
        undefined,
        undefined,
        undefined,
        errorCallback,
        audioCallback
      );

      const conn = customConnection as unknown as {
        deviceSerial: string;
        isConnected: boolean;
      };
      conn.deviceSerial = 'emulator-5554';
      conn.isConnected = true;

      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          _args: string[],
          _optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof _optionsOrCallback === 'function' ? _optionsOrCallback : callback;
          cb?.(null, '1 file pushed\n', '');
          return new MockChildProcess();
        }
      );

      await customConnection.pushFiles(['/path/to/file.txt']);

      expect(execFile).toHaveBeenCalledWith(
        '/home/user/android-sdk/adb',
        ['-s', 'emulator-5554', 'push', '/path/to/file.txt', '/sdcard/Download/'],
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('Socket Connection Setup', () => {
    /**
     * Helper to setup common mocks for socket connection tests
     */
    function setupConnectionMocks() {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;

          if (args.includes('--version')) {
            cb?.(null, 'scrcpy 2.4\n', '');
            return new MockChildProcess();
          }
          if (args.includes('devices')) {
            cb?.(null, 'List of devices attached\nemulator-5554\tdevice\n', '');
            return new MockChildProcess();
          }
          cb?.(null, '', '');
          return new MockChildProcess();
        }
      );

      vi.mocked(spawn).mockReturnValue(new MockChildProcess() as ReturnType<typeof spawn>);
    }

    it('should select port in valid range (27183-27198)', async () => {
      setupConnectionMocks();
      const mockServer = new MockServer();
      vi.mocked(createServer).mockReturnValue(mockServer);
      (connection as unknown as { deviceSerial: string }).deviceSerial = 'emulator-5554';

      // Start but don't await - we just want to check the port
      const startPromise = connection.startScrcpy();
      await nextTick();

      // Check listen was called with a port in valid range
      expect(mockServer.listen).toHaveBeenCalled();
      const listenCall = mockServer.listen.mock.calls[0];
      const port = listenCall[0] as number;
      expect(port).toBeGreaterThanOrEqual(27183);
      expect(port).toBeLessThan(27199);

      // Complete the connection to clean up
      mockServer.simulateConnection();
      mockServer.simulateConnection();
      await nextTick();
      await startPromise.catch(() => {}); // Suppress errors
    });

    it('should expect 2 sockets when audio is disabled', async () => {
      setupConnectionMocks();
      const mockServer = new MockServer();
      vi.mocked(createServer).mockReturnValue(mockServer);
      (connection as unknown as { deviceSerial: string }).deviceSerial = 'emulator-5554';

      const startPromise = connection.startScrcpy();
      await nextTick();

      // Simulate only 2 connections (video + control)
      mockServer.simulateConnection(); // video
      mockServer.simulateConnection(); // control
      await nextTick();

      // Should resolve
      await startPromise;
      expect((connection as unknown as { isConnected: boolean }).isConnected).toBe(true);
    });

    it('should handle server error before connections', async () => {
      setupConnectionMocks();
      const mockServer = new MockServer();
      vi.mocked(createServer).mockReturnValue(mockServer);
      (connection as unknown as { deviceSerial: string }).deviceSerial = 'emulator-5554';

      const startPromise = connection.startScrcpy();
      // Capture rejection immediately to prevent unhandled rejection warning
      let caughtError: Error | undefined;
      startPromise.catch((e) => {
        caughtError = e;
      });
      await nextTick();

      // Simulate server error
      mockServer.simulateError(new Error('EADDRINUSE: address already in use'));
      await nextTick();

      expect(caughtError).toBeDefined();
      expect(caughtError?.message).toMatch(/EADDRINUSE/);
    });

    it('should receive sockets in correct order: video, control', async () => {
      setupConnectionMocks();
      const mockServer = new MockServer();
      vi.mocked(createServer).mockReturnValue(mockServer);
      (connection as unknown as { deviceSerial: string }).deviceSerial = 'emulator-5554';

      const startPromise = connection.startScrcpy();
      await nextTick();

      // Simulate connections in order
      mockServer.simulateConnection(); // video
      const controlSocket = mockServer.simulateConnection(); // control
      await nextTick();
      await startPromise;

      // Verify control socket is the one stored
      const conn = connection as unknown as { controlSocket: MockSocket };
      expect(conn.controlSocket).toBe(controlSocket);
    });

    it('should call status callback during connection setup', async () => {
      setupConnectionMocks();
      const mockServer = new MockServer();
      vi.mocked(createServer).mockReturnValue(mockServer);
      (connection as unknown as { deviceSerial: string }).deviceSerial = 'emulator-5554';

      const startPromise = connection.startScrcpy();
      await nextTick();

      expect(statusCallback).toHaveBeenCalledWith(expect.stringContaining('Starting'));

      mockServer.simulateConnection();
      mockServer.simulateConnection();
      await nextTick();
      await startPromise;

      expect(statusCallback).toHaveBeenCalledWith(expect.stringContaining('Connected'));
    });

    it('should handle scrcpy process error during connection', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;

          if (args.includes('--version')) {
            cb?.(null, 'scrcpy 2.4\n', '');
            return new MockChildProcess();
          }
          if (args.includes('devices')) {
            cb?.(null, 'List of devices attached\nemulator-5554\tdevice\n', '');
            return new MockChildProcess();
          }
          cb?.(null, '', '');
          return new MockChildProcess();
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as ReturnType<typeof spawn>);

      const mockServer = new MockServer();
      vi.mocked(createServer).mockReturnValue(mockServer);
      (connection as unknown as { deviceSerial: string }).deviceSerial = 'emulator-5554';

      const startPromise = connection.startScrcpy();
      // Capture rejection immediately to prevent unhandled rejection warning
      let caughtError: Error | undefined;
      startPromise.catch((e) => {
        caughtError = e;
      });
      await nextTick();

      // Simulate process error
      mockProcess.emit('error', new Error('spawn ENOENT'));
      await nextTick();

      expect(caughtError).toBeDefined();
      expect(caughtError?.message).toMatch(/Failed to start scrcpy server/);
    });

    it('should handle scrcpy process exit during connection', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;

          if (args.includes('--version')) {
            cb?.(null, 'scrcpy 2.4\n', '');
            return new MockChildProcess();
          }
          if (args.includes('devices')) {
            cb?.(null, 'List of devices attached\nemulator-5554\tdevice\n', '');
            return new MockChildProcess();
          }
          cb?.(null, '', '');
          return new MockChildProcess();
        }
      );

      vi.mocked(spawn).mockReturnValue(mockProcess as ReturnType<typeof spawn>);

      const mockServer = new MockServer();
      vi.mocked(createServer).mockReturnValue(mockServer);
      (connection as unknown as { deviceSerial: string }).deviceSerial = 'emulator-5554';

      const startPromise = connection.startScrcpy();
      // Capture rejection immediately to prevent unhandled rejection warning
      let caughtError: Error | undefined;
      startPromise.catch((e) => {
        caughtError = e;
      });
      await nextTick();

      // Simulate process exit before connection completes
      mockProcess.emit('exit', 1);
      await nextTick();

      expect(caughtError).toBeDefined();
      expect(caughtError?.message).toMatch(/exited with code/);
    });
  });

  describe('Socket Error Handling', () => {
    function setupConnectionMocks() {
      vi.mocked(execFile).mockImplementation(
        (
          _file: string,
          args: string[],
          optionsOrCallback?: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
          const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;

          if (args.includes('--version')) {
            cb?.(null, 'scrcpy 2.4\n', '');
            return new MockChildProcess();
          }
          if (args.includes('devices')) {
            cb?.(null, 'List of devices attached\nemulator-5554\tdevice\n', '');
            return new MockChildProcess();
          }
          cb?.(null, '', '');
          return new MockChildProcess();
        }
      );

      vi.mocked(spawn).mockReturnValue(new MockChildProcess() as ReturnType<typeof spawn>);
    }

    it('should handle video socket error after connection', async () => {
      setupConnectionMocks();
      const mockServer = new MockServer();
      vi.mocked(createServer).mockReturnValue(mockServer);
      (connection as unknown as { deviceSerial: string }).deviceSerial = 'emulator-5554';

      const startPromise = connection.startScrcpy();
      await nextTick();

      const videoSocket = mockServer.simulateConnection();
      mockServer.simulateConnection(); // control
      await nextTick();
      await startPromise;

      // Simulate video socket error - should not throw
      expect(() => videoSocket.simulateError(new Error('Connection reset'))).not.toThrow();
    });

    it('should handle video socket close after connection', async () => {
      setupConnectionMocks();
      const mockServer = new MockServer();
      vi.mocked(createServer).mockReturnValue(mockServer);
      (connection as unknown as { deviceSerial: string }).deviceSerial = 'emulator-5554';

      const startPromise = connection.startScrcpy();
      await nextTick();

      const videoSocket = mockServer.simulateConnection();
      mockServer.simulateConnection(); // control
      await nextTick();
      await startPromise;

      // Simulate video socket close - should handle gracefully
      expect(() => videoSocket.simulateClose()).not.toThrow();
    });

    it('should handle control socket close during session', async () => {
      setupConnectionMocks();
      const mockServer = new MockServer();
      vi.mocked(createServer).mockReturnValue(mockServer);
      (connection as unknown as { deviceSerial: string }).deviceSerial = 'emulator-5554';

      const startPromise = connection.startScrcpy();
      await nextTick();

      mockServer.simulateConnection(); // video
      const controlSocket = mockServer.simulateConnection();
      await nextTick();
      await startPromise;

      // Close control socket
      controlSocket.simulateClose();

      // Subsequent commands should not crash
      expect(() => connection.rotateDevice()).not.toThrow();
    });
  });
});
