/**
 * Type for touch event action
 */
type TouchAction = 'down' | 'move' | 'up';

/**
 * Callback for input events
 */
type InputCallback = (x: number, y: number, action: TouchAction) => void;

/**
 * Handles touch/mouse input on the canvas and forwards to extension
 */
export class InputHandler {
  private canvas: HTMLCanvasElement;
  private onInput: InputCallback;
  private isPointerDown = false;
  private pointerId: number | null = null;

  // Throttling for move events
  private lastMoveTime = 0;
  private moveThrottleMs = 16; // ~60fps

  // Bound event handlers for cleanup
  private boundHandlers: Map<string, (e: PointerEvent | Event) => void> = new Map();

  constructor(canvas: HTMLCanvasElement, onInput: InputCallback) {
    this.canvas = canvas;
    this.onInput = onInput;

    this.attachEventListeners();
  }

  /**
   * Attach event listeners to canvas
   */
  private attachEventListeners() {
    // Use pointer events for unified mouse/touch handling
    // Wrap in arrow functions to handle Event type correctly
    const onPointerDown = (e: Event) => this.onPointerDown(e as PointerEvent);
    const onPointerMove = (e: Event) => this.onPointerMove(e as PointerEvent);
    const onPointerUp = (e: Event) => this.onPointerUp(e as PointerEvent);
    const onContextMenu = (e: Event) => e.preventDefault();

    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.canvas.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('pointerup', onPointerUp);
    this.canvas.addEventListener('pointercancel', onPointerUp);
    this.canvas.addEventListener('pointerleave', onPointerUp);
    this.canvas.addEventListener('contextmenu', onContextMenu);

    // Store for cleanup
    this.boundHandlers.set('pointerdown', onPointerDown);
    this.boundHandlers.set('pointermove', onPointerMove);
    this.boundHandlers.set('pointerup', onPointerUp);
    this.boundHandlers.set('pointercancel', onPointerUp);
    this.boundHandlers.set('pointerleave', onPointerUp);
    this.boundHandlers.set('contextmenu', onContextMenu);

    // Prevent default touch behavior
    this.canvas.style.touchAction = 'none';
  }

  /**
   * Handle pointer down event
   */
  private onPointerDown(event: PointerEvent) {
    event.preventDefault();

    // Only track first pointer
    if (this.isPointerDown) {
      return;
    }

    this.isPointerDown = true;
    this.pointerId = event.pointerId;

    // Capture pointer for drag tracking
    this.canvas.setPointerCapture(event.pointerId);

    const coords = this.getNormalizedCoords(event);
    this.onInput(coords.x, coords.y, 'down');
  }

  /**
   * Handle pointer move event
   */
  private onPointerMove(event: PointerEvent) {
    event.preventDefault();

    // Only track if pointer is down and matches our tracked pointer
    if (!this.isPointerDown || event.pointerId !== this.pointerId) {
      return;
    }

    // Throttle move events
    const now = performance.now();
    if (now - this.lastMoveTime < this.moveThrottleMs) {
      return;
    }
    this.lastMoveTime = now;

    const coords = this.getNormalizedCoords(event);
    this.onInput(coords.x, coords.y, 'move');
  }

  /**
   * Handle pointer up event
   */
  private onPointerUp(event: PointerEvent) {
    event.preventDefault();

    // Only handle our tracked pointer
    if (!this.isPointerDown || (event.pointerId !== this.pointerId && event.type !== 'pointerleave')) {
      return;
    }

    // Release pointer capture
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore errors from releasing capture
    }

    this.isPointerDown = false;
    this.pointerId = null;

    const coords = this.getNormalizedCoords(event);
    this.onInput(coords.x, coords.y, 'up');
  }

  /**
   * Get normalized coordinates (0-1) from pointer event
   */
  private getNormalizedCoords(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();

    // Get position relative to canvas
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Normalize to 0-1 range, clamped
    const normalizedX = Math.max(0, Math.min(1, x / rect.width));
    const normalizedY = Math.max(0, Math.min(1, y / rect.height));

    return { x: normalizedX, y: normalizedY };
  }

  /**
   * Set move event throttle rate
   */
  setThrottleRate(ms: number) {
    this.moveThrottleMs = ms;
  }

  /**
   * Detach event listeners and cleanup
   */
  dispose() {
    for (const [eventName, handler] of this.boundHandlers) {
      this.canvas.removeEventListener(eventName, handler);
    }
    this.boundHandlers.clear();

    this.isPointerDown = false;
    this.pointerId = null;
  }
}
