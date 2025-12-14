import { OpusDecoder } from 'opus-decoder';

/**
 * Opus audio decoder and player using opus-decoder library
 *
 * Uses WebAssembly-based Opus decoder for compatibility with VS Code webviews
 * which don't support WebCodecs Opus decoding.
 */
export class AudioRenderer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private decoder: any = null;
  private audioContext: AudioContext | null = null;
  private nextPlayTime = 0;
  private isPaused = false;
  private isMuted = false;
  private isInitialized = false;
  private isReady = false;
  private resumePending = false;

  // Opus audio parameters (scrcpy uses 48kHz stereo)
  private readonly SAMPLE_RATE = 48000;
  private readonly CHANNELS = 2;

  constructor() {}

  /**
   * Set up user gesture listeners to resume AudioContext
   * Called once when AudioContext is created in suspended state
   */
  private setupUserGestureResume(): void {
    if (this.resumePending) {
      return;
    }
    this.resumePending = true;

    const resumeAudio = () => {
      if (this.audioContext?.state === 'suspended') {
        this.audioContext.resume();
      }
      this.resumePending = false;
      document.removeEventListener('click', resumeAudio);
      document.removeEventListener('keydown', resumeAudio);
      document.removeEventListener('pointerdown', resumeAudio);
    };

    document.addEventListener('click', resumeAudio, { once: true });
    document.addEventListener('keydown', resumeAudio, { once: true });
    document.addEventListener('pointerdown', resumeAudio, { once: true });
  }

  /**
   * Initialize audio context and decoder
   * Called when first audio config is received
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;

    // Create AudioContext (may be suspended due to autoplay policy)
    this.audioContext = new AudioContext({ sampleRate: this.SAMPLE_RATE });

    if (this.audioContext.state === 'suspended') {
      console.log('AudioContext created in suspended state, waiting for user gesture');
      this.setupUserGestureResume();
    }

    // Create Opus decoder
    try {
      this.decoder = new OpusDecoder({
        sampleRate: this.SAMPLE_RATE,
        channels: this.CHANNELS,
      });

      await this.decoder.ready;
      this.isReady = true;
      console.log(
        `AudioRenderer initialized: opus-decoder, ${this.SAMPLE_RATE}Hz, ${this.CHANNELS} channels`
      );
    } catch (error) {
      console.error('Failed to initialize Opus decoder:', error);
      this.decoder = null;
    }
  }

  /**
   * Push encoded audio frame data
   */
  pushFrame(data: Uint8Array, isConfig: boolean): void {
    // Skip config packets - opus-decoder doesn't need them
    if (isConfig) {
      return;
    }

    // Wait for decoder to be ready
    if (!this.decoder || !this.isReady) {
      return;
    }

    // Drop frames when paused or muted
    if (this.isPaused || this.isMuted) {
      return;
    }

    try {
      // Decode the Opus frame
      const result = this.decoder.decodeFrame(data);

      if (result.samplesDecoded > 0 && result.channelData.length > 0) {
        this.playAudio(result.channelData, result.samplesDecoded, result.sampleRate);
      }

      // Log any decode errors (but continue playing)
      if (result.errors && result.errors.length > 0) {
        console.warn('Opus decode errors:', result.errors);
      }
    } catch (error) {
      console.error('Failed to decode audio frame:', error);
    }
  }

  /**
   * Play decoded audio data
   */
  private playAudio(channelData: Float32Array[], samplesDecoded: number, sampleRate: number): void {
    if (!this.audioContext || this.isPaused || this.isMuted) {
      return;
    }

    // Drop frames if AudioContext is suspended (waiting for user gesture)
    if (this.audioContext.state === 'suspended') {
      if (!this.resumePending) {
        this.setupUserGestureResume();
      }
      return;
    }

    try {
      // Create AudioBuffer from decoded data
      const audioBuffer = this.audioContext.createBuffer(
        channelData.length,
        samplesDecoded,
        sampleRate
      );

      // Copy channel data to buffer
      for (let channel = 0; channel < channelData.length; channel++) {
        const data = new Float32Array(channelData[channel]);
        audioBuffer.copyToChannel(data, channel);
      }

      // Schedule playback
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      // Calculate when to play this buffer for continuous playback
      const now = this.audioContext.currentTime;
      if (this.nextPlayTime < now) {
        // Catch up if we've fallen behind
        this.nextPlayTime = now;
      }

      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
    } catch (error) {
      console.error('Failed to play audio:', error);
    }
  }

  /**
   * Pause audio playback (for inactive tabs)
   */
  pause(): void {
    this.isPaused = true;
    this.nextPlayTime = 0;
  }

  /**
   * Resume audio playback
   */
  resume(): void {
    this.isPaused = false;
    this.nextPlayTime = 0;
  }

  /**
   * Set mute state
   */
  setMuted(muted: boolean): void {
    this.isMuted = muted;
    // Reset playback timing on both mute and unmute for clean state
    this.nextPlayTime = 0;

    // Resume AudioContext on unmute (user gesture)
    if (!muted && this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
      this.resumePending = false;
    }
  }

  /**
   * Get current mute state
   */
  getMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.decoder) {
      try {
        this.decoder.free();
      } catch {
        // Ignore free errors
      }
      this.decoder = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {
        // Ignore close errors
      });
      this.audioContext = null;
    }

    this.isReady = false;
    this.isInitialized = false;
  }
}
