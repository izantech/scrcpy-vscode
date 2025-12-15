/**
 * Screen recording manager using MediaRecorder API
 *
 * Records the canvas output to a video file (WebM or MP4).
 * Uses canvas.captureStream() to get the MediaStream from the canvas.
 */
export class RecordingManager {
  private canvas: HTMLCanvasElement;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording = false;
  private stream: MediaStream | null = null;
  private startTime = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  private onRecordingStateChange: ((isRecording: boolean, duration: number) => void) | null;
  private onRecordingComplete: ((blob: Blob, duration: number) => void) | null;

  constructor(
    canvas: HTMLCanvasElement,
    onRecordingStateChange?: (isRecording: boolean, duration: number) => void,
    onRecordingComplete?: (blob: Blob, duration: number) => void
  ) {
    this.canvas = canvas;
    this.onRecordingStateChange = onRecordingStateChange ?? null;
    this.onRecordingComplete = onRecordingComplete ?? null;
  }

  /**
   * Start recording the canvas output
   */
  startRecording(format: 'webm' | 'mp4' = 'webm'): boolean {
    if (this.isRecording) {
      console.warn('Recording already in progress');
      return false;
    }

    // Check if canvas has content (dimensions > 0)
    if (this.canvas.width === 0 || this.canvas.height === 0) {
      console.error('Cannot record: canvas has no content');
      return false;
    }

    try {
      // Capture stream from canvas
      // Use 60fps for smooth recording
      this.stream = this.canvas.captureStream(60);

      if (!this.stream) {
        console.error('Failed to capture stream from canvas');
        return false;
      }

      // Determine MIME type based on format
      let mimeType = 'video/webm;codecs=vp8';
      if (format === 'mp4') {
        // Note: MP4 support varies by browser
        // Chrome/Edge support webm better than mp4 in canvas recording
        mimeType = 'video/mp4';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          console.warn('MP4 not supported, falling back to WebM');
          mimeType = 'video/webm;codecs=vp8';
        }
      }

      // Check if the MIME type is supported
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        console.error(`MIME type ${mimeType} not supported`);
        return false;
      }

      // Create MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        videoBitsPerSecond: 2500000, // 2.5 Mbps for good quality
      });

      this.recordedChunks = [];

      // Handle data available
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      // Handle recording stop
      this.mediaRecorder.onstop = () => {
        const duration = (Date.now() - this.startTime) / 1000;

        // Create blob from recorded chunks
        const blob = new Blob(this.recordedChunks, {
          type: mimeType,
        });

        // Clear chunks
        this.recordedChunks = [];

        // Notify completion
        if (this.onRecordingComplete) {
          this.onRecordingComplete(blob, duration);
        }

        // Cleanup
        this.cleanup();
      };

      // Start recording
      this.mediaRecorder.start(100); // Collect data every 100ms
      this.isRecording = true;
      this.startTime = Date.now();

      // Start timer for UI updates
      this.startTimer();

      // Notify state change
      if (this.onRecordingStateChange) {
        this.onRecordingStateChange(true, 0);
      }

      console.log(`Recording started (${mimeType})`);
      return true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.cleanup();
      return false;
    }
  }

  /**
   * Stop recording
   */
  stopRecording(): void {
    if (!this.isRecording || !this.mediaRecorder) {
      return;
    }

    try {
      // Stop the media recorder (will trigger onstop callback)
      this.mediaRecorder.stop();
      this.isRecording = false;

      // Stop timer
      this.stopTimer();

      console.log('Recording stopped');
    } catch (error) {
      console.error('Failed to stop recording:', error);
      this.cleanup();
    }
  }

  /**
   * Toggle recording on/off
   */
  toggleRecording(format: 'webm' | 'mp4' = 'webm'): boolean {
    if (this.isRecording) {
      this.stopRecording();
      return false;
    } else {
      return this.startRecording(format);
    }
  }

  /**
   * Check if currently recording
   */
  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Get current recording duration in seconds
   */
  getRecordingDuration(): number {
    if (!this.isRecording) {
      return 0;
    }
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Start timer for UI updates
   */
  private startTimer(): void {
    // Update every second
    this.timerInterval = setInterval(() => {
      if (this.isRecording && this.onRecordingStateChange) {
        const duration = this.getRecordingDuration();
        this.onRecordingStateChange(true, duration);
      }
    }, 1000);
  }

  /**
   * Stop timer
   */
  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.stopTimer();

    if (this.stream) {
      // Stop all tracks in the stream
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.mediaRecorder = null;
    this.isRecording = false;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.isRecording) {
      this.stopRecording();
    }
    this.cleanup();
  }
}
