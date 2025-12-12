/**
 * H.264 video decoder and renderer using WebCodecs API
 *
 * Follows the same approach as scrcpy client:
 * - Config packets (SPS/PPS) are merged with the next keyframe
 * - Data is passed in Annex B format (start code prefixed)
 */
export class VideoRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private decoder: VideoDecoder | null = null;
  private onStats: ((fps: number, frames: number) => void) | null;
  private onDimensionsChanged: ((width: number, height: number) => void) | null;

  private width = 0;
  private height = 0;
  private frameCount = 0;
  private totalFrames = 0;
  private lastFpsUpdate = 0;
  private fps = 0;
  private pendingFrames: VideoFrame[] = [];
  private isRendering = false;
  private statsEnabled = false;

  // Config packet storage (like sc_packet_merger in scrcpy)
  private pendingConfig: Uint8Array | null = null;
  private codecConfigured = false;
  private isPaused = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    onStats: ((fps: number, frames: number) => void) | null,
    onDimensionsChanged?: ((width: number, height: number) => void) | null
  ) {
    this.canvas = canvas;
    this.onStats = onStats;
    this.onDimensionsChanged = onDimensionsChanged ?? null;

    // Check WebCodecs support
    if (typeof VideoDecoder === 'undefined') {
      console.error('WebCodecs API not supported');
      return;
    }

    // Observe container resize
    const container = canvas.parentElement;
    if (container) {
      this.resizeObserver = new ResizeObserver(() => this.fitToContainer());
      this.resizeObserver.observe(container);
    }
  }

  /**
   * Configure renderer with video dimensions
   */
  configure(width: number, height: number) {
    this.width = width;
    this.height = height;

    // Set canvas size (drawing buffer)
    this.canvas.width = width;
    this.canvas.height = height;

    // Fit canvas to container while maintaining aspect ratio
    this.fitToContainer();

    // Get 2D context for rendering
    this.ctx = this.canvas.getContext('2d');

    // Clear any pending frames before creating new decoder
    for (const frame of this.pendingFrames) {
      frame.close();
    }
    this.pendingFrames = [];
    // Don't clear pendingConfig - it may have just been set with new SPS for rotation

    // Reset FPS tracking
    this.frameCount = 0;
    this.totalFrames = 0;
    if (this.statsEnabled) {
      this.lastFpsUpdate = performance.now();
    }

    // Create decoder
    this.createDecoder();

    console.log(`Video configured: ${width}x${height}`);
  }

  /**
   * Fit canvas to container while maintaining aspect ratio
   */
  private fitToContainer() {
    if (this.width === 0 || this.height === 0) return;

    const container = this.canvas.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const aspectRatio = this.width / this.height;

    // Calculate display size that fits within container
    let displayWidth = rect.width;
    let displayHeight = displayWidth / aspectRatio;

    // If height exceeds container, scale based on height instead
    if (displayHeight > rect.height) {
      displayHeight = rect.height;
      displayWidth = displayHeight * aspectRatio;
    }

    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;
  }

  /**
   * Create WebCodecs video decoder
   */
  private createDecoder() {
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
        // Ignore close errors
      }
    }

    this.decoder = new VideoDecoder({
      output: (frame) => this.handleDecodedFrame(frame),
      error: (error) => console.error('Decoder error:', error)
    });

    this.codecConfigured = false;
  }

  /**
   * Pause video rendering (drops frames while paused)
   */
  pause(): void {
    this.isPaused = true;
    this.isRendering = false;
    // Clear pending frames to free memory
    for (const frame of this.pendingFrames) {
      frame.close();
    }
    this.pendingFrames = [];
  }

  /**
   * Resume video rendering
   */
  resume(): void {
    this.isPaused = false;
  }

  /**
   * Push encoded video frame data
   * Following scrcpy approach: config packets are stored and prepended to next keyframe
   */
  pushFrame(data: Uint8Array, isConfig: boolean) {
    if (!this.decoder || !this.ctx) {
      return;
    }

    // Drop non-config frames when paused (keep config for codec)
    if (this.isPaused && !isConfig) {
      return;
    }

    if (isConfig) {
      // Store config packet (SPS/PPS) to prepend to next keyframe
      // This matches sc_packet_merger behavior in scrcpy
      this.pendingConfig = data;

      // Parse SPS for dimensions (rotation sends new SPS with new dimensions)
      const dims = this.parseSPSDimensions(data);
      if (dims && (dims.width !== this.width || dims.height !== this.height)) {
        this.configure(dims.width, dims.height);
        this.onDimensionsChanged?.(dims.width, dims.height);
      }
      return;
    }

    // Check if this is a keyframe by looking at NAL type
    const isKeyFrame = this.containsKeyFrame(data);

    // Configure codec on first keyframe with config
    if (!this.codecConfigured && isKeyFrame && this.pendingConfig) {
      this.configureCodec();
    }

    if (!this.codecConfigured) {
      // Can't decode without codec configuration
      return;
    }

    try {
      // Merge config with keyframe (like sc_packet_merger_merge)
      let frameData = data;
      if (isKeyFrame && this.pendingConfig) {
        frameData = this.mergeConfigWithFrame(this.pendingConfig, data);
        this.pendingConfig = null;
      }

      const chunk = new EncodedVideoChunk({
        type: isKeyFrame ? 'key' : 'delta',
        timestamp: performance.now() * 1000, // microseconds
        data: frameData
      });

      this.decoder.decode(chunk);
    } catch (error) {
      console.error('Failed to decode frame:', error);
    }
  }

  /**
   * Check if data contains a keyframe (IDR NAL unit)
   */
  private containsKeyFrame(data: Uint8Array): boolean {
    // Look for IDR NAL unit (type 5) in the data
    for (let i = 0; i < data.length - 4; i++) {
      // Find start code
      if ((data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) ||
          (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1)) {
        const offset = data[i + 2] === 1 ? 3 : 4;
        const nalType = data[i + offset] & 0x1F;
        if (nalType === 5) { // IDR
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Configure the WebCodecs decoder
   * Uses Annex B format without description (like FFmpeg)
   */
  private configureCodec() {
    if (!this.decoder || !this.pendingConfig) {
      return;
    }

    try {
      // Extract profile info from SPS for codec string
      const spsInfo = this.extractSPSInfo(this.pendingConfig);

      const codecString = spsInfo
        ? `avc1.${spsInfo.profile.toString(16).padStart(2, '0')}${spsInfo.constraint.toString(16).padStart(2, '0')}${spsInfo.level.toString(16).padStart(2, '0')}`
        : 'avc1.42001f'; // Default to baseline profile level 3.1

      console.log(`Configuring codec: ${codecString}, ${this.width}x${this.height}`);

      // Configure WITHOUT description - use Annex B format like FFmpeg
      this.decoder.configure({
        codec: codecString,
        codedWidth: this.width,
        codedHeight: this.height,
        // No description - data will be in Annex B format
      });

      this.codecConfigured = true;
      console.log('Codec configured successfully (Annex B mode)');
    } catch (error) {
      console.error('Failed to configure codec:', error);
    }
  }

  /**
   * Parse SPS to extract video dimensions
   */
  private parseSPSDimensions(config: Uint8Array): { width: number; height: number } | null {
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
        if (nalType === 7) {
          // Found SPS, parse it
          const spsStart = i + offset + 1;
          return this.decodeSPSDimensions(config.subarray(spsStart));
        }
      }
    }
    return null;
  }

  /**
   * Decode SPS NAL unit to extract dimensions (simplified parser)
   */
  private decodeSPSDimensions(sps: Uint8Array): { width: number; height: number } | null {
    try {
      const reader = new BitReader(sps);

      const profileIdc = reader.readBits(8);
      reader.readBits(8); // constraint_set flags + reserved
      reader.readBits(8); // level_idc

      reader.readUE(); // seq_parameter_set_id

      // High profile has additional fields
      if (profileIdc === 100 || profileIdc === 110 || profileIdc === 122 ||
          profileIdc === 244 || profileIdc === 44 || profileIdc === 83 ||
          profileIdc === 86 || profileIdc === 118 || profileIdc === 128) {
        const chromaFormatIdc = reader.readUE();
        if (chromaFormatIdc === 3) {
          reader.readBits(1); // separate_colour_plane_flag
        }
        reader.readUE(); // bit_depth_luma_minus8
        reader.readUE(); // bit_depth_chroma_minus8
        reader.readBits(1); // qpprime_y_zero_transform_bypass_flag
        const seqScalingMatrixPresent = reader.readBits(1);
        if (seqScalingMatrixPresent) {
          const count = chromaFormatIdc !== 3 ? 8 : 12;
          for (let i = 0; i < count; i++) {
            if (reader.readBits(1)) { // seq_scaling_list_present_flag
              this.skipScalingList(reader, i < 6 ? 16 : 64);
            }
          }
        }
      }

      reader.readUE(); // log2_max_frame_num_minus4
      const picOrderCntType = reader.readUE();
      if (picOrderCntType === 0) {
        reader.readUE(); // log2_max_pic_order_cnt_lsb_minus4
      } else if (picOrderCntType === 1) {
        reader.readBits(1); // delta_pic_order_always_zero_flag
        reader.readSE(); // offset_for_non_ref_pic
        reader.readSE(); // offset_for_top_to_bottom_field
        const numRefFrames = reader.readUE();
        for (let i = 0; i < numRefFrames; i++) {
          reader.readSE(); // offset_for_ref_frame
        }
      }

      reader.readUE(); // max_num_ref_frames
      reader.readBits(1); // gaps_in_frame_num_value_allowed_flag

      const picWidthInMbsMinus1 = reader.readUE();
      const picHeightInMapUnitsMinus1 = reader.readUE();
      const frameMbsOnlyFlag = reader.readBits(1);

      if (!frameMbsOnlyFlag) {
        reader.readBits(1); // mb_adaptive_frame_field_flag
      }

      reader.readBits(1); // direct_8x8_inference_flag

      let cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0;
      const frameCroppingFlag = reader.readBits(1);
      if (frameCroppingFlag) {
        cropLeft = reader.readUE();
        cropRight = reader.readUE();
        cropTop = reader.readUE();
        cropBottom = reader.readUE();
      }

      // Calculate dimensions
      const width = (picWidthInMbsMinus1 + 1) * 16 - (cropLeft + cropRight) * 2;
      const height = (picHeightInMapUnitsMinus1 + 1) * 16 * (2 - frameMbsOnlyFlag) - (cropTop + cropBottom) * 2 * (2 - frameMbsOnlyFlag);

      return { width, height };
    } catch {
      return null;
    }
  }

  private skipScalingList(reader: BitReader, size: number): void {
    let lastScale = 8;
    let nextScale = 8;
    for (let i = 0; i < size; i++) {
      if (nextScale !== 0) {
        const deltaScale = reader.readSE();
        nextScale = (lastScale + deltaScale + 256) % 256;
      }
      lastScale = nextScale === 0 ? lastScale : nextScale;
    }
  }

  /**
   * Extract SPS info (profile, constraint, level) from config data
   */
  private extractSPSInfo(config: Uint8Array): { profile: number; constraint: number; level: number } | null {
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
        if (nalType === 7 && i + offset + 3 < config.length) {
          // SPS found - bytes after NAL header are profile_idc, constraint_set_flags, level_idc
          return {
            profile: config[i + offset + 1],
            constraint: config[i + offset + 2],
            level: config[i + offset + 3]
          };
        }
      }
    }
    return null;
  }

  /**
   * Merge config packet with frame data (like sc_packet_merger_merge)
   */
  private mergeConfigWithFrame(config: Uint8Array, frame: Uint8Array): Uint8Array {
    const merged = new Uint8Array(config.length + frame.length);
    merged.set(config, 0);
    merged.set(frame, config.length);
    return merged;
  }

  /**
   * Enable or disable stats tracking
   */
  setStatsEnabled(enabled: boolean): void {
    this.statsEnabled = enabled;
    if (enabled) {
      this.lastFpsUpdate = performance.now();
      this.frameCount = 0;
    }
  }

  /**
   * Handle decoded video frame
   */
  private handleDecodedFrame(frame: VideoFrame) {
    this.pendingFrames.push(frame);
    this.totalFrames++;

    // Update FPS counter only if stats are enabled
    if (this.statsEnabled && this.onStats) {
      this.frameCount++;
      const now = performance.now();
      if (now - this.lastFpsUpdate >= 1000) {
        this.fps = Math.round(this.frameCount / ((now - this.lastFpsUpdate) / 1000));
        this.onStats(this.fps, this.totalFrames);
        this.frameCount = 0;
        this.lastFpsUpdate = now;
      }
    }

    // Start rendering if not already
    if (!this.isRendering) {
      this.renderLoop();
    }
  }

  /**
   * Rendering loop
   */
  private renderLoop() {
    this.isRendering = true;

    const render = () => {
      if (this.pendingFrames.length === 0) {
        this.isRendering = false;
        return;
      }

      // Get the most recent frame and discard older ones
      while (this.pendingFrames.length > 1) {
        const oldFrame = this.pendingFrames.shift();
        oldFrame?.close();
      }

      const frame = this.pendingFrames.shift();
      if (frame && this.ctx) {
        // Draw frame to canvas
        this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
        frame.close();
      }

      requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
  }

  /**
   * Dispose of resources
   */
  dispose() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
        // Ignore close errors
      }
      this.decoder = null;
    }

    for (const frame of this.pendingFrames) {
      frame.close();
    }
    this.pendingFrames = [];
    this.pendingConfig = null;
  }
}

/**
 * Bit reader for parsing H.264 SPS (Exp-Golomb coded)
 */
class BitReader {
  private data: Uint8Array;
  private byteOffset = 0;
  private bitOffset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  readBits(count: number): number {
    let result = 0;
    for (let i = 0; i < count; i++) {
      if (this.byteOffset >= this.data.length) {
        throw new Error('End of data');
      }
      const bit = (this.data[this.byteOffset] >> (7 - this.bitOffset)) & 1;
      result = (result << 1) | bit;
      this.bitOffset++;
      if (this.bitOffset === 8) {
        this.bitOffset = 0;
        this.byteOffset++;
      }
    }
    return result;
  }

  // Unsigned Exp-Golomb
  readUE(): number {
    let leadingZeros = 0;
    while (this.readBits(1) === 0) {
      leadingZeros++;
      if (leadingZeros > 31) throw new Error('Invalid UE');
    }
    if (leadingZeros === 0) return 0;
    return (1 << leadingZeros) - 1 + this.readBits(leadingZeros);
  }

  // Signed Exp-Golomb
  readSE(): number {
    const value = this.readUE();
    if (value === 0) return 0;
    const sign = (value & 1) ? 1 : -1;
    return sign * Math.ceil(value / 2);
  }
}
