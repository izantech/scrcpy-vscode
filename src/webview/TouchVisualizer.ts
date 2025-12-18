/**
 * Touch point visualization with ripple animations
 *
 * Shows animated circular ripples at touch points for demos and screen recordings.
 * Supports single and multi-touch interactions.
 */

/**
 * Internal ripple tracking state
 */
interface Ripple {
  element: HTMLElement;
  state: 'active' | 'fading';
}

/**
 * Visualizes touch interactions with ripple animations
 */
export class TouchVisualizer {
  private container: HTMLElement;
  private enabled: boolean = false;
  private ripples: Map<number, Ripple> = new Map();
  private ripplePool: HTMLElement[] = [];
  private readonly MAX_POOL_SIZE = 10;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Enable or disable touch visualization
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearAllRipples();
    }
  }

  /**
   * Show ripple at touch point
   * @param pointerId Unique identifier for this touch point
   * @param normalizedX X coordinate normalized to 0-1 range
   * @param normalizedY Y coordinate normalized to 0-1 range
   */
  showRipple(pointerId: number, normalizedX: number, normalizedY: number): void {
    if (!this.enabled) {
      return;
    }

    // Remove existing ripple for this pointer if any
    this.removeRipple(pointerId);

    const rect = this.container.getBoundingClientRect();
    const x = normalizedX * rect.width;
    const y = normalizedY * rect.height;

    const element = this.getRippleElement();
    element.className = 'touch-ripple touch-ripple-active';
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;

    this.container.appendChild(element);

    this.ripples.set(pointerId, {
      element,
      state: 'active',
    });
  }

  /**
   * Move existing ripple to new position (no-op for performance)
   * Ripples stay at their initial touch point to avoid lag during swipes.
   */
  moveRipple(_pointerId: number, _normalizedX: number, _normalizedY: number): void {
    // Intentionally empty - ripples stay at touch start point for performance
  }

  /**
   * Hide ripple with fade-out animation
   * @param pointerId Unique identifier for the touch point
   */
  hideRipple(pointerId: number): void {
    const ripple = this.ripples.get(pointerId);
    if (!ripple || ripple.state === 'fading') {
      return;
    }

    ripple.state = 'fading';
    ripple.element.className = 'touch-ripple touch-ripple-fading';

    // Remove after animation completes
    const handleAnimationEnd = () => {
      ripple.element.removeEventListener('animationend', handleAnimationEnd);
      this.removeRipple(pointerId);
    };
    ripple.element.addEventListener('animationend', handleAnimationEnd);

    // Fallback timeout in case animationend doesn't fire
    setTimeout(() => {
      if (this.ripples.has(pointerId)) {
        this.removeRipple(pointerId);
      }
    }, 400);
  }

  /**
   * Get a ripple element from pool or create new one
   */
  private getRippleElement(): HTMLElement {
    if (this.ripplePool.length > 0) {
      return this.ripplePool.pop()!;
    }
    return document.createElement('div');
  }

  /**
   * Remove ripple and return element to pool
   */
  private removeRipple(pointerId: number): void {
    const ripple = this.ripples.get(pointerId);
    if (!ripple) {
      return;
    }

    ripple.element.remove();

    // Return to pool if not full
    if (this.ripplePool.length < this.MAX_POOL_SIZE) {
      ripple.element.className = '';
      this.ripplePool.push(ripple.element);
    }

    this.ripples.delete(pointerId);
  }

  /**
   * Clear all active ripples immediately
   */
  private clearAllRipples(): void {
    for (const [pointerId] of this.ripples) {
      this.removeRipple(pointerId);
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.clearAllRipples();
    this.ripplePool = [];
  }
}
