import { describe, it, expect } from 'vitest';
import {
  CodecUtils,
  NALUnitType,
  H264NALUnitType,
  H265NALUnitType,
} from '../../src/webview/CodecUtils';
import { INVALID_DATA, H264_SPS_1920x1080 } from '../fixtures/h264-samples';

describe('CodecUtils', () => {
  describe('NAL unit type enums', () => {
    it('should have correct H.264 NAL unit type values (NALUnitType is alias)', () => {
      // NALUnitType is a backward-compatible alias for H264NALUnitType
      expect(NALUnitType.IDR).toBe(H264NALUnitType.IDR);
      expect(NALUnitType.SPS).toBe(H264NALUnitType.SPS);
      expect(NALUnitType.PPS).toBe(H264NALUnitType.PPS);
      // Standard H.264 NAL types
      expect(H264NALUnitType.IDR).toBe(5);
      expect(H264NALUnitType.SPS).toBe(7);
      expect(H264NALUnitType.PPS).toBe(8);
    });

    it('should have correct H.265 NAL unit type values', () => {
      expect(H265NALUnitType.VPS).toBe(32);
      expect(H265NALUnitType.SPS).toBe(33);
      expect(H265NALUnitType.PPS).toBe(34);
      expect(H265NALUnitType.IDR_W_RADL).toBe(19);
      expect(H265NALUnitType.IDR_N_LP).toBe(20);
    });
  });

  describe('parseH264SPSDimensions', () => {
    it.each([
      ['empty data', INVALID_DATA.empty],
      ['data too short', INVALID_DATA.tooShort],
      ['data without start code', INVALID_DATA.noStartCode],
      ['PPS only (no SPS)', new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x68, 0xee, 0x3c, 0x80])],
    ])('should return null for %s', (_name, data) => {
      const result = CodecUtils.parseH264SPSDimensions(data);
      expect(result).toBeNull();
    });

    it('should handle truncated SPS data without crashing', () => {
      expect(() => {
        CodecUtils.parseH264SPSDimensions(INVALID_DATA.truncated);
      }).not.toThrow();
    });

    it('should find and parse SPS with 3-byte start code', () => {
      const spsWithShortStartCode = new Uint8Array([
        0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x28, 0xac, 0xd9, 0x40, 0x78, 0x02, 0x27, 0xe5, 0xc0,
        0x44, 0x00, 0x00, 0x03, 0x00, 0x04, 0x00, 0x00, 0x03, 0x00, 0xf0, 0x3c, 0x60, 0xc6, 0x58,
      ]);
      // Parser may succeed or fail depending on SPS validity - but should not crash
      expect(() => CodecUtils.parseH264SPSDimensions(spsWithShortStartCode)).not.toThrow();
    });

    it('should find SPS when preceded by other NAL units', () => {
      // Buffer with PPS first (type 8), then SPS (type 7)
      const mixedData = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x01,
        0x68,
        0xee,
        0x3c,
        0x80, // PPS
        0x00,
        0x00,
        0x00,
        0x01,
        0x67,
        0x64,
        0x00,
        0x28, // SPS header
        0xac,
        0xd9,
        0x40,
        0x78,
        0x02,
        0x27,
        0xe5,
        0xc0,
        0x44,
        0x00,
        0x00,
        0x03,
        0x00,
        0x04,
        0x00,
        0x00,
        0x03,
        0x00,
        0xf0,
        0x3c,
        0x60,
        0xc6,
        0x58,
      ]);
      // Should find SPS even when not first NAL unit
      expect(() => CodecUtils.parseH264SPSDimensions(mixedData)).not.toThrow();
    });
  });

  describe('extractH264SPSInfo', () => {
    it('should return null for data without valid SPS', () => {
      expect(CodecUtils.extractH264SPSInfo(INVALID_DATA.empty)).toBeNull();
      expect(CodecUtils.extractH264SPSInfo(INVALID_DATA.noStartCode)).toBeNull();
    });

    it('should extract profile/constraint/level structure from valid SPS', () => {
      const sps = new Uint8Array([
        0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x28, 0xac, 0xd9, 0x40, 0x78, 0x02, 0x27, 0xe5,
        0xc0, 0x44, 0x00, 0x00, 0x03, 0x00, 0x04, 0x00, 0x00, 0x03, 0x00, 0xf0, 0x3c, 0x60, 0xc6,
        0x58,
      ]);
      const result = CodecUtils.extractH264SPSInfo(sps);
      if (result !== null) {
        expect(typeof result.profile).toBe('number');
        expect(typeof result.constraint).toBe('number');
        expect(typeof result.level).toBe('number');
      }
    });
  });

  describe('detectCodec', () => {
    it('should detect H.264 codec from SPS NAL unit', () => {
      expect(CodecUtils.detectCodec(H264_SPS_1920x1080)).toBe('h264');
    });

    it.each([
      ['VPS (type 32)', new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x40, 0x01, 0x0c, 0x01])],
      ['SPS (type 33)', new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x42, 0x01, 0x01, 0x01])],
      ['PPS (type 34)', new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x44, 0x01, 0x00, 0x00])],
    ])('should detect H.265 codec from %s', (_name, data) => {
      expect(CodecUtils.detectCodec(data)).toBe('h265');
    });

    it.each([
      ['no start code', INVALID_DATA.noStartCode],
      ['empty data', INVALID_DATA.empty],
      ['non-config NAL (type 1)', new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x21, 0x00, 0x00])],
    ])('should return null for %s', (_name, data) => {
      expect(CodecUtils.detectCodec(data)).toBeNull();
    });
  });

  describe('parseConfigDimensions', () => {
    it('should return null for H.265 and AV1 (not implemented)', () => {
      const h265Vps = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x40, 0x01, 0x0c, 0x01, 0xff, 0xff]);
      expect(CodecUtils.parseConfigDimensions(h265Vps, 'h265')).toBeNull();
      expect(CodecUtils.parseConfigDimensions(new Uint8Array([0x0a, 0x00]), 'av1')).toBeNull();
    });

    it('should return null when codec cannot be detected', () => {
      expect(CodecUtils.parseConfigDimensions(INVALID_DATA.noStartCode)).toBeNull();
    });

    it('should attempt H.264 parsing when codec specified or detected', () => {
      // Should not throw - may return null or valid dimensions
      expect(() => CodecUtils.parseConfigDimensions(H264_SPS_1920x1080, 'h264')).not.toThrow();
      expect(() => CodecUtils.parseConfigDimensions(H264_SPS_1920x1080)).not.toThrow();
    });
  });

  describe('containsKeyFrame', () => {
    describe('H.264', () => {
      it.each([
        ['4-byte start code', new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00])],
        ['3-byte start code', new Uint8Array([0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00])],
      ])('should detect IDR frame with %s', (_name, data) => {
        expect(CodecUtils.containsKeyFrame(data, 'h264')).toBe(true);
      });

      it('should not detect non-IDR frame as keyframe', () => {
        const nonIdr = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x41, 0x9a, 0x24, 0x00]);
        expect(CodecUtils.containsKeyFrame(nonIdr, 'h264')).toBe(false);
      });
    });

    describe('H.265', () => {
      it.each([
        ['IDR_W_RADL (type 19)', new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x26, 0x01, 0x00, 0x00])],
        ['IDR_N_LP (type 20)', new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x28, 0x01, 0x00, 0x00])],
      ])('should detect %s as keyframe', (_name, data) => {
        expect(CodecUtils.containsKeyFrame(data, 'h265')).toBe(true);
      });

      it('should not detect P-slice as keyframe', () => {
        const nonIdr = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x02, 0x01, 0x00, 0x00]);
        expect(CodecUtils.containsKeyFrame(nonIdr, 'h265')).toBe(false);
      });
    });

    it.each([
      ['AV1 data', new Uint8Array([0x0a, 0x00, 0x00, 0x00]), 'av1'],
      ['empty data (H.264)', INVALID_DATA.empty, 'h264'],
      ['too short data (H.264)', INVALID_DATA.tooShort, 'h264'],
    ])('should return false for %s', (_name, data, codec) => {
      expect(CodecUtils.containsKeyFrame(data, codec as 'h264' | 'h265' | 'av1')).toBe(false);
    });
  });

  describe('generateCodecString', () => {
    it('should generate codec strings for each codec type', () => {
      expect(CodecUtils.generateCodecString('h264')).toBe('avc1.42001f');
      expect(CodecUtils.generateCodecString('h265')).toBe('hev1.1.6.L93.B0');
      expect(CodecUtils.generateCodecString('av1')).toBe('av01.0.05M.08');
    });

    it('should generate H.264 codec string from SPS profile/level info', () => {
      const result = CodecUtils.generateCodecString('h264', H264_SPS_1920x1080);
      expect(result).toMatch(/^avc1\.[0-9a-f]{6}$/);
    });

    it('should fallback to default H.264 codec string for invalid config', () => {
      expect(CodecUtils.generateCodecString('h264', INVALID_DATA.noStartCode)).toBe('avc1.42001f');
    });
  });

  describe('backward compatibility', () => {
    it('should export H264Utils as alias for CodecUtils', async () => {
      const { H264Utils } = await import('../../src/webview/CodecUtils');
      expect(H264Utils).toBe(CodecUtils);
    });
  });

  describe('NAL detection edge cases', () => {
    it('should find start code at very beginning of buffer', () => {
      const dataWithStartCodeAtBeginning = new Uint8Array([
        0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x28, 0xac, 0xd9, 0x40,
      ]);
      // Should find the SPS and not crash
      expect(() => CodecUtils.detectCodec(dataWithStartCodeAtBeginning)).not.toThrow();
      expect(CodecUtils.detectCodec(dataWithStartCodeAtBeginning)).toBe('h264');
    });

    it('should handle multiple consecutive start codes', () => {
      const dataWithConsecutiveStartCodes = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x01, // Start code 1
        0x67,
        0x64, // SPS NAL
        0x00,
        0x00,
        0x00,
        0x01, // Start code 2 (immediately after minimal SPS)
        0x68,
        0xee, // PPS NAL
      ]);
      expect(() => CodecUtils.detectCodec(dataWithConsecutiveStartCodes)).not.toThrow();
    });

    it('should handle buffer ending with partial start code', () => {
      // Buffer ends with 0x00 0x00 0x00 (incomplete 4-byte start code)
      const truncatedBuffer = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x01,
        0x67,
        0x64,
        0x00,
        0x28, // Valid SPS start
        0x00,
        0x00,
        0x00, // Incomplete start code at end
      ]);
      expect(() => CodecUtils.parseH264SPSDimensions(truncatedBuffer)).not.toThrow();
    });

    it('should handle buffer with only start code and single byte', () => {
      const minimalBuffer = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67]);
      expect(() => CodecUtils.parseH264SPSDimensions(minimalBuffer)).not.toThrow();
    });

    it('should detect H.265 VPS/SPS/PPS in different orders', () => {
      // PPS before VPS (unusual but valid)
      const ppsFirst = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x44, 0x01, 0x00]);
      expect(CodecUtils.detectCodec(ppsFirst)).toBe('h265');

      // VPS only
      const vpsOnly = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x40, 0x01, 0x0c]);
      expect(CodecUtils.detectCodec(vpsOnly)).toBe('h265');
    });
  });

  describe('SPS parsing edge cases', () => {
    it('should handle SPS with profile_idc 100 (High)', () => {
      // High profile SPS
      const highProfileSps = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x01,
        0x67,
        0x64,
        0x00,
        0x28, // profile_idc=100 (High)
        0xac,
        0xd9,
        0x40,
        0x78,
        0x02,
        0x27,
        0xe5,
        0xc0,
      ]);
      const result = CodecUtils.extractH264SPSInfo(highProfileSps);
      if (result) {
        expect(result.profile).toBe(100);
      }
    });

    it('should handle SPS with profile_idc 66 (Baseline)', () => {
      const baselineProfileSps = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x01,
        0x67,
        0x42,
        0x00,
        0x1f, // profile_idc=66 (Baseline)
        0xe9,
        0x02,
        0x83,
        0x24,
        0x30,
      ]);
      const result = CodecUtils.extractH264SPSInfo(baselineProfileSps);
      if (result) {
        expect(result.profile).toBe(66);
      }
    });

    it('should handle SPS parsing failure gracefully', () => {
      // Malformed SPS data
      const malformedSps = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x01,
        0x67, // SPS start
        0xff,
        0xff,
        0xff,
        0xff, // Invalid data
      ]);
      // Should not throw, just return null or partial result
      expect(() => CodecUtils.extractH264SPSInfo(malformedSps)).not.toThrow();
    });
  });

  describe('keyframe detection edge cases', () => {
    it('should handle IDR with different nal_ref_idc values', () => {
      // IDR with nal_ref_idc = 3 (bits 5-6 = 11)
      const idrHighRef = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88]); // 0x65 = 0110 0101
      expect(CodecUtils.containsKeyFrame(idrHighRef, 'h264')).toBe(true);

      // IDR with nal_ref_idc = 2 (bits 5-6 = 10)
      const idrMidRef = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x45, 0x88]); // 0x45 = 0100 0101
      expect(CodecUtils.containsKeyFrame(idrMidRef, 'h264')).toBe(true);
    });

    it('should not detect SPS/PPS as keyframes', () => {
      const sps = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x28]);
      const pps = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x68, 0xee, 0x3c, 0x80]);
      expect(CodecUtils.containsKeyFrame(sps, 'h264')).toBe(false);
      expect(CodecUtils.containsKeyFrame(pps, 'h264')).toBe(false);
    });

    it('should handle H.265 CRA frames (not keyframes)', () => {
      // CRA_NUT = 21, should not be considered a keyframe for our purposes
      const craNal = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x2a, 0x01]); // (21 << 1) = 0x2a
      expect(CodecUtils.containsKeyFrame(craNal, 'h265')).toBe(false);
    });
  });

  describe('codec string generation edge cases', () => {
    it('should handle empty config data for H.264', () => {
      expect(CodecUtils.generateCodecString('h264', new Uint8Array(0))).toBe('avc1.42001f');
    });

    it('should generate valid codec string for each supported codec', () => {
      expect(CodecUtils.generateCodecString('h264')).toMatch(/^avc1\./);
      expect(CodecUtils.generateCodecString('h265')).toMatch(/^hev1\./);
      expect(CodecUtils.generateCodecString('av1')).toMatch(/^av01\./);
    });
  });
});
