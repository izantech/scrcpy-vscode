/**
 * Protocol test helpers for simulating scrcpy server communication
 */

import { MockSocket } from '../mocks/net';
import {
  createDeviceNameHeader,
  createVideoCodecMeta,
  createVideoPacket,
  createAudioCodecMeta,
  createAudioPacket,
  createClipboardMessage,
  createAckClipboardMessage,
  createUhidOutputMessage,
  VIDEO_CODEC_IDS,
  AUDIO_OPUS_CODEC_ID,
} from '../fixtures/h264-samples';

/**
 * Helper class to simulate scrcpy server video stream
 */
export class MockScrcpyVideoStream {
  constructor(private socket: MockSocket) {}

  /**
   * Send device name header (64 bytes, null-padded)
   */
  sendDeviceName(name: string): void {
    this.socket.simulateData(createDeviceNameHeader(name));
  }

  /**
   * Send video codec metadata (codec_id + width + height)
   */
  sendCodecMeta(codecId: number, width: number, height: number): void {
    this.socket.simulateData(createVideoCodecMeta(codecId, width, height));
  }

  /**
   * Send complete video header (device name + codec metadata)
   */
  sendFullHeader(deviceName: string, codecId: number, width: number, height: number): void {
    this.sendDeviceName(deviceName);
    this.sendCodecMeta(codecId, width, height);
  }

  /**
   * Send a video packet
   */
  sendVideoPacket(pts: bigint, isConfig: boolean, isKeyFrame: boolean, data: Buffer): void {
    this.socket.simulateData(createVideoPacket(pts, isConfig, isKeyFrame, data));
  }

  /**
   * Simulate fragmented data delivery (for testing buffer reassembly)
   */
  sendFragmented(data: Buffer, chunkSize: number): void {
    for (let i = 0; i < data.length; i += chunkSize) {
      this.socket.simulateData(data.subarray(i, Math.min(i + chunkSize, data.length)));
    }
  }

  /**
   * Send raw data directly to socket
   */
  sendRaw(data: Buffer): void {
    this.socket.simulateData(data);
  }
}

/**
 * Helper class to simulate scrcpy server audio stream
 */
export class MockScrcpyAudioStream {
  constructor(private socket: MockSocket) {}

  /**
   * Send audio codec metadata (4 bytes)
   */
  sendCodecMeta(codecId: number = AUDIO_OPUS_CODEC_ID): void {
    this.socket.simulateData(createAudioCodecMeta(codecId));
  }

  /**
   * Send an audio packet
   */
  sendAudioPacket(pts: bigint, isConfig: boolean, data: Buffer): void {
    this.socket.simulateData(createAudioPacket(pts, isConfig, data));
  }

  /**
   * Simulate fragmented data delivery
   */
  sendFragmented(data: Buffer, chunkSize: number): void {
    for (let i = 0; i < data.length; i += chunkSize) {
      this.socket.simulateData(data.subarray(i, Math.min(i + chunkSize, data.length)));
    }
  }

  /**
   * Send raw data directly to socket
   */
  sendRaw(data: Buffer): void {
    this.socket.simulateData(data);
  }
}

/**
 * Helper class to simulate device messages on control socket
 */
export class MockDeviceMessageStream {
  constructor(private socket: MockSocket) {}

  /**
   * Send a clipboard message
   */
  sendClipboard(text: string): void {
    this.socket.simulateData(createClipboardMessage(text));
  }

  /**
   * Send an ACK_CLIPBOARD message
   */
  sendAckClipboard(sequence: bigint): void {
    this.socket.simulateData(createAckClipboardMessage(sequence));
  }

  /**
   * Send a UHID_OUTPUT message
   */
  sendUhidOutput(id: number, data: Buffer): void {
    this.socket.simulateData(createUhidOutputMessage(id, data));
  }

  /**
   * Send an unknown message type (for testing error handling)
   */
  sendUnknown(type: number): void {
    const msg = Buffer.alloc(1);
    msg.writeUInt8(type, 0);
    this.socket.simulateData(msg);
  }

  /**
   * Simulate fragmented data delivery
   */
  sendFragmented(data: Buffer, chunkSize: number): void {
    for (let i = 0; i < data.length; i += chunkSize) {
      this.socket.simulateData(data.subarray(i, Math.min(i + chunkSize, data.length)));
    }
  }

  /**
   * Send raw data directly to socket
   */
  sendRaw(data: Buffer): void {
    this.socket.simulateData(data);
  }
}

/**
 * Wait for next tick to allow async operations to complete
 */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Flush microtask queue
 */
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

// Re-export codec constants for convenience
export { VIDEO_CODEC_IDS, AUDIO_OPUS_CODEC_ID };
