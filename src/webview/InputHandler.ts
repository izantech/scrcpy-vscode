/**
 * Type for touch event action
 */
type TouchAction = 'down' | 'move' | 'up';

/**
 * Callback for input events
 */
type InputCallback = (x: number, y: number, action: TouchAction) => void;

/**
 * Callback for scroll events
 */
type ScrollCallback = (x: number, y: number, deltaX: number, deltaY: number) => void;

/**
 * Handles touch/mouse input on the canvas and forwards to extension
 */
export class InputHandler {
  private canvas: HTMLCanvasElement;
  private onInput: InputCallback;
  private onScroll?: ScrollCallback;
  private isPointerDown = false;
  private pointerId: number | null = null;

  // Throttling for move events
  private lastMoveTime = 0;
  private moveThrottleMs = 16; // ~60fps

  // Scroll accumulation state
  private scrollBufferX = 0;
  private scrollBufferY = 0;
  private lastScrollX = 0;
  private lastScrollY = 0;
  private scrollRafId: number | null = null;

  // Bound event handlers for cleanup
  private boundHandlers: Map<string, (e: PointerEvent | WheelEvent | Event) => void> = new Map();

  constructor(canvas: HTMLCanvasElement, onInput: InputCallback, onScroll?: ScrollCallback) {
    this.canvas = canvas;
    this.onInput = onInput;
    this.onScroll = onScroll;

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
    const onWheel = (e: Event) => this.onWheelEvent(e as WheelEvent);
    const onContextMenu = (e: Event) => e.preventDefault();

    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.canvas.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('pointerup', onPointerUp);
    this.canvas.addEventListener('pointercancel', onPointerUp);
    this.canvas.addEventListener('pointerleave', onPointerUp);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', onContextMenu);

    // Store for cleanup
    this.boundHandlers.set('pointerdown', onPointerDown);
    this.boundHandlers.set('pointermove', onPointerMove);
    this.boundHandlers.set('pointerup', onPointerUp);
    this.boundHandlers.set('pointercancel', onPointerUp);
    this.boundHandlers.set('pointerleave', onPointerUp);
    this.boundHandlers.set('wheel', onWheel);
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
    if (
      !this.isPointerDown ||
      (event.pointerId !== this.pointerId && event.type !== 'pointerleave')
    ) {
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
   * Handle mouse wheel event
   */
  private onWheelEvent(event: WheelEvent) {
    event.preventDefault();

    if (!this.onScroll) {
      return;
    }

    const coords = this.getNormalizedCoordsFromMouse(event);

    // Update last known position
    this.lastScrollX = coords.x;
    this.lastScrollY = coords.y;

    // Normalize based on deltaMode
    // DOM_DELTA_PIXEL = 0, DOM_DELTA_LINE = 1, DOM_DELTA_PAGE = 2
    let deltaX = event.deltaX;
    let deltaY = event.deltaY;

    if (event.deltaMode === 1) {
      // Line mode - multiply by typical line height
      deltaX *= 16;
      deltaY *= 16;
    } else if (event.deltaMode === 2) {
      // Page mode - multiply by typical page height
      deltaX *= 100;
      deltaY *= 100;
    }

    // Scale to scrcpy units (negative because scrcpy vScroll down is negative)
    // Use larger divisor for slower, more controlled scrolling
    const SCROLL_STEP = 200;
    deltaX = -deltaX / SCROLL_STEP;
    deltaY = -deltaY / SCROLL_STEP;

    // Accumulate scroll deltas
    this.scrollBufferX += deltaX;
    this.scrollBufferY += deltaY;

    // Schedule transmission on next animation frame
    if (this.scrollRafId === null) {
      this.scrollRafId = requestAnimationFrame(() => this.processScrollBuffer());
    }
  }

  /**
   * Process accumulated scroll buffer and send to device
   */
  private processScrollBuffer() {
    this.scrollRafId = null;

    // Tiny threshold to ignore sub-pixel jitter
    const THRESHOLD = 0.0001;

    if (Math.abs(this.scrollBufferX) > THRESHOLD || Math.abs(this.scrollBufferY) > THRESHOLD) {
      this.onScroll!(this.lastScrollX, this.lastScrollY, this.scrollBufferX, this.scrollBufferY);

      // Reset buffer
      this.scrollBufferX = 0;
      this.scrollBufferY = 0;
    }
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
   * Get normalized coordinates (0-1) from mouse/wheel event
   */
  private getNormalizedCoordsFromMouse(event: MouseEvent): { x: number; y: number } {
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
