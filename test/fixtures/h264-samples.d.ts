/**
 * Sample H.264 data for testing
 *
 * These are real H.264 NAL units that can be used to test SPS parsing
 */
/**
 * SPS NAL unit for 1920x1080 (landscape)
 * Profile: High (100), Level: 4.0 (40)
 *
 * This is a typical SPS from an Android device in landscape mode
 */
export declare const H264_SPS_1920x1080: Uint8Array<ArrayBuffer>;
/**
 * SPS NAL unit for 1080x1920 (portrait)
 * Same profile/level but rotated dimensions
 */
export declare const H264_SPS_1080x1920: Uint8Array<ArrayBuffer>;
/**
 * SPS NAL unit for 720x1280 (common lower resolution)
 */
export declare const H264_SPS_720x1280: Uint8Array<ArrayBuffer>;
/**
 * PPS NAL unit (Picture Parameter Set)
 */
export declare const H264_PPS: Uint8Array<ArrayBuffer>;
/**
 * IDR frame header (Instantaneous Decoder Refresh)
 * This is just the NAL header, actual frame data would follow
 */
export declare const H264_IDR_HEADER: Uint8Array<ArrayBuffer>;
/**
 * Non-IDR frame header (P-frame or B-frame)
 */
export declare const H264_NON_IDR_HEADER: Uint8Array<ArrayBuffer>;
/**
 * Config packet combining SPS and PPS (common format from scrcpy)
 */
export declare const H264_CONFIG_1920x1080: Uint8Array<ArrayBuffer>;
/**
 * Invalid/malformed data for error testing
 */
export declare const INVALID_DATA: {
  tooShort: Uint8Array<ArrayBuffer>;
  noStartCode: Uint8Array<ArrayBuffer>;
  unknownNalType: Uint8Array<ArrayBuffer>;
  truncated: Uint8Array<ArrayBuffer>;
  empty: Uint8Array<ArrayBuffer>;
};
/**
 * Helper to create a complete config packet with custom dimensions
 *
 * Note: This creates a simplified/mock SPS that may not be parseable
 * by real H.264 decoders, but is useful for testing the parsing logic
 */
export declare function createMockSPS(profile: number, level: number): Uint8Array;
/**
 * Create a buffer containing video stream header (as sent by scrcpy server)
 */
export declare function createScrcpyVideoHeader(
  deviceName: string,
  codecId: number,
  width: number,
  height: number
): Buffer;
//# sourceMappingURL=h264-samples.d.ts.map
