/**
 * H.264 Utilities
 * 
 * Provides functionality to parse H.264 bitstreams, specifically Sequence Parameter Sets (SPS),
 * to extract video dimensions. This is necessary because WebCodecs VideoDecoder
 * needs to be reconfigured when the video resolution changes (e.g. device rotation),
 * and the stream provides this information in the SPS NAL unit.
 * 
 * Uses 'h264-sps-parser' library for robust parsing.
 */

import { Buffer } from 'buffer';
import { parse as parseSPS } from 'h264-sps-parser';

/**
 * H.264 NAL Unit Types
 */
export enum NALUnitType {
  IDR = 5,
  SPS = 7,
  PPS = 8
}

export class H264Utils {
  /**
   * Parse SPS to extract video dimensions
   */
  static parseSPSDimensions(config: Uint8Array): { width: number; height: number } | null {
    // Find SPS NAL unit (type 7)
    const spsData = this.findSPS(config);
    if (!spsData) return null;

    try {
      // Parse using library
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sps = parseSPS(Buffer.from(spsData)) as any;
      
      const frameMbsOnly = sps.frame_mbs_only_flag;
      const width = sps.pic_width_in_mbs * 16;
      const height = sps.pic_height_in_map_units * 16 * (2 - frameMbsOnly);
      
      let cropX = 0;
      let cropY = 0;
      
      if (sps.frame_cropping_flag) {
        const crop = sps.frame_cropping;
        
        let subWidthC = 2;
        let subHeightC = 2;
        
        // chroma_format_idc defaults to 1 (4:2:0) in the library if not present
        if (sps.chroma_format_idc === 2) { 
          subWidthC = 2; 
          subHeightC = 1; 
        } else if (sps.chroma_format_idc === 3) { 
          subWidthC = 1; 
          subHeightC = 1; 
        }
        
        const cropUnitX = subWidthC;
        const cropUnitY = subHeightC * (2 - frameMbsOnly);
        
        cropX = (crop.left + crop.right) * cropUnitX;
        cropY = (crop.top + crop.bottom) * cropUnitY;
      }
      
      return { width: width - cropX, height: height - cropY };
    } catch (error) {
      console.error('Failed to parse SPS:', error);
      return null;
    }
  }

  /**
   * Extract SPS info (profile, constraint, level) from config data
   */
  static extractSPSInfo(config: Uint8Array): { profile: number; constraint: number; level: number } | null {
    const spsData = this.findSPS(config);
    if (!spsData) return null;

    try {
      const sps = parseSPS(Buffer.from(spsData));
      return {
        profile: sps.profile_idc,
        constraint: sps.profile_compatibility,
        level: sps.level_idc
      };
    } catch (error) {
      console.error('Failed to parse SPS info:', error);
      return null;
    }
  }

  /**
   * Find the SPS NAL unit payload in a config stream
   * Returns the NAL unit starting at the NAL header (required by h264-sps-parser)
   */
  private static findSPS(config: Uint8Array): Uint8Array | null {
    // Find SPS NAL unit (type 7)
    for (let i = 0; i < config.length - 4; i++) {
      let offset = 0;
      if (config[i] === 0 && config[i + 1] === 0 && config[i + 2] === 1) {
        offset = 3;
      } else if (config[i] === 0 && config[i + 1] === 0 && config[i + 2] === 0 && config[i + 3] === 1) {
        offset = 4;
      }

      if (offset > 0) {
        const nalType = config[i + offset] & 0x1F;
        if (nalType === NALUnitType.SPS) {
          // Found SPS
          // Return data starting AT the NAL header byte
          const spsStart = i + offset;
          return config.subarray(spsStart);
        }
      }
    }
    return null;
  }
}
