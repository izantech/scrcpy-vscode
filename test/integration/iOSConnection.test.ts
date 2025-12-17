/**
 * Tests for iOS device connection and device manager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter, Readable } from 'stream';
import { MockChildProcess, resetMocks as resetChildProcessMocks } from '../mocks/child_process';

// Mock child_process module
vi.mock('child_process', () => import('../mocks/child_process'));

// Mock vscode module
vi.mock('vscode', () => import('../mocks/vscode'));

// Mock fs.existsSync to return true for helper path
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  default: {
    existsSync: vi.fn(() => true),
  },
}));

// Mock PlatformCapabilities to enable iOS support
vi.mock('../../src/PlatformCapabilities', () => ({
  isIOSSupportAvailable: vi.fn(() => true),
  getCapabilities: vi.fn(() => ({
    supportsTouch: false,
    supportsKeyboard: false,
    supportsClipboard: false,
    supportsAudio: true,
    supportsScreenshot: false,
    supportsRotation: false,
    supportsFileTransfer: false,
    supportsAppManagement: false,
  })),
  IOS_CAPABILITIES: {
    supportsTouch: false,
    supportsKeyboard: false,
    supportsClipboard: false,
    supportsAudio: true,
    supportsScreenshot: false,
    supportsRotation: false,
    supportsFileTransfer: false,
    supportsAppManagement: false,
  },
  DevicePlatform: 'ios',
}));

// Import after mocks
import { iOSDeviceManager } from '../../src/ios/iOSDeviceManager';
import { iOSConnection } from '../../src/ios/iOSConnection';

/**
 * Binary protocol message types (matching ios-helper protocol)
 */
const MESSAGE_TYPE = {
  DEVICE_LIST: 0x01,
  DEVICE_INFO: 0x02,
  VIDEO_CONFIG: 0x03,
  VIDEO_FRAME: 0x04,
  ERROR: 0x05,
  STATUS: 0x06,
};

/**
 * Creates a binary protocol message
 */
