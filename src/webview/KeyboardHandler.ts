/**
 * Android keycodes for special keys
 */
const ANDROID_KEYCODES = {
  ENTER: 66,
  DEL: 67,           // Backspace
  FORWARD_DEL: 112,  // Delete
  TAB: 61,
  ESCAPE: 111,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  PAGE_UP: 92,
  PAGE_DOWN: 93,
  MOVE_HOME: 122,
  MOVE_END: 123,
  // Letter keys (A-Z) for modifier combinations
  A: 29, B: 30, C: 31, D: 32, E: 33, F: 34, G: 35, H: 36, I: 37,
  J: 38, K: 39, L: 40, M: 41, N: 42, O: 43, P: 44, Q: 45, R: 46,
  S: 47, T: 48, U: 49, V: 50, W: 51, X: 52, Y: 53, Z: 54,
};

/**
 * Android metastate flags for modifier keys
 */
const AMETA = {
  NONE: 0,
  SHIFT_ON: 0x01,
  ALT_ON: 0x02,
  CTRL_ON: 0x1000,
};

/**
 * Check if running on macOS
 */
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

/**
 * Map browser key to Android keycode
 */
const KEY_TO_KEYCODE: Record<string, number> = {
  'Enter': ANDROID_KEYCODES.ENTER,
  'Backspace': ANDROID_KEYCODES.DEL,
  'Delete': ANDROID_KEYCODES.FORWARD_DEL,
  'Tab': ANDROID_KEYCODES.TAB,
  'Escape': ANDROID_KEYCODES.ESCAPE,
  'ArrowUp': ANDROID_KEYCODES.DPAD_UP,
  'ArrowDown': ANDROID_KEYCODES.DPAD_DOWN,
  'ArrowLeft': ANDROID_KEYCODES.DPAD_LEFT,
  'ArrowRight': ANDROID_KEYCODES.DPAD_RIGHT,
  'PageUp': ANDROID_KEYCODES.PAGE_UP,
  'PageDown': ANDROID_KEYCODES.PAGE_DOWN,
  'Home': ANDROID_KEYCODES.MOVE_HOME,
  'End': ANDROID_KEYCODES.MOVE_END,
};

/**
 * Callback for text input (INJECT_TEXT)
 */
type TextCallback = (text: string) => void;

/**
 * Callback for keycode input (INJECT_KEYCODE)
 */
type KeycodeCallback = (keycode: number, metastate: number, action: 'down' | 'up') => void;

/**
 * Callback for clipboard operations
 */
type ClipboardCallback = () => void;

/**
 * Handles keyboard input on the canvas and forwards to extension
 */
export class KeyboardHandler {
  private canvas: HTMLCanvasElement;
  private onText: TextCallback;
  private onKeycode: KeycodeCallback;
  private onPaste: ClipboardCallback;
  private onCopy: ClipboardCallback;
  private focused = false;
  private boundHandlers: Map<string, (e: Event) => void> = new Map();

  // Text buffering for efficient INJECT_TEXT messages
  private textBuffer = '';
  private textBufferTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly TEXT_BUFFER_DELAY = 50; // ms to batch text input
  private readonly MAX_TEXT_LENGTH = 300;  // scrcpy protocol limit

  // Track pressed keys to release on focus loss
  private pressedKeys = new Map<string, number>(); // key -> keycode

  constructor(
    canvas: HTMLCanvasElement,
    onText: TextCallback,
    onKeycode: KeycodeCallback,
    onPaste?: ClipboardCallback,
    onCopy?: ClipboardCallback
  ) {
    this.canvas = canvas;
    this.onText = onText;
    this.onKeycode = onKeycode;
    this.onPaste = onPaste || (() => {});
    this.onCopy = onCopy || (() => {});
    this.attachEventListeners();
  }

  /**
   * Attach event listeners for focus and keyboard
   */
  private attachEventListeners() {
    // Click to focus
    const onClick = () => this.setFocused(true);
    this.canvas.addEventListener('click', onClick);
    this.boundHandlers.set('click', onClick);

    // Keyboard events
    const onKeyDown = (e: Event) => this.onKeyDown(e as KeyboardEvent);
    const onKeyUp = (e: Event) => this.onKeyUp(e as KeyboardEvent);
    this.canvas.addEventListener('keydown', onKeyDown);
    this.canvas.addEventListener('keyup', onKeyUp);
    this.boundHandlers.set('keydown', onKeyDown);
    this.boundHandlers.set('keyup', onKeyUp);

    // Blur to unfocus
    const onBlur = () => this.setFocused(false);
    this.canvas.addEventListener('blur', onBlur);
    this.boundHandlers.set('blur', onBlur);
  }

  /**
   * Set keyboard focus state
   */
  setFocused(focused: boolean) {
    if (this.focused === focused) return;

    this.focused = focused;

    if (focused) {
      // Make canvas focusable and focus it
      this.canvas.tabIndex = 0;
      this.canvas.focus();
      this.canvas.classList.add('keyboard-focused');
    } else {
      // Release all pressed keys before losing focus
      this.releaseAllPressedKeys();
      // Flush any pending text
      this.flushTextBuffer();
      this.canvas.tabIndex = -1;
      this.canvas.classList.remove('keyboard-focused');
    }
  }

