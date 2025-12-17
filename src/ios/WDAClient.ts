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
  private lastTouchX = 0;
  private lastTouchY = 0;

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
   */
  async touch(action: 'down' | 'move' | 'up', x: number, y: number): Promise<void> {
    const sessionId = await this.ensureSession();

    if (action === 'down') {
      // Start a new touch
      this.touchActive = true;
      this.lastTouchX = x;
      this.lastTouchY = y;

      // For a single tap, we'll wait for the 'up' event
      // For drag, we'll track the movement
    } else if (action === 'move' && this.touchActive) {
      // During drag, update position (we'll send the swipe on 'up')
      this.lastTouchX = x;
      this.lastTouchY = y;
    } else if (action === 'up' && this.touchActive) {
      this.touchActive = false;

      // Check if this was a tap (no significant movement) or a drag
      const startX = this.lastTouchX;
      const startY = this.lastTouchY;
      const distance = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));

      if (distance < 10) {
        // Tap at the original position
        await this.performTap(sessionId, startX, startY);
      } else {
        // Swipe from start to end
        await this.performSwipe(sessionId, startX, startY, x, y);
      }
    }
  }

  /**
   * Perform a tap at the specified coordinates
   */
  private async performTap(sessionId: string, x: number, y: number): Promise<void> {
    const actions: WDATouchAction[] = [
      { action: 'tap', options: { x: Math.round(x), y: Math.round(y) } },
    ];

    await this.request('POST', `/session/${sessionId}/wda/touch/perform`, {
      actions,
    });
  }

  /**
   * Perform a swipe gesture
   */
  private async performSwipe(
    sessionId: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    durationMs: number = 200
  ): Promise<void> {
    const actions: WDATouchAction[] = [
      { action: 'press', options: { x: Math.round(startX), y: Math.round(startY) } },
      { action: 'wait', options: { ms: durationMs } },
      { action: 'moveTo', options: { x: Math.round(endX), y: Math.round(endY) } },
      { action: 'release' },
    ];

    await this.request('POST', `/session/${sessionId}/wda/touch/perform`, {
      actions,
    });
  }

  /**
   * Send scroll gesture
   * Converts scroll delta to a swipe gesture
   */
  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    const sessionId = await this.ensureSession();

    // Convert scroll deltas to swipe coordinates
    // Scale factor to make scrolling feel natural
    const scrollScale = 50;
    const endX = x - deltaX * scrollScale;
    const endY = y - deltaY * scrollScale;

    await this.performSwipe(sessionId, x, y, endX, endY, 100);
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
   * Disconnect and cleanup
   */
  disconnect(): void {
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
