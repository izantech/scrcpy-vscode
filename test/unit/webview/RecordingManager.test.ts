/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RecordingManager } from '../../../src/webview/RecordingManager';

// Mock MediaRecorder
class MockMediaRecorder {
  static isTypeSupported = vi.fn((type: string) => {
    return type.startsWith('video/webm') || type === 'video/mp4';
  });

  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start = vi.fn(() => {
    this.state = 'recording';
  });

  stop = vi.fn(() => {
    this.state = 'inactive';
    // Simulate data available
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['test'], { type: 'video/webm' }) });
    }
    // Simulate stop callback
    if (this.onstop) {
      this.onstop();
    }
  });
}

// Mock MediaStream
class MockMediaStream {
  getTracks = vi.fn(() => [
    {
      stop: vi.fn(),
    },
  ]);
}

describe('RecordingManager', () => {
  let canvas: HTMLCanvasElement;
  let onRecordingStateChange: ReturnType<typeof vi.fn>;
  let onRecordingComplete: ReturnType<typeof vi.fn>;
  let manager: RecordingManager;

  beforeEach(() => {
    // Setup canvas
    canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);

    // Mock captureStream on canvas
    vi.spyOn(canvas, 'captureStream').mockReturnValue(
      new MockMediaStream() as unknown as MediaStream
    );

    // Mock global MediaRecorder
    vi.stubGlobal('MediaRecorder', MockMediaRecorder);

    onRecordingStateChange = vi.fn();
    onRecordingComplete = vi.fn();
    manager = new RecordingManager(canvas, onRecordingStateChange, onRecordingComplete);
  });

  afterEach(() => {
    manager.dispose();
    document.body.removeChild(canvas);
    vi.unstubAllGlobals();
    vi.clearAllTimers();
  });

  describe('startRecording', () => {
    it('should return true when recording starts successfully', () => {
      const result = manager.startRecording();
      expect(result).toBe(true);
    });

    it('should call onRecordingStateChange with true when starting', () => {
      manager.startRecording();
      expect(onRecordingStateChange).toHaveBeenCalledWith(true, 0);
    });

    it('should return false when already recording', () => {
      manager.startRecording();
      const result = manager.startRecording();
      expect(result).toBe(false);
    });

    it('should return false when canvas has no content (0 dimensions)', () => {
      canvas.width = 0;
      canvas.height = 0;
      const result = manager.startRecording();
      expect(result).toBe(false);
    });

    it('should capture stream from canvas at 60fps', () => {
      manager.startRecording();
      expect(canvas.captureStream).toHaveBeenCalledWith(60);
    });

    it('should use webm format by default', () => {
      manager.startRecording();
      expect(MockMediaRecorder.isTypeSupported).toHaveBeenCalledWith('video/webm;codecs=vp8');
    });

    it('should try mp4 format when specified', () => {
      manager.startRecording('mp4');
      expect(MockMediaRecorder.isTypeSupported).toHaveBeenCalledWith('video/mp4');
    });

    it('should fall back to webm if mp4 is not supported', () => {
      MockMediaRecorder.isTypeSupported.mockImplementation((type: string) => {
        return type.startsWith('video/webm');
      });
      manager.startRecording('mp4');
      // Should still succeed by falling back to webm
      expect(manager.isCurrentlyRecording()).toBe(true);
    });
  });

  describe('stopRecording', () => {
    it('should stop recording and call onRecordingComplete', () => {
      manager.startRecording();
      manager.stopRecording();

      expect(onRecordingComplete).toHaveBeenCalledWith(expect.any(Blob), expect.any(Number));
    });

    it('should do nothing if not currently recording', () => {
      manager.stopRecording();
      expect(onRecordingComplete).not.toHaveBeenCalled();
    });

    it('should set isCurrentlyRecording to false after stop', () => {
      manager.startRecording();
      expect(manager.isCurrentlyRecording()).toBe(true);
      manager.stopRecording();
      expect(manager.isCurrentlyRecording()).toBe(false);
    });
  });

  describe('toggleRecording', () => {
    it('should start recording when not recording', () => {
      const result = manager.toggleRecording();
      expect(result).toBe(true);
      expect(manager.isCurrentlyRecording()).toBe(true);
    });

    it('should stop recording when currently recording', () => {
      manager.startRecording();
      const result = manager.toggleRecording();
      expect(result).toBe(false);
      expect(manager.isCurrentlyRecording()).toBe(false);
    });
  });

  describe('isCurrentlyRecording', () => {
    it('should return false initially', () => {
      expect(manager.isCurrentlyRecording()).toBe(false);
    });

    it('should return true when recording', () => {
      manager.startRecording();
      expect(manager.isCurrentlyRecording()).toBe(true);
    });

    it('should return false after stopping', () => {
      manager.startRecording();
      manager.stopRecording();
      expect(manager.isCurrentlyRecording()).toBe(false);
    });
  });

  describe('getRecordingDuration', () => {
    it('should return 0 when not recording', () => {
      expect(manager.getRecordingDuration()).toBe(0);
    });

    it('should return positive duration when recording', () => {
      vi.useFakeTimers();
      manager.startRecording();

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      const duration = manager.getRecordingDuration();
      expect(duration).toBeGreaterThanOrEqual(5);

      vi.useRealTimers();
    });
  });

  describe('timer updates', () => {
    it('should call onRecordingStateChange periodically during recording', () => {
      vi.useFakeTimers();
      manager.startRecording();

      onRecordingStateChange.mockClear();

      // Advance time by 3 seconds
      vi.advanceTimersByTime(3000);

      // Should have called onRecordingStateChange at least once per second
      expect(onRecordingStateChange).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('dispose', () => {
    it('should stop recording if currently recording', () => {
      manager.startRecording();
      manager.dispose();
      expect(manager.isCurrentlyRecording()).toBe(false);
    });

    it('should clean up resources', () => {
      // Create a stable track reference that persists across getTracks() calls
      const mockTrack = { stop: vi.fn() };
      const mockStream = {
        getTracks: vi.fn(() => [mockTrack]),
      };
      vi.spyOn(canvas, 'captureStream').mockReturnValue(mockStream as unknown as MediaStream);

      manager.startRecording();
      manager.dispose();

      // Should have stopped tracks
      expect(mockTrack.stop).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return false when captureStream fails', () => {
      vi.spyOn(canvas, 'captureStream').mockReturnValue(null as unknown as MediaStream);
      const result = manager.startRecording();
      expect(result).toBe(false);
    });

    it('should return false when MIME type is not supported', () => {
      MockMediaRecorder.isTypeSupported.mockReturnValue(false);
      const result = manager.startRecording();
      expect(result).toBe(false);
    });
  });
});
