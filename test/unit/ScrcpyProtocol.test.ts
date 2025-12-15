import { describe, it, expect } from 'vitest';
import {
  DEVICE_NAME_LENGTH,
  VIDEO_CODEC_ID_H264,
  VIDEO_CODEC_ID_H265,
  VIDEO_CODEC_ID_AV1,
  AUDIO_CODEC_ID_OPUS,
  ControlMessageType,
  DeviceMessageType,
  MotionEventAction,
  KeyAction,
  ScrcpyProtocol,
} from '../../src/android/ScrcpyProtocol';

describe('ScrcpyProtocol', () => {
  describe('codec IDs (protocol documentation)', () => {
    it('should encode H.264 codec ID as "h264" in ASCII', () => {
      // Protocol uses ASCII strings as codec identifiers
      const bytes = [
        (VIDEO_CODEC_ID_H264 >> 24) & 0xff,
        (VIDEO_CODEC_ID_H264 >> 16) & 0xff,
        (VIDEO_CODEC_ID_H264 >> 8) & 0xff,
        VIDEO_CODEC_ID_H264 & 0xff,
      ];
      expect(String.fromCharCode(...bytes)).toBe('h264');
    });

    it('should encode H.265 codec ID as "h265" in ASCII', () => {
      const bytes = [
        (VIDEO_CODEC_ID_H265 >> 24) & 0xff,
        (VIDEO_CODEC_ID_H265 >> 16) & 0xff,
        (VIDEO_CODEC_ID_H265 >> 8) & 0xff,
        VIDEO_CODEC_ID_H265 & 0xff,
      ];
      expect(String.fromCharCode(...bytes)).toBe('h265');
    });

    it('should encode AV1 codec ID as "av01" in ASCII (with null prefix)', () => {
      // AV1 uses 0x00617631 which is "\0av1"
      const bytes = [
        (VIDEO_CODEC_ID_AV1 >> 24) & 0xff,
        (VIDEO_CODEC_ID_AV1 >> 16) & 0xff,
        (VIDEO_CODEC_ID_AV1 >> 8) & 0xff,
        VIDEO_CODEC_ID_AV1 & 0xff,
      ];
      expect(String.fromCharCode(...bytes)).toBe('\0av1');
    });

    it('should encode Opus audio codec ID as "opus" in ASCII', () => {
      const bytes = [
        (AUDIO_CODEC_ID_OPUS >> 24) & 0xff,
        (AUDIO_CODEC_ID_OPUS >> 16) & 0xff,
        (AUDIO_CODEC_ID_OPUS >> 8) & 0xff,
        AUDIO_CODEC_ID_OPUS & 0xff,
      ];
      expect(String.fromCharCode(...bytes)).toBe('opus');
    });
  });

  describe('protocol correctness', () => {
    it('should have device name length of 64 bytes', () => {
      // scrcpy protocol specifies 64-byte device name header
      expect(DEVICE_NAME_LENGTH).toBe(64);
    });

    it('should have non-overlapping control message types', () => {
      const types = Object.values(ControlMessageType).filter(
        (v) => typeof v === 'number'
      ) as number[];
      const uniqueTypes = new Set(types);
      expect(uniqueTypes.size).toBe(types.length);
    });

    it('should have non-overlapping device message types', () => {
      const types = Object.values(DeviceMessageType).filter(
        (v) => typeof v === 'number'
      ) as number[];
      const uniqueTypes = new Set(types);
      expect(uniqueTypes.size).toBe(types.length);
    });
  });

  describe('ScrcpyProtocol namespace (backwards compatibility)', () => {
    it('should re-export all constants and enums via namespace', () => {
      expect(ScrcpyProtocol.DEVICE_NAME_LENGTH).toBe(DEVICE_NAME_LENGTH);
      expect(ScrcpyProtocol.VIDEO_CODEC_ID_H264).toBe(VIDEO_CODEC_ID_H264);
      expect(ScrcpyProtocol.AUDIO_CODEC_ID_OPUS).toBe(AUDIO_CODEC_ID_OPUS);
      expect(ScrcpyProtocol.ControlMessageType).toBe(ControlMessageType);
      expect(ScrcpyProtocol.DeviceMessageType).toBe(DeviceMessageType);
      expect(ScrcpyProtocol.MotionEventAction).toBe(MotionEventAction);
      expect(ScrcpyProtocol.KeyAction).toBe(KeyAction);
    });
  });
});
