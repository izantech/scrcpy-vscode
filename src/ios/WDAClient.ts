/**
 * WebDriverAgent HTTP Client
 *
 * Implements WebDriver-compatible REST API for iOS device control.
 * Used for touch, keyboard, and button input via WebDriverAgent.
 */

/**
 * WDA session information returned when creating a session
 */
export interface WDASessionInfo {
  sessionId: string;
  capabilities: {
    device?: string;
    browserName?: string;
    sdkVersion?: string;
    CFBundleIdentifier?: string;
  };
}

/**
 * WDA server status
 */
export interface WDAStatus {
  ready: boolean;
  message?: string;
  state?: string;
  os?: {
    name: string;
    version: string;
  };
  ios?: {
    simulatorVersion?: string;
    ip?: string;
  };
  build?: {
    time?: string;
    productBundleIdentifier?: string;
  };
}

/**
 * Touch action types supported by WDA
 */
export type WDATouchActionType = 'tap' | 'press' | 'moveTo' | 'release' | 'wait';

/**
 * Individual touch action in an action chain
 */
export interface WDATouchAction {
  action: WDATouchActionType;
  options?: {
    x?: number;
    y?: number;
    ms?: number;
    element?: string;
  };
}

/**
 * Request timeout in milliseconds
 */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * HTTP client for WebDriverAgent communication
 */
export class WDAClient {
  private baseUrl: string;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;

  // Touch state tracking for converting down/move/up to WDA action chains
  private touchActive = false;
  private touchStartX = 0;
  private touchStartY = 0;

  // Scroll debounce delay - wait this long after last scroll event before sending
  private scrollDebounceMs = 50;
  private pendingScroll: { deltaX: number; deltaY: number } | null = null;
  private scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(host: string, port: number = 8100) {
    this.baseUrl = `http://${host}:${port}`;
  }

  /**
   * Check if WDA is available and running
   */
  async checkStatus(): Promise<WDAStatus | null> {
    try {
      const response = await this.request<{ value: WDAStatus }>('GET', '/status');
      return response.value;
    } catch {
      return null;
    }
  }

  /**
   * Create a new WDA session
   */
  async createSession(): Promise<WDASessionInfo> {
    const response = await this.request<{
      value: { sessionId: string; capabilities: WDASessionInfo['capabilities'] };
      sessionId?: string;
    }>('POST', '/session', {
      capabilities: {
        alwaysMatch: {},
        firstMatch: [{}],
      },
    });

    // Handle both WDA response formats
    const sessionId = response.value?.sessionId || response.sessionId;
    if (!sessionId) {
      throw new Error('No session ID in WDA response');
    }

    this.sessionId = sessionId;
    return {
      sessionId,
      capabilities: response.value?.capabilities || {},
    };
  }

