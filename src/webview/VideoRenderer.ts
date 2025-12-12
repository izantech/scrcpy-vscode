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
  private onStats: (fps: number, frames: number) => void;

  private width = 0;
  private height = 0;
  private frameCount = 0;
  private lastFpsUpdate = 0;
  private fps = 0;
  private pendingFrames: VideoFrame[] = [];
  private isRendering = false;

  // Config packet storage (like sc_packet_merger in scrcpy)
  private pendingConfig: Uint8Array | null = null;
  private codecConfigured = false;
  private isPaused = false;

  constructor(
    canvas: HTMLCanvasElement,
    onStats: (fps: number, frames: number) => void
  ) {
    this.canvas = canvas;
    this.onStats = onStats;

    // Check WebCodecs support
    if (typeof VideoDecoder === 'undefined') {
      console.error('WebCodecs API not supported');
      return;
    }
  }

  /**
   * Configure renderer with video dimensions
   */
  configure(width: number, height: number) {
    this.width = width;
    this.height = height;

    // Set canvas size
    this.canvas.width = width;
    this.canvas.height = height;

    // Get 2D context for rendering
    this.ctx = this.canvas.getContext('2d');

    // Clear any pending frames before creating new decoder
    for (const frame of this.pendingFrames) {
      frame.close();
    }
    this.pendingFrames = [];
    this.pendingConfig = null;

    // Reset FPS tracking
    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();

    // Create decoder
    this.createDecoder();

    console.log(`Video configured: ${width}x${height}`);
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
      console.log('Stored config packet:', data.length, 'bytes');
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
   * Handle decoded video frame
   */
  private handleDecodedFrame(frame: VideoFrame) {
    this.pendingFrames.push(frame);
    this.frameCount++;

    // Update FPS counter
    const now = performance.now();
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = Math.round(this.frameCount / ((now - this.lastFpsUpdate) / 1000));
      this.onStats(this.fps, this.frameCount);
      this.frameCount = 0;
      this.lastFpsUpdate = now;
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