function createMessage(type: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/**
 * Creates a device list message with mock devices
 */
function createDeviceListMessage(
  devices: Array<{ udid: string; name: string; model: string }>
): Buffer {
  const payload = Buffer.from(JSON.stringify(devices), 'utf8');
  return createMessage(MESSAGE_TYPE.DEVICE_LIST, payload);
}

/**
 * Creates a video config message (SPS/PPS + dimensions)
 */
function createVideoConfigMessage(width: number, height: number, configData: Buffer): Buffer {
  const payload = Buffer.alloc(8 + configData.length);
  payload.writeUInt32BE(width, 0);
  payload.writeUInt32BE(height, 4);
  configData.copy(payload, 8);
  return createMessage(MESSAGE_TYPE.VIDEO_CONFIG, payload);
}

/**
 * Creates a video frame message
 */
function createVideoFrameMessage(
  data: Buffer,
  isKeyFrame: boolean,
  pts: bigint = BigInt(0)
): Buffer {
  const payload = Buffer.alloc(9 + data.length);
  const flags = isKeyFrame ? 0x01 : 0x00;
  payload.writeUInt8(flags, 0);
  // Write 64-bit PTS as two 32-bit values
  payload.writeUInt32BE(Number(pts >> BigInt(32)), 1);
  payload.writeUInt32BE(Number(pts & BigInt(0xffffffff)), 5);
  data.copy(payload, 9);
  return createMessage(MESSAGE_TYPE.VIDEO_FRAME, payload);
}

/**
 * Creates a status message
 */
function createStatusMessage(text: string): Buffer {
  return createMessage(MESSAGE_TYPE.STATUS, Buffer.from(text, 'utf8'));
}

/**
 * Creates a simple H.264 SPS NAL unit (minimal valid structure)
 */
function createMockSPS(): Buffer {
  // Annex B start code + NAL unit type 7 (SPS) + minimal SPS data
  return Buffer.from([
    0x00,
    0x00,
    0x00,
    0x01, // Start code
    0x67, // NAL header: type = 7 (SPS)
    0x42,
    0x00,
    0x1e, // profile_idc, constraint flags, level_idc
    0x9a,
    0x74,
    0x04,
    0x01,
    0x6e, // SPS data (simplified)
  ]);
}

/**
 * Creates a simple H.264 PPS NAL unit
 */
function createMockPPS(): Buffer {
  // Annex B start code + NAL unit type 8 (PPS) + minimal PPS data
  return Buffer.from([
    0x00,
    0x00,
    0x00,
    0x01, // Start code
    0x68, // NAL header: type = 8 (PPS)
    0xce,
    0x38,
    0x80, // PPS data (simplified)
  ]);
}

/**
 * Creates a mock IDR (keyframe) NAL unit
 */
function createMockIDRFrame(): Buffer {
  // Annex B start code + NAL unit type 5 (IDR)
  return Buffer.from([
    0x00,
    0x00,
    0x00,
    0x01, // Start code
    0x65, // NAL header: type = 5 (IDR)
    0x88, // Frame data (simplified)
    0x84,
    0x00,
    0x4f,
    0xff,
    0xfe,
    0xdc,
    0xba,
  ]);
}

/**
 * Creates a mock P-frame NAL unit
 */
function createMockPFrame(): Buffer {
  // Annex B start code + NAL unit type 1 (non-IDR)
  return Buffer.from([
    0x00,
    0x00,
    0x00,
    0x01, // Start code
    0x41, // NAL header: type = 1 (non-IDR)
    0x9a, // Frame data (simplified)
    0x24,
    0x6c,
    0x41,
  ]);
}

describe('iOSDeviceManager', () => {
  beforeEach(() => {
    resetChildProcessMocks();
    vi.clearAllMocks();
  });

  describe('getAvailableDevices', () => {
    it('should parse device list from helper binary protocol', async () => {
      const mockDevices = [
        { udid: 'ABC123-DEF456', name: 'iPhone 15 Pro', model: 'iPhone16,1' },
        { udid: 'XYZ789-GHI012', name: 'iPad Pro', model: 'iPad14,5' },
      ];

      let mockProcess: MockChildProcess;
      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        // Send device list after a tick
        setTimeout(() => {
          mockProcess.simulateStdout(createDeviceListMessage(mockDevices));
          mockProcess.simulateClose(0);
        }, 10);
        return mockProcess;
      });

      const devices = await iOSDeviceManager.getAvailableDevices();

      expect(devices).toHaveLength(2);
      expect(devices[0]).toEqual({
        serial: 'ABC123-DEF456',
        name: 'iPhone 15 Pro',
        model: 'iPhone16,1',
        platform: 'ios',
      });
      expect(devices[1]).toEqual({
        serial: 'XYZ789-GHI012',
        name: 'iPad Pro',
        model: 'iPad14,5',
        platform: 'ios',
      });
    });

    it('should return empty array when no devices found', async () => {
      let mockProcess: MockChildProcess;
      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        setTimeout(() => {
          mockProcess.simulateStdout(createDeviceListMessage([]));
          mockProcess.simulateClose(0);
        }, 10);
        return mockProcess;
      });

      const devices = await iOSDeviceManager.getAvailableDevices();

      expect(devices).toHaveLength(0);
    });

    it('should handle status messages before device list', async () => {
      const mockDevices = [{ udid: 'TEST-123', name: 'Test iPhone', model: 'iPhone15,2' }];

      let mockProcess: MockChildProcess;
      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        setTimeout(() => {
          // Send status message first
          mockProcess.simulateStdout(createStatusMessage('Scanning for iOS devices...'));
          // Then send device list
          mockProcess.simulateStdout(createDeviceListMessage(mockDevices));
          mockProcess.simulateClose(0);
        }, 10);
        return mockProcess;
      });

      const devices = await iOSDeviceManager.getAvailableDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0].serial).toBe('TEST-123');
    });

    it('should handle chunked binary protocol data', async () => {
      const mockDevices = [{ udid: 'CHUNK-TEST', name: 'Chunked Device', model: 'iPhone14,7' }];
      const fullMessage = createDeviceListMessage(mockDevices);

      let mockProcess: MockChildProcess;
      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        setTimeout(() => {
          // Send message in two chunks
          const chunk1 = fullMessage.subarray(0, 10);
          const chunk2 = fullMessage.subarray(10);
          mockProcess.simulateStdout(chunk1);
          setTimeout(() => {
            mockProcess.simulateStdout(chunk2);
            mockProcess.simulateClose(0);
          }, 5);
        }, 10);
        return mockProcess;
      });

      const devices = await iOSDeviceManager.getAvailableDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0].serial).toBe('CHUNK-TEST');
    });

    it('should handle spawn errors gracefully', async () => {
      vi.mocked(spawn).mockImplementation(() => {
        const mockProcess = new MockChildProcess();
        setTimeout(() => {
          mockProcess.emit('error', new Error('spawn ENOENT'));
        }, 10);
        return mockProcess;
      });

      const devices = await iOSDeviceManager.getAvailableDevices();

      expect(devices).toHaveLength(0);
    });
  });
});

