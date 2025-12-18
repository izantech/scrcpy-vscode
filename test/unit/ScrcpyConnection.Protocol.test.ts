/**
 * Protocol Parsing Tests for ScrcpyConnection
 *
 * Tests the video/audio stream parsing and device message handling
 * in ScrcpyConnection.ts (lines 694-915, 1327-1393)
 */

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

import { ScrcpyConnection, ScrcpyConfig } from '../../src/android/ScrcpyConnection';
import {
  VIDEO_CODEC_IDS,
  AUDIO_OPUS_CODEC_ID,
  createDeviceNameHeader,
  createVideoPacket,
  createAudioPacket,
  createClipboardMessage,
} from '../fixtures/h264-samples';
import {
  MockScrcpyVideoStream,
  MockScrcpyAudioStream,
  MockDeviceMessageStream,
  nextTick,
} from '../helpers/protocol';

/**
 * Helper to setup common mocks for ScrcpyConnection tests
 */
function setupCommonMocks() {
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
        cb?.(null, 'List of devices attached\ntest-device\tdevice\n', '');
        return new MockChildProcess();
      }
      cb?.(null, '', '');
      return new MockChildProcess();
    }
  );

  vi.mocked(spawn).mockReturnValue(new MockChildProcess() as ReturnType<typeof spawn>);
}

