import { H264Utils, NALUnitType } from './H264Utils';

/**
 * Extended stats returned by VideoRenderer
 */
export interface ExtendedStats {
  fps: number;
  bitrate: number; // bits per second
  framesDropped: number;
}

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
  private needsKeyframe = true; // After configure(), decoder needs a keyframe first
  private isPaused = false;
  private resizeObserver: ResizeObserver | null = null;

  // Extended stats tracking
  private bytesReceived = 0;
  private framesDropped = 0;
  private lastBitrateUpdate = 0;
  private bytesReceivedInInterval = 0;

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
    // Skip if dimensions unchanged (avoids clearing canvas content)
    if (this.width === width && this.height === height && this.decoder) {
      return;
    }

    this.width = width;
    this.height = height;

    // Set canvas size (drawing buffer) - this clears the canvas
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
   * Set video codec (called when codec info is received from backend)
   * This overrides auto-detection which may fail for some codecs
   */
  setCodec(codec: VideoCodec) {
    if (this.codec !== codec) {
      console.log(`Setting video codec to: ${codec}`);
      this.codec = codec;
      this.codecDetected = true;
    }
  }

  /**
   * Fit canvas to container while maintaining aspect ratio
   */
  private fitToContainer() {
    if (this.width === 0 || this.height === 0) {
      return;
    }

    const container = this.canvas.parentElement;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

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
      error: (error) => console.error('Decoder error:', error),
    });

    this.codecConfigured = false;
    this.needsKeyframe = true;
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
  pushFrame(data: Uint8Array, isConfig: boolean, isKeyFrame?: boolean) {
    if (!this.decoder || !this.ctx) {
      return;
    }

    // Track bytes received for bitrate calculation
    if (this.statsEnabled) {
      this.bytesReceived += data.length;
      this.bytesReceivedInInterval += data.length;
    }

    if (isConfig) {
      // Store config packet (SPS/PPS) to prepend to next keyframe
      // This matches sc_packet_merger behavior in scrcpy
      // Only store if data is not empty (dimensions-only messages have empty data)
      if (data.length > 0) {
        this.pendingConfig = data;
      }

      // Parse SPS for dimensions (rotation sends new SPS with new dimensions)
      const dims = H264Utils.parseSPSDimensions(data);
      if (dims && (dims.width !== this.width || dims.height !== this.height)) {
        this.configure(dims.width, dims.height);
        this.onDimensionsChanged?.(dims.width, dims.height);
      }
      return;
    }

    // Check if this is a keyframe by looking at NAL type
    const isKey = isKeyFrame ?? this.containsKeyFrame(data);

    // Configure codec on first keyframe with config
    if (!this.codecConfigured && isKey && this.pendingConfig) {
      this.configureCodec();
      // For AV1, config is in description, don't merge with frame
      // For H.264/H.265, merge config with frame data
      const frameData =
        this.codec === 'av1' ? data : this.mergeConfigWithFrame(this.pendingConfig, data);
      this.pendingConfig = null;
      // Decode the keyframe on next tick to ensure configure() completes
      queueMicrotask(() => {
        try {
          const chunk = new EncodedVideoChunk({
            type: 'key',
            timestamp: performance.now() * 1000,
            data: frameData,
          });
          this.decoder?.decode(chunk);
          this.needsKeyframe = false;
        } catch (error) {
          console.error('Failed to decode initial keyframe:', error);
        }
      });
      return;
    }

    if (!this.codecConfigured) {
      // Can't decode without codec configuration
      return;
    }

    // After configure(), decoder requires a keyframe first
    // Skip delta frames until we get a keyframe
    if (this.needsKeyframe && !isKey) {
      return;
    }

    try {
      // Merge config with keyframe (like sc_packet_merger_merge)
      // For AV1, config is in description, so don't merge
      let frameData = data;
      if (isKey && this.pendingConfig && this.codec !== 'av1') {
        frameData = this.mergeConfigWithFrame(this.pendingConfig, data);
        this.pendingConfig = null;
      }

      // Track frame drops based on decode queue size
      if (this.statsEnabled && this.decoder.decodeQueueSize > 10) {
        this.framesDropped++;
      }

      const chunk = new EncodedVideoChunk({
        type: isKey ? 'key' : 'delta',
        timestamp: performance.now() * 1000, // microseconds
        data: frameData,
      });

      this.decoder.decode(chunk);

      // After successfully decoding a keyframe, we can accept delta frames
      if (isKey) {
        this.needsKeyframe = false;
      }
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
      if (
        (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) ||
        (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1)
      ) {
        const offset = data[i + 2] === 1 ? 3 : 4;
        const nalType = data[i + offset] & 0x1f;
        if (nalType === NALUnitType.IDR) {
          // IDR
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
      const spsInfo = H264Utils.extractSPSInfo(this.pendingConfig);

      const codecString = spsInfo
        ? `avc1.${spsInfo.profile.toString(16).padStart(2, '0')}${spsInfo.constraint.toString(16).padStart(2, '0')}${spsInfo.level.toString(16).padStart(2, '0')}`
        : 'avc1.42001f'; // Default to baseline profile level 3.1

      console.log(`Configuring codec: ${codecString}, ${this.width}x${this.height}`);

      // Check if codec is supported
      if (typeof VideoDecoder.isConfigSupported === 'function') {
        VideoDecoder.isConfigSupported({
          codec: codecString,
          codedWidth: this.width,
          codedHeight: this.height,
        }).then(
          (result) => {
            if (!result.supported) {
              console.error(`Codec ${codecString} is not supported by this browser`);
              console.error(
                `Browser support: H.264 (widely supported), H.265 (Safari, some Chrome), AV1 (modern browsers)`
              );
            }
          },
          (err) => console.warn('Could not check codec support:', err)
        );
      }

      // Configure decoder
      // For AV1, include the sequence header in description
      // For H.264/H.265, use Annex B format (no description needed)
      const config: VideoDecoderConfig = {
        codec: codecString,
        codedWidth: this.width,
        codedHeight: this.height,
      };

      // For AV1, add the sequence header as description
      if (this.codec === 'av1' && this.pendingConfig) {
        config.description = this.pendingConfig;
      }

      this.decoder.configure(config);

      this.codecConfigured = true;
      this.needsKeyframe = true; // Decoder needs keyframe after configure()
      console.log(`Codec configured successfully: ${this.codec}`);
    } catch (error) {
      console.error('Failed to configure codec:', error);
    }
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
      this.lastBitrateUpdate = performance.now();
      this.frameCount = 0;
      this.bytesReceivedInInterval = 0;
    }
  }

  /**
   * Get extended statistics (FPS, bitrate, frame drops)
   */
  getExtendedStats(): ExtendedStats {
    // Calculate bitrate (bits per second)
    const now = performance.now();
    const timeElapsed = (now - this.lastBitrateUpdate) / 1000; // seconds
    let bitrate = 0;
    if (timeElapsed > 0) {
      bitrate = (this.bytesReceivedInInterval * 8) / timeElapsed; // bits per second
    }

    return {
      fps: this.fps,
      bitrate,
      framesDropped: this.framesDropped,
    };
  }

  /**
   * Handle decoded video frame
   */
  private handleDecodedFrame(frame: VideoFrame) {
    this.totalFrames++;

    if (this.isPaused) {
      frame.close();
      return;
    }

    this.pendingFrames.push(frame);

    // Update FPS counter only if stats are enabled
    if (this.statsEnabled && this.onStats) {
      this.frameCount++;
      const now = performance.now();
      if (now - this.lastFpsUpdate >= 1000) {
        this.fps = Math.round(this.frameCount / ((now - this.lastFpsUpdate) / 1000));
        this.onStats(this.fps, this.totalFrames);
        this.frameCount = 0;
        this.lastFpsUpdate = now;

        // Reset bitrate interval tracking
        this.bytesReceivedInInterval = 0;
        this.lastBitrateUpdate = now;
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