describe('iOSConnection', () => {
  let connection: iOSConnection;
  let mockProcess: MockChildProcess;

  beforeEach(() => {
    resetChildProcessMocks();
    vi.clearAllMocks();
    // Create connection with mock helper path
    connection = new iOSConnection('TEST-UDID-123', '/mock/ios-helper');
  });

  afterEach(() => {
    connection.disconnect();
  });

  describe('connect', () => {
    it('should throw error on non-macOS platforms', async () => {
      // Save original platform
      const originalPlatform = process.platform;

      // Mock platform as linux
      Object.defineProperty(process, 'platform', { value: 'linux', writable: true });

      const linuxConnection = new iOSConnection('TEST', '/mock/helper');

      await expect(linuxConnection.connect()).rejects.toThrow(
        'iOS support is only available on macOS'
      );

      // Restore platform
      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    });

    it('should require device serial', async () => {
      const noSerialConnection = new iOSConnection(undefined, '/mock/helper');

      await expect(noSerialConnection.connect()).rejects.toThrow('No device serial specified');
    });

    it('should store device serial on connect', async () => {
      // Mock as macOS
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });

      await connection.connect('CUSTOM-SERIAL');

      expect(connection.getDeviceSerial()).toBe('CUSTOM-SERIAL');

      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    });
  });

  describe('startStreaming', () => {
    beforeEach(() => {
      // Mock as macOS for streaming tests
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
    });

    afterEach(() => {
      // Reset platform
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
    });

    it('should spawn helper process with correct arguments', async () => {
      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        return mockProcess;
      });

      await connection.connect();
      await connection.startStreaming({});

      expect(spawn).toHaveBeenCalledWith('/mock/ios-helper', ['stream', 'TEST-UDID-123'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    });

    it('should parse video config message and emit dimensions', async () => {
      const configData = Buffer.concat([createMockSPS(), createMockPPS()]);
      const videoConfigMessage = createVideoConfigMessage(1920, 1080, configData);

      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        setTimeout(() => {
          mockProcess.simulateStdout(videoConfigMessage);
        }, 10);
        return mockProcess;
      });

      const videoFrames: Array<{
        data: Uint8Array;
        isConfig: boolean;
        isKeyFrame: boolean;
        width?: number;
        height?: number;
      }> = [];
      connection.onVideoFrame = (data, isConfig, isKeyFrame, width, height) => {
        videoFrames.push({ data, isConfig, isKeyFrame, width, height });
      };

      await connection.connect();
      await connection.startStreaming({});

      // Wait for message processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(videoFrames.length).toBeGreaterThan(0);
      expect(videoFrames[0].isConfig).toBe(true);
      expect(videoFrames[0].width).toBe(1920);
      expect(videoFrames[0].height).toBe(1080);
    });

    it('should parse video frame messages correctly', async () => {
      const configData = Buffer.concat([createMockSPS(), createMockPPS()]);
      const idrFrame = createMockIDRFrame();
      const pFrame = createMockPFrame();

      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        setTimeout(() => {
          // Send config first
          mockProcess.simulateStdout(createVideoConfigMessage(640, 480, configData));
          // Then keyframe
          mockProcess.simulateStdout(createVideoFrameMessage(idrFrame, true, BigInt(1000)));
          // Then P-frame
          mockProcess.simulateStdout(createVideoFrameMessage(pFrame, false, BigInt(2000)));
        }, 10);
        return mockProcess;
      });

      const videoFrames: Array<{
        data: Uint8Array;
        isConfig: boolean;
        isKeyFrame: boolean;
      }> = [];
      connection.onVideoFrame = (data, isConfig, isKeyFrame) => {
        videoFrames.push({ data, isConfig, isKeyFrame });
      };

      await connection.connect();
      await connection.startStreaming({});

      // Wait for message processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(videoFrames.length).toBe(3);
      expect(videoFrames[0].isConfig).toBe(true); // Config
      expect(videoFrames[1].isKeyFrame).toBe(true); // IDR
      expect(videoFrames[2].isKeyFrame).toBe(false); // P-frame
    });

    it('should handle status messages and invoke callback', async () => {
      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        setTimeout(() => {
          mockProcess.simulateStdout(createStatusMessage('Starting capture...'));
          mockProcess.simulateStdout(createStatusMessage('Streaming at 1920x1080'));
        }, 10);
        return mockProcess;
      });

      const statuses: string[] = [];
      connection.onStatus = (status) => {
        statuses.push(status);
      };

      await connection.connect();
      await connection.startStreaming({});

      // Wait for message processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(statuses).toContain('Starting iOS screen capture...');
    });

    it('should handle error messages', async () => {
      const errorMessage = createMessage(MESSAGE_TYPE.ERROR, Buffer.from('Device disconnected'));

      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        setTimeout(() => {
          mockProcess.simulateStdout(errorMessage);
        }, 10);
        return mockProcess;
      });

      const errors: string[] = [];
      connection.onError = (error) => {
        errors.push(error);
      };

      await connection.connect();
      await connection.startStreaming({});

      // Wait for message processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(errors).toContain('Device disconnected');
    });

    it('should handle helper process exit with error code', async () => {
      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        setTimeout(() => {
          mockProcess.simulateClose(1);
        }, 10);
        return mockProcess;
      });

      const errors: string[] = [];
      connection.onError = (error) => {
        errors.push(error);
      };

      await connection.connect();
      await connection.startStreaming({});

      // Wait for process exit
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(errors.some((e) => e.includes('exited with code 1'))).toBe(true);
    });

    it('should handle chunked video frame data', async () => {
      const configData = Buffer.concat([createMockSPS(), createMockPPS()]);
      const configMessage = createVideoConfigMessage(1280, 720, configData);
      const frameMessage = createVideoFrameMessage(createMockIDRFrame(), true);

      // Combine messages and split at arbitrary point
      const combined = Buffer.concat([configMessage, frameMessage]);
      const chunk1 = combined.subarray(0, combined.length / 2);
      const chunk2 = combined.subarray(combined.length / 2);

      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        setTimeout(() => {
          mockProcess.simulateStdout(chunk1);
          setTimeout(() => {
            mockProcess.simulateStdout(chunk2);
          }, 5);
        }, 10);
        return mockProcess;
      });

      const videoFrames: Array<{ isConfig: boolean; isKeyFrame: boolean }> = [];
      connection.onVideoFrame = (data, isConfig, isKeyFrame) => {
        videoFrames.push({ isConfig, isKeyFrame });
      };

      await connection.connect();
      await connection.startStreaming({});

      // Wait for message processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(videoFrames.length).toBe(2);
      expect(videoFrames[0].isConfig).toBe(true);
      expect(videoFrames[1].isKeyFrame).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should kill helper process on disconnect', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });

      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = new MockChildProcess();
        return mockProcess;
      });

      await connection.connect();
      await connection.startStreaming({});

      connection.disconnect();

      expect(mockProcess.kill).toHaveBeenCalled();
      expect(connection.connected).toBe(false);
    });
  });

  describe('platform property', () => {
    it('should return ios as platform', () => {
      expect(connection.platform).toBe('ios');
    });
  });

  describe('unsupported operations (WDA disabled)', () => {
    it('should have no-op touch methods', () => {
      expect(() => connection.sendTouch?.()).not.toThrow();
    });

    it('should have no-op scroll methods', () => {
      expect(() => connection.sendScroll?.()).not.toThrow();
    });

    it('should have no-op key methods', () => {
      expect(() => connection.sendKey?.()).not.toThrow();
    });

    it('should return null for screenshot when no UDID', async () => {
      // Create connection without UDID to test null return
      const noUdidConnection = new iOSConnection(undefined, '/mock/ios-helper');
      const result = await noUdidConnection.takeScreenshot();
      expect(result).toBeNull();
    });
  });

  describe('capabilities', () => {
    it('should have capabilities property', () => {
      expect(connection.capabilities).toBeDefined();
      expect(connection.capabilities.supportsTouch).toBe(false);
    });

    it('should start with disabled input when WDA is not enabled', () => {
      expect(connection.capabilities.supportsTouch).toBe(false);
      expect(connection.capabilities.supportsKeyboard).toBe(false);
    });
  });

  describe('WDA integration', () => {
    let wdaConnection: iOSConnection;

    beforeEach(() => {
      // Create connection with WDA enabled
      wdaConnection = new iOSConnection('WDA-TEST-UDID', '/mock/ios-helper', {
        webDriverAgentEnabled: true,
        webDriverAgentPort: 8100,
      });
    });

    afterEach(() => {
      wdaConnection.disconnect();
    });

    it('should store WDA config', () => {
      // WDA is enabled but not yet ready (no actual connection)
      expect(wdaConnection.isWdaReady).toBe(false);
    });

    it('should report WDA not ready before streaming starts', () => {
      expect(wdaConnection.isWdaReady).toBe(false);
    });

    it('should not modify capabilities until WDA connects', () => {
      // Without successful WDA connection, touch should remain disabled
      expect(wdaConnection.capabilities.supportsTouch).toBe(false);
    });

    it('should include volume control in capabilities when WDA connects', () => {
      // Simulate WDA connection by calling the private updateCapabilities method
      // Access via type assertion for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wdaConnection as any).updateCapabilities(true);

      expect(wdaConnection.capabilities.supportsVolumeControl).toBe(true);
      expect(wdaConnection.capabilities.supportsTouch).toBe(true);
      expect(wdaConnection.capabilities.supportsKeyboard).toBe(true);
      expect(wdaConnection.capabilities.supportsSystemButtons).toBe(true);
    });
  });

  describe('screenshot', () => {
    it('should reject when helper exits with error code', async () => {
      const screenshotConnection = new iOSConnection('SCREENSHOT-TEST-UDID', '/mock/ios-helper');

      // Mock spawn to emit close with error code
      const mockSpawn = vi.mocked(spawn);
      mockSpawn.mockImplementationOnce(() => {
        const mockProcess = new EventEmitter() as ChildProcess;
        mockProcess.stdout = new EventEmitter() as Readable;
        mockProcess.stderr = new EventEmitter() as Readable;
        mockProcess.stdin = null;
        mockProcess.stdio = [null, mockProcess.stdout, mockProcess.stderr, null, null];
        mockProcess.pid = 12345;
        mockProcess.killed = false;
        mockProcess.kill = vi.fn().mockReturnValue(true);

        setTimeout(() => {
          mockProcess.emit('close', 1);
        }, 10);

        return mockProcess;
      });

      await expect(screenshotConnection.takeScreenshot()).rejects.toThrow(
        'Screenshot failed with code 1'
      );
    });

    it('should parse screenshot response from helper', async () => {
      const screenshotConnection = new iOSConnection('SCREENSHOT-TEST-UDID', '/mock/ios-helper');

      // Mock spawn to return valid screenshot response
      const mockSpawn = vi.mocked(spawn);
      const pngData = Buffer.from('fake-png-data');

      // Create binary protocol message: type(1) + length(4) + payload
      const responseBuffer = Buffer.alloc(5 + pngData.length);
      responseBuffer.writeUInt8(0x07, 0); // MessageType.SCREENSHOT
      responseBuffer.writeUInt32BE(pngData.length, 1);
      pngData.copy(responseBuffer, 5);

      mockSpawn.mockImplementationOnce(() => {
        const mockProcess = new EventEmitter() as ChildProcess;
        mockProcess.stdout = new EventEmitter() as Readable;
        mockProcess.stderr = new EventEmitter() as Readable;
        mockProcess.stdin = null;
        mockProcess.stdio = [null, mockProcess.stdout, mockProcess.stderr, null, null];
        mockProcess.pid = 12345;
        mockProcess.killed = false;
        mockProcess.kill = vi.fn().mockReturnValue(true);

        setTimeout(() => {
          mockProcess.stdout!.emit('data', responseBuffer);
          mockProcess.emit('close', 0);
        }, 10);

        return mockProcess;
      });

      const result = await screenshotConnection.takeScreenshot();
      expect(result).toEqual(pngData);
      expect(mockSpawn).toHaveBeenCalledWith('/mock/ios-helper', [
        'screenshot',
        'SCREENSHOT-TEST-UDID',
      ]);
    });
  });
});