  /**
   * Release all pressed keys (called on focus loss)
   */
  private releaseAllPressedKeys() {
    for (const [, keycode] of this.pressedKeys) {
      this.onKeycode(keycode, AMETA.NONE, 'up');
    }
    this.pressedKeys.clear();
  }

  /**
   * Check if keyboard is focused
   */
  isFocused(): boolean {
    return this.focused;
  }

  /**
   * Check if the primary modifier key is pressed
   * On Mac: accepts both Cmd and Ctrl (works regardless of key remapping)
   * On others: Ctrl only
   */
  private hasPrimaryModifier(event: KeyboardEvent): boolean {
    return isMac ? (event.metaKey || event.ctrlKey) : event.ctrlKey;
  }

  /**
   * Handle key down event
   */
  private onKeyDown(event: KeyboardEvent) {
    if (!this.focused) return;

    // Prevent default browser behavior
    event.preventDefault();
    event.stopPropagation();

    // Check if this is a special key or has modifiers
    const specialKeycode = KEY_TO_KEYCODE[event.key];
    const hasModifier = this.hasPrimaryModifier(event) || event.altKey;

    // Intercept Ctrl+V / Cmd+V for paste (sync PC clipboard to device)
    if (this.hasPrimaryModifier(event) && event.key.toLowerCase() === 'v') {
      this.flushTextBuffer();
      this.onPaste();
      return;
    }

    // Intercept Ctrl+C / Cmd+C for copy (sync device clipboard to PC)
    if (this.hasPrimaryModifier(event) && event.key.toLowerCase() === 'c') {
      this.flushTextBuffer();
      this.onCopy();
      return;
    }

    if (specialKeycode !== undefined) {
      // Special keys always use INJECT_KEYCODE
      this.flushTextBuffer();
      const metastate = this.buildMetastate(event);
      this.onKeycode(specialKeycode, metastate, 'down');
      this.pressedKeys.set(event.key, specialKeycode);
    } else if (hasModifier && event.key.length === 1) {
      // Modifier + letter/number: use INJECT_KEYCODE
      this.flushTextBuffer();
      const keycode = this.getKeycodeForChar(event.key);
      if (keycode !== null) {
        const metastate = this.buildMetastate(event);
        this.onKeycode(keycode, metastate, 'down');
        this.pressedKeys.set(event.key, keycode);
      }
    } else if (event.key.length === 1 && !this.hasPrimaryModifier(event) && !event.altKey) {
      // Regular character: buffer for INJECT_TEXT
      this.appendToTextBuffer(event.key);
    }
    // Ignore other keys (modifiers alone, function keys, etc.)
  }

  /**
   * Handle key up event
   */
  private onKeyUp(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();

    // Always process keyup to clean up pressed keys, even if not focused
    const keycode = this.pressedKeys.get(event.key);
    if (keycode !== undefined) {
      this.pressedKeys.delete(event.key);
      // Only send keyup if still focused
      if (this.focused) {
        const metastate = this.buildMetastate(event);
        this.onKeycode(keycode, metastate, 'up');
      }
    }
  }

  /**
   * Build Android metastate from keyboard event
   * On macOS, Command key maps to Ctrl for Android (Cmd+C -> Ctrl+C)
   */
  private buildMetastate(event: KeyboardEvent): number {
    let metastate = AMETA.NONE;
    if (event.shiftKey) metastate |= AMETA.SHIFT_ON;
    if (event.altKey) metastate |= AMETA.ALT_ON;
    // Map Cmd (Mac) or Ctrl (others) to Android Ctrl
    if (this.hasPrimaryModifier(event)) metastate |= AMETA.CTRL_ON;
    return metastate;
  }

  /**
   * Get Android keycode for a character (used with modifiers)
   */
  private getKeycodeForChar(char: string): number | null {
    const upper = char.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') {
      return ANDROID_KEYCODES[upper as keyof typeof ANDROID_KEYCODES] ?? null;
    }
    // Could add number keys and other characters here if needed
    return null;
  }

  /**
   * Append text to buffer and schedule flush
   */
  private appendToTextBuffer(text: string) {
    this.textBuffer += text;

    // Flush immediately if buffer reaches limit
    if (this.textBuffer.length >= this.MAX_TEXT_LENGTH) {
      this.flushTextBuffer();
      return;
    }

    // Schedule delayed flush for batching
    if (this.textBufferTimeout) {
      clearTimeout(this.textBufferTimeout);
    }
    this.textBufferTimeout = setTimeout(() => this.flushTextBuffer(), this.TEXT_BUFFER_DELAY);
  }

  /**
   * Send buffered text synchronously (no race conditions)
   */
  private flushTextBuffer() {
    if (this.textBufferTimeout) {
      clearTimeout(this.textBufferTimeout);
      this.textBufferTimeout = null;
    }

    // Process all buffered text synchronously
    while (this.textBuffer.length > 0) {
      const text = this.textBuffer.substring(0, this.MAX_TEXT_LENGTH);
      this.onText(text);
      this.textBuffer = this.textBuffer.substring(this.MAX_TEXT_LENGTH);
    }
  }

  /**
   * Detach event listeners and cleanup
   */
  dispose() {
    this.flushTextBuffer();
    this.releaseAllPressedKeys();
    this.focused = false;
    this.canvas.classList.remove('keyboard-focused');

    for (const [eventName, handler] of this.boundHandlers) {
      this.canvas.removeEventListener(eventName, handler);
    }
    this.boundHandlers.clear();
  }
}