describe('ScrcpyConnection Protocol Parsing', () => {
  let connection: ScrcpyConnection;
  let videoCallback: ReturnType<typeof vi.fn>;
  let statusCallback: ReturnType<typeof vi.fn>;
  let errorCallback: ReturnType<typeof vi.fn>;
  let audioCallback: ReturnType<typeof vi.fn>;
  let clipboardCallback: ReturnType<typeof vi.fn>;
  let config: ScrcpyConfig;

  beforeEach(() => {
    resetChildProcessMocks();
    resetNetMocks();
    vi.clearAllMocks();

    videoCallback = vi.fn();
    statusCallback = vi.fn();
    errorCallback = vi.fn();
    audioCallback = vi.fn();
    clipboardCallback = vi.fn();

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
      clipboardSync: true,
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
      'test-device',
      clipboardCallback,
      undefined,
      errorCallback,
      audioCallback
    );

    setupCommonMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper to start scrcpy and get mock sockets
   */
  async function startScrcpyWithMockSockets(audioEnabled = false): Promise<{
    videoSocket: MockSocket;
    controlSocket: MockSocket;
    audioSocket?: MockSocket;
    videoStream: MockScrcpyVideoStream;
    deviceMsgStream: MockDeviceMessageStream;
    audioStream?: MockScrcpyAudioStream;
  }> {
    const mockServer = new MockServer();
    vi.mocked(createServer).mockReturnValue(mockServer);
    (connection as unknown as { deviceSerial: string }).deviceSerial = 'test-device';

    connection.startScrcpy();
    await nextTick();

    const videoSocket = mockServer.simulateConnection();
    const videoStream = new MockScrcpyVideoStream(videoSocket);

    let audioSocket: MockSocket | undefined;
    let audioStream: MockScrcpyAudioStream | undefined;
    if (audioEnabled) {
      audioSocket = mockServer.simulateConnection();
      audioStream = new MockScrcpyAudioStream(audioSocket);
    }

    const controlSocket = mockServer.simulateConnection();
    const deviceMsgStream = new MockDeviceMessageStream(controlSocket);

    await nextTick();

    return { videoSocket, controlSocket, audioSocket, videoStream, deviceMsgStream, audioStream };
  }

  describe('Video Stream Parsing', () => {
    describe('Device Name Header', () => {
      it('should parse device name correctly from 64-byte header', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendDeviceName('Pixel 8 Pro');
        videoStream.sendCodecMeta(VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          true,
          false,
          1920,
          1080,
          'h264'
        );
      });

      it('should handle device name with max length (64 chars)', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendDeviceName('A'.repeat(64));
        videoStream.sendCodecMeta(VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        expect(videoCallback).toHaveBeenCalled();
      });

      it('should handle empty device name', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendDeviceName('');
        videoStream.sendCodecMeta(VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        expect(videoCallback).toHaveBeenCalled();
      });

      it('should handle device name with unicode characters', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendDeviceName('华为 P40 Pro');
        videoStream.sendCodecMeta(VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        expect(videoCallback).toHaveBeenCalled();
      });

      it('should wait for complete 64-byte header before parsing', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        const header = createDeviceNameHeader('Test Device');
        videoStream.sendFragmented(header, 32);
        await nextTick();

        expect(videoCallback).not.toHaveBeenCalled();

        videoStream.sendCodecMeta(VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        expect(videoCallback).toHaveBeenCalled();
      });
    });

    describe('Codec Metadata Parsing', () => {
      it('should detect H264 codec from magic bytes (0x68323634)', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          true,
          false,
          1920,
          1080,
          'h264'
        );
      });

      it('should detect H265 codec from magic bytes (0x68323635)', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H265, 1920, 1080);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          true,
          false,
          1920,
          1080,
          'h265'
        );
      });

      it('should detect AV1 codec from magic bytes (0x00617631)', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.AV1, 1920, 1080);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          true,
          false,
          1920,
          1080,
          'av1'
        );
      });

      it('should default to H264 for unknown codec ID', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', 0x12345678, 1920, 1080);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          true,
          false,
          1920,
          1080,
          'h264'
        );
      });

      it('should parse initial width and height correctly', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 2560, 1440);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          true,
          false,
          2560,
          1440,
          'h264'
        );
      });
    });

    describe('Video Reconfiguration on Rotation', () => {
      it('should detect reconfiguration when dimensions change', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        // Initial: landscape
        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();
        videoCallback.mockClear();

        // Rotation to portrait
        videoStream.sendCodecMeta(VIDEO_CODEC_IDS.H264, 1080, 1920);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          true,
          false,
          1080,
          1920,
          'h264'
        );
      });

      it('should NOT reconfigure when dimensions unchanged', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();
        videoCallback.mockClear();

        // Send video packet (not reconfiguration)
        const packetData = Buffer.from([0x01, 0x02, 0x03, 0x04]);
        videoStream.sendVideoPacket(0n, false, false, packetData);
        await nextTick();

        // Should have called with packet data, not as reconfiguration
        expect(videoCallback).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          false,
          false,
          undefined,
          undefined,
          'h264'
        );
      });

      it('should apply sanity check: width < 10000 pixels', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();
        videoCallback.mockClear();

        // Invalid width (>= 10000) - should NOT trigger reconfiguration
        videoStream.sendCodecMeta(VIDEO_CODEC_IDS.H264, 10000, 1080);
        await nextTick();

        const calls = videoCallback.mock.calls;
        for (const call of calls) {
          if (call[3] !== undefined) {
            expect(call[3]).not.toBe(10000);
          }
        }
      });

      it('should apply sanity check: height < 10000 pixels', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();
        videoCallback.mockClear();

        // Invalid height (>= 10000)
        videoStream.sendCodecMeta(VIDEO_CODEC_IDS.H264, 1920, 10001);
        await nextTick();

        const calls = videoCallback.mock.calls;
        for (const call of calls) {
          if (call[4] !== undefined) {
            expect(call[4]).not.toBe(10001);
          }
        }
      });

      it('should accept dimensions just below 10000', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();
        videoCallback.mockClear();

        // Valid boundary (9999)
        videoStream.sendCodecMeta(VIDEO_CODEC_IDS.H264, 9999, 5000);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          true,
          false,
          9999,
          5000,
          'h264'
        );
      });
    });

    describe('Video Packet Parsing', () => {
      it('should parse PTS and flags from 8-byte header', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();
        videoCallback.mockClear();

        const packetData = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
        videoStream.sendVideoPacket(12345n, false, false, packetData);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
          false,
          false,
          undefined,
          undefined,
          'h264'
        );
      });

      it('should extract config packet flag (bit 63)', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();
        videoCallback.mockClear();

        const configData = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x67]);
        videoStream.sendVideoPacket(0n, true, false, configData);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          true,
          false,
          undefined,
          undefined,
          'h264'
        );
      });

      it('should extract keyframe flag (bit 62)', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();
        videoCallback.mockClear();

        const keyframeData = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x65]);
        videoStream.sendVideoPacket(1000n, false, true, keyframeData);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          false,
          true,
          undefined,
          undefined,
          'h264'
        );
      });

      it('should handle fragmented packet arrival', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();
        videoCallback.mockClear();

        const packetData = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
        const fullPacket = createVideoPacket(100n, false, false, packetData);
        videoStream.sendFragmented(fullPacket, 4);
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
          false,
          false,
          undefined,
          undefined,
          'h264'
        );
      });

      it('should handle zero-length packet', async () => {
        const { videoStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();
        videoCallback.mockClear();

        videoStream.sendVideoPacket(0n, false, false, Buffer.alloc(0));
        await nextTick();

        expect(videoCallback).toHaveBeenCalledWith(
          new Uint8Array(0),
          false,
          false,
          undefined,
          undefined,
          'h264'
        );
      });
    });
  });

  describe('Audio Stream Parsing', () => {
    beforeEach(() => {
      config.audio = true;
      connection = new ScrcpyConnection(
        videoCallback,
        statusCallback,
        config,
        'test-device',
        clipboardCallback,
        undefined,
        errorCallback,
        audioCallback
      );
    });

    describe('Codec Metadata', () => {
      it('should parse Opus codec ID (4 bytes)', async () => {
        const { videoStream, audioStream } = await startScrcpyWithMockSockets(true);

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        audioStream!.sendCodecMeta(AUDIO_OPUS_CODEC_ID);
        await nextTick();

        expect(audioCallback).toHaveBeenCalledWith(expect.any(Uint8Array), true);
      });
    });

    describe('Audio Packets', () => {
      it('should parse audio packet with correct data', async () => {
        const { videoStream, audioStream } = await startScrcpyWithMockSockets(true);

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        audioStream!.sendCodecMeta();
        await nextTick();
        audioCallback.mockClear();

        const audioData = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
        audioStream!.sendAudioPacket(1000n, false, audioData);
        await nextTick();

        expect(audioCallback).toHaveBeenCalledWith(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]), false);
      });

      it('should handle fragmented audio packet', async () => {
        const { videoStream, audioStream } = await startScrcpyWithMockSockets(true);

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        audioStream!.sendCodecMeta();
        await nextTick();
        audioCallback.mockClear();

        const audioData = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
        const fullPacket = createAudioPacket(500n, false, audioData);
        audioStream!.sendFragmented(fullPacket, 3);
        await nextTick();

        expect(audioCallback).toHaveBeenCalledWith(
          new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
          false
        );
      });
    });
  });

  describe('Device Message Parsing', () => {
    describe('CLIPBOARD message', () => {
      it('should parse clipboard text correctly', async () => {
        const { videoStream, deviceMsgStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        deviceMsgStream.sendClipboard('Hello, World!');
        await nextTick();

        expect(clipboardCallback).toHaveBeenCalledWith('Hello, World!');
      });

      it('should handle empty clipboard', async () => {
        const { videoStream, deviceMsgStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        // First send non-empty clipboard to initialize state
        deviceMsgStream.sendClipboard('initial');
        await nextTick();
        clipboardCallback.mockClear();

        // Now send empty clipboard - should be detected as change
        deviceMsgStream.sendClipboard('');
        await nextTick();

        expect(clipboardCallback).toHaveBeenCalledWith('');
      });

      it('should handle unicode clipboard text', async () => {
        const { videoStream, deviceMsgStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        deviceMsgStream.sendClipboard('你好世界 🎉');
        await nextTick();

        expect(clipboardCallback).toHaveBeenCalledWith('你好世界 🎉');
      });

      it('should wait for complete message before parsing', async () => {
        const { videoStream, deviceMsgStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        const clipboardMsg = createClipboardMessage('Test Fragment');
        deviceMsgStream.sendFragmented(clipboardMsg, 3);
        await nextTick();

        expect(clipboardCallback).toHaveBeenCalledWith('Test Fragment');
      });
    });

    describe('ACK_CLIPBOARD message', () => {
      it('should parse 8-byte sequence number', async () => {
        const { videoStream, deviceMsgStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        deviceMsgStream.sendAckClipboard(12345n);
        await nextTick();

        // No error should have occurred
        expect(errorCallback).not.toHaveBeenCalled();
      });
    });

    describe('UHID_OUTPUT message', () => {
      it('should parse UHID message correctly', async () => {
        const { videoStream, deviceMsgStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        const uhidData = Buffer.from([0x01, 0x02, 0x03]);
        deviceMsgStream.sendUhidOutput(1, uhidData);
        await nextTick();

        expect(errorCallback).not.toHaveBeenCalled();
      });

      it('should handle UHID with zero-length data', async () => {
        const { videoStream, deviceMsgStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        deviceMsgStream.sendUhidOutput(1, Buffer.alloc(0));
        await nextTick();

        expect(errorCallback).not.toHaveBeenCalled();
      });
    });

    describe('Unknown message type', () => {
      it('should skip one byte for unknown message types', async () => {
        const { videoStream, deviceMsgStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        deviceMsgStream.sendUnknown(0xff);
        deviceMsgStream.sendClipboard('After unknown');
        await nextTick();

        expect(clipboardCallback).toHaveBeenCalledWith('After unknown');
      });

      it('should handle multiple unknown types in sequence', async () => {
        const { videoStream, deviceMsgStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        deviceMsgStream.sendUnknown(0xfe);
        deviceMsgStream.sendUnknown(0xfd);
        deviceMsgStream.sendUnknown(0xfc);
        deviceMsgStream.sendClipboard('Finally valid');
        await nextTick();

        expect(clipboardCallback).toHaveBeenCalledWith('Finally valid');
      });
    });

    describe('Multiple messages in buffer', () => {
      it('should process multiple complete messages', async () => {
        const { videoStream, deviceMsgStream } = await startScrcpyWithMockSockets();

        videoStream.sendFullHeader('Test', VIDEO_CODEC_IDS.H264, 1920, 1080);
        await nextTick();

        const msg1 = createClipboardMessage('First');
        const msg2 = createClipboardMessage('Second');
        const msg3 = createClipboardMessage('Third');
        const combined = Buffer.concat([msg1, msg2, msg3]);

        deviceMsgStream.sendRaw(combined);
        await nextTick();

        expect(clipboardCallback).toHaveBeenCalledTimes(3);
        expect(clipboardCallback).toHaveBeenNthCalledWith(1, 'First');
        expect(clipboardCallback).toHaveBeenNthCalledWith(2, 'Second');
        expect(clipboardCallback).toHaveBeenNthCalledWith(3, 'Third');
      });
    });
  });
});
