import { CodecUtils, VideoCodec } from './CodecUtils';

/**
 * Extended stats returned by VideoRenderer
 */
export interface ExtendedStats {
  fps: number;
  bitrate: number; // bits per second
  framesDropped: number;
}

/**
 * Video decoder and renderer using WebCodecs API
 *
 * Supports H.264, H.265 (HEVC), and AV1 codecs.
 * Follows the same approach as scrcpy client:
 * - Config packets (SPS/PPS/VPS) are merged with the next keyframe
 * - Data is passed in Annex B format (start code prefixed) for H.264/H.265
 * - AV1 uses OBU format
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
  private lastConfig: Uint8Array | null = null;
  private codecConfigured = false;
  private needsKeyframe = true; // After configure(), decoder needs a keyframe first
  private isPaused = false;
  private resizeObserver: ResizeObserver | null = null;
  private codec: VideoCodec = 'h264'; // Default to H.264
  private codecDetected = false;

  // Backpressure thresholds (WebCodecs decodeQueueSize)
  private static readonly DROP_QUEUE_THRESHOLD = 12;
  private static readonly RESET_QUEUE_THRESHOLD = 48;
  private static readonly RESET_COOLDOWN_MS = 500;
  private lastBackpressureReset = 0;

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
   * Reset decoder state to recover from severe backlog.
   * Keeps the last known config so we can reconfigure on the next keyframe.
   */
  private resetDecoderForBackpressure(): void {
    // Clear decoded frames immediately to free memory
    for (const frame of this.pendingFrames) {
      frame.close();
    }
    this.pendingFrames = [];
    this.isRendering = false;

    // Recreate decoder to drop any queued decode work
    this.createDecoder();

    // Re-seed config so the next keyframe can configure + decode
    if (this.lastConfig) {
      this.pendingConfig = this.lastConfig;
    }
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
      // Store config packet (SPS/PPS/VPS) to prepend to next keyframe
      // This matches sc_packet_merger behavior in scrcpy
      // Only store if data is not empty (dimensions-only messages have empty data)
      if (data.length > 0) {
        this.pendingConfig = data;
        this.lastConfig = data;
      }

      // Detect codec from config packet if not already detected
      if (!this.codecDetected) {
        const detectedCodec = CodecUtils.detectCodec(data);
        if (detectedCodec) {
          this.codec = detectedCodec;
          this.codecDetected = true;
          console.log(`Detected video codec: ${this.codec}`);
        }
      }

      // Parse config for dimensions (rotation sends new config with new dimensions)
      // For H.264, we can parse SPS. For H.265/AV1, we rely on the metadata from scrcpy
      const dims = CodecUtils.parseConfigDimensions(data, this.codec);
      if (dims && (dims.width !== this.width || dims.height !== this.height)) {
        this.configure(dims.width, dims.height);
        this.onDimensionsChanged?.(dims.width, dims.height);
      }
      return;
    }

    // Check if this is a keyframe by looking at NAL type
    const isKey = isKeyFrame ?? this.containsKeyFrame(data);

    // Backpressure: stop feeding the decoder if it is falling behind.
    // If the queue is severely backed up, recreate the decoder to drop stale work and wait for a keyframe.
    if (
      this.codecConfigured &&
      this.decoder.decodeQueueSize > VideoRenderer.RESET_QUEUE_THRESHOLD
    ) {
      const now = performance.now();
      if (now - this.lastBackpressureReset > VideoRenderer.RESET_COOLDOWN_MS && this.lastConfig) {
        this.lastBackpressureReset = now;
        this.resetDecoderForBackpressure();
      }

      // After a reset (or if we can't reset), drop delta frames and wait for a keyframe.
      if (!isKey) {
        this.framesDropped++;
        return;
      }
    } else if (
      this.codecConfigured &&
      !isKey &&
      this.decoder.decodeQueueSize > VideoRenderer.DROP_QUEUE_THRESHOLD
    ) {
      // Moderate backlog: drop delta frames to avoid unbounded memory/latency growth.
      this.framesDropped++;
      return;
    }

    // Configure codec on first keyframe with config
    if (!this.codecConfigured && isKey && (this.pendingConfig || this.lastConfig)) {
      // If we lost the pending config (e.g. after backlog recovery), fall back to the last known config.
      if (!this.pendingConfig && this.lastConfig) {
        this.pendingConfig = this.lastConfig;
      }
      this.configureCodec();
      // For AV1, config is in description, don't merge with frame
      // For H.264/H.265, merge config with frame data
      const frameData =
        this.codec === 'av1' ? data : this.mergeConfigWithFrame(this.pendingConfig!, data);
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
   * Check if data contains a keyframe (IDR frame)
   * Uses codec-specific detection
   */
  private containsKeyFrame(data: Uint8Array): boolean {
    return CodecUtils.containsKeyFrame(data, this.codec);
  }

  /**
   * Configure the WebCodecs decoder
   * Uses Annex B format for H.264/H.265, OBU format for AV1
   */
  private configureCodec() {
    if (!this.decoder || !this.pendingConfig) {
      return;
    }

    try {
      // Generate codec string based on detected codec
      const codecString = CodecUtils.generateCodecString(
        this.codec,
        this.pendingConfig,
        this.width,
        this.height
      );

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
      console.error(
        'If you see this error with H.265 or AV1, your browser may not support this codec. Try H.264 instead.'
      );
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
   * Ensure the canvas matches the decoded frame dimensions.
   *
   * Some codecs/browsers may not reliably surface rotation/resolution changes via config parsing.
   * In those cases, we fall back to the decoded frame's display size to keep aspect ratio correct.
   */
  private updateCanvasDimensionsFromFrame(frame: VideoFrame): void {
    const frameWidth = frame.displayWidth || frame.codedWidth;
    const frameHeight = frame.displayHeight || frame.codedHeight;

    if (frameWidth <= 0 || frameHeight <= 0) {
      return;
    }

    if (frameWidth === this.width && frameHeight === this.height) {
      return;
    }

    console.log(
      `Video dimensions changed from ${this.width}x${this.height} to ${frameWidth}x${frameHeight}`
    );

    this.width = frameWidth;
    this.height = frameHeight;

    // Resize drawing buffer (clears canvas + resets context state)
    this.canvas.width = frameWidth;
    this.canvas.height = frameHeight;
    this.fitToContainer();
    this.ctx = this.canvas.getContext('2d');

    // Drop any queued frames from the previous size to avoid stretched renders.
    for (const pending of this.pendingFrames) {
      pending.close();
    }
    this.pendingFrames = [];

    this.onDimensionsChanged?.(frameWidth, frameHeight);
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

    this.updateCanvasDimensionsFromFrame(frame);
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