  /**
   * Delete the current session
   */
  async deleteSession(): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    try {
      await this.request('DELETE', `/session/${this.sessionId}`);
    } catch {
      // Ignore errors on session cleanup
    } finally {
      this.sessionId = null;
    }
  }

  /**
   * Get current session ID, creating one if needed
   */
  async ensureSession(): Promise<string> {
    if (this.sessionId) {
      return this.sessionId;
    }

    const session = await this.createSession();
    return session.sessionId;
  }

  /**
   * Send touch action (tap, drag)
   * Converts down/move/up actions to WDA touch action chains
   * Fire-and-forget: does not wait for WDA response
   */
  touch(action: 'down' | 'move' | 'up', x: number, y: number): void {
    if (action === 'down') {
      // Start a new touch - store initial position
      this.touchActive = true;
      this.touchStartX = x;
      this.touchStartY = y;
    } else if (action === 'move' && this.touchActive) {
      // During drag, movement is tracked but start position stays fixed
      // (Start position is only set on 'down')
    } else if (action === 'up' && this.touchActive) {
      this.touchActive = false;

      // Need session for WDA request
      if (!this.sessionId) {
        return;
      }

      // Check if this was a tap (no significant movement) or a drag
      const distance = Math.sqrt(
        Math.pow(x - this.touchStartX, 2) + Math.pow(y - this.touchStartY, 2)
      );

      if (distance < 10) {
        // Tap at the original position (fire-and-forget)
        this.performTap(this.sessionId, this.touchStartX, this.touchStartY).catch((e) =>
          console.error('[WDA] Tap failed:', e)
        );
      } else {
        // Swipe from start to end (fire-and-forget)
        this.performSwipe(this.sessionId, this.touchStartX, this.touchStartY, x, y).catch((e) =>
          console.error('[WDA] Swipe failed:', e)
        );
      }
    }
  }

  /**
   * Perform a tap at the specified coordinates using W3C Actions API
   */
  private async performTap(sessionId: string, x: number, y: number): Promise<void> {
    const actions = {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 50 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    };

    await this.request('POST', `/session/${sessionId}/actions`, actions);
  }

  /**
   * Perform a swipe gesture using W3C Actions API
   */
  private async performSwipe(
    sessionId: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs: number = 200
  ): Promise<void> {
    const actions = {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: Math.round(startX), y: Math.round(startY) },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerMove', duration: durationMs, x: Math.round(endX), y: Math.round(endY) },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    };

    await this.request('POST', `/session/${sessionId}/actions`, actions);
  }

  /**
   * Send scroll gesture using WDA's native scroll endpoint
   * Debounced to accumulate rapid scroll events into a single gesture
   */
  scroll(_x: number, _y: number, deltaX: number, deltaY: number): void {
    // Accumulate scroll deltas
    if (this.pendingScroll) {
      this.pendingScroll.deltaX += deltaX;
      this.pendingScroll.deltaY += deltaY;
    } else {
      this.pendingScroll = { deltaX, deltaY };
    }

    // Clear existing timeout and set a new one (debounce)
    // This ensures we only send ONE scroll request after scrolling stops
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
    }

    this.scrollTimeoutId = setTimeout(() => {
      this.scrollTimeoutId = null;
      this.flushScroll();
    }, this.scrollDebounceMs);
  }

  /**
   * Flush pending scroll to WDA (fire-and-forget)
   */
  private flushScroll(): void {
    if (!this.pendingScroll || !this.sessionId) {
      return;
    }

    const { deltaX, deltaY } = this.pendingScroll;
    this.pendingScroll = null;

    // Determine scroll direction and distance
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Fire-and-forget: don't await, just catch errors
    if (absY >= absX && absY > 0.001) {
      const direction = deltaY > 0 ? 'up' : 'down';
      const distance = Math.min(0.5, absY * 2);

      this.request('POST', `/session/${this.sessionId}/wda/scroll`, {
        direction,
        distance,
      }).catch((e) => console.error('[WDA] Scroll failed:', e));
    } else if (absX > 0.001) {
      const direction = deltaX > 0 ? 'left' : 'right';
      const distance = Math.min(0.5, absX * 2);

      this.request('POST', `/session/${this.sessionId}/wda/scroll`, {
        direction,
        distance,
      }).catch((e) => console.error('[WDA] Scroll failed:', e));
    }
  }

  /**
   * Type text using WDA keyboard
   */
  async typeText(text: string): Promise<void> {
    const sessionId = await this.ensureSession();

    await this.request('POST', `/session/${sessionId}/wda/keys`, {
      value: text.split(''),
    });
  }

  /**
   * Press a hardware button
   * Supported: home, volumeUp, volumeDown
   */
  async pressButton(button: 'home' | 'volumeUp' | 'volumeDown'): Promise<void> {
    const sessionId = await this.ensureSession();

    await this.request('POST', `/session/${sessionId}/wda/pressButton`, {
      name: button,
    });
  }

  /**
   * Get the screen/window size
   */
  async getWindowSize(): Promise<{ width: number; height: number }> {
    const sessionId = await this.ensureSession();

    const response = await this.request<{ value: { width: number; height: number } }>(
      'GET',
      `/session/${sessionId}/window/size`
    );

    return response.value;
  }

  /**
   * Initialize session proactively (call after checkStatus succeeds)
   * This avoids latency on first touch
   */
  async initSession(): Promise<void> {
    if (!this.sessionId) {
      await this.createSession();
    }
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    // Cancel any pending scroll timeout
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
      this.scrollTimeoutId = null;
    }
    this.pendingScroll = null;

    // Cancel any pending requests
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clean up session (fire and forget)
    if (this.sessionId) {
      this.deleteSession().catch(() => {});
    }

    this.touchActive = false;
    this.sessionId = null;
  }

  /**
   * Make an HTTP request to WDA
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Create new abort controller for this request
    this.abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const url = `${this.baseUrl}${path}`;
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: this.abortController.signal,
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`WDA request failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      return data as T;
    } finally {
      clearTimeout(timeoutId);
      this.abortController = null;
    }
  }
}
