/**
 * Android keycodes for special keys
 */
export const ANDROID_KEYCODES = {
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
export const AMETA = {
  NONE: 0,
  SHIFT_ON: 0x01,
  ALT_ON: 0x02,
  CTRL_ON: 0x1000,
};

/**
 * Map browser key to Android keycode
 */
export const KEY_TO_KEYCODE: Record<string, number> = {
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
