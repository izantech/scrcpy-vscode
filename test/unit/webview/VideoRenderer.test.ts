/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VideoRenderer } from '../../../src/webview/VideoRenderer';

describe('VideoRenderer', () => {
  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let renderer: VideoRenderer | null = null;

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
        constructor(_callback: ResizeObserverCallback) {}
      }
    );

    container = document.createElement('div');
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
    document.body.appendChild(container);

    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    vi.spyOn(canvas, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    renderer?.dispose();
    renderer = null;
    document.body.removeChild(container);
    vi.unstubAllGlobals();
  });

  it('updates canvas size from decoded frame display dimensions (landscape rotation)', () => {
    const onDimensionsChanged = vi.fn();
    renderer = new VideoRenderer(canvas, null, onDimensionsChanged);
    const privateRenderer = renderer as unknown as {
      width: number;
      height: number;
      pendingFrames: VideoFrame[];
      isRendering: boolean;
      handleDecodedFrame: (frame: VideoFrame) => void;
    };

    // Start in portrait (typical initial metadata/SPS)
    privateRenderer.width = 1080;
    privateRenderer.height = 1920;
    canvas.width = 1080;
    canvas.height = 1920;

    // Seed with a queued frame from the previous size to ensure it gets dropped
    const oldFrameClose = vi.fn();
    privateRenderer.pendingFrames = [{ close: oldFrameClose } as unknown as VideoFrame];

    // Prevent renderLoop from running (we only care about dimension updates here)
    privateRenderer.isRendering = true;

    // Simulate a decoded frame that reports landscape display size despite portrait coded size
    const decodedFrame = {
      displayWidth: 1920,
      displayHeight: 1080,
      codedWidth: 1080,
      codedHeight: 1920,
      close: vi.fn(),
    } as unknown as VideoFrame;

    privateRenderer.handleDecodedFrame(decodedFrame);

    expect(onDimensionsChanged).toHaveBeenCalledTimes(1);
    expect(onDimensionsChanged).toHaveBeenCalledWith(1920, 1080);

    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);

    // Aspect ratio should now reflect landscape (1920/1080), fitting within 800x600
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('450px');

    expect(oldFrameClose).toHaveBeenCalledTimes(1);
  });
});
