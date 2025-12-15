/**
 * Scrcpy Protocol Constants
 */

// Device Name header length
export const DEVICE_NAME_LENGTH = 64;

// Video Codec IDs
export const VIDEO_CODEC_ID_H264 = 0x68323634; // "h264"
export const VIDEO_CODEC_ID_H265 = 0x68323635; // "h265"
export const VIDEO_CODEC_ID_AV1 = 0x00617631; // "av1" (little-endian interpretation)
// Audio Codec IDs
export const AUDIO_CODEC_ID_OPUS = 0x6f707573; // "opus"

// Control Message Types (Host -> Device)
export enum ControlMessageType {
  INJECT_KEYCODE = 0,
  INJECT_TEXT = 1,
  INJECT_TOUCH_EVENT = 2,
  INJECT_SCROLL_EVENT = 3,
  BACK_OR_SCREEN_ON = 4,
  EXPAND_NOTIFICATION_PANEL = 5,
  EXPAND_SETTINGS_PANEL = 6,
  COLLAPSE_PANELS = 7,
  GET_CLIPBOARD = 8,
  SET_CLIPBOARD = 9,
  SET_DISPLAY_POWER = 10,
  ROTATE_DEVICE = 11,
  UHID_CREATE = 12,
  UHID_INPUT = 13,
  UHID_DESTROY = 14,
  OPEN_HARD_KEYBOARD_SETTINGS = 15,
  START_APP = 16,
}

// Device Message Types (Device -> Host)
export enum DeviceMessageType {
  CLIPBOARD = 0,
  ACK_CLIPBOARD = 1,
  UHID_OUTPUT = 2,
}

// Motion Event Actions
export enum MotionEventAction {
  DOWN = 0,
  UP = 1,
  MOVE = 2,
}

// Key Actions
export enum KeyAction {
  DOWN = 0,
  UP = 1,
}

// Re-export as namespace for backwards compatibility
export const ScrcpyProtocol = {
  DEVICE_NAME_LENGTH,
  VIDEO_CODEC_ID_H264,
  VIDEO_CODEC_ID_H265,
  VIDEO_CODEC_ID_AV1,
  AUDIO_CODEC_ID_OPUS,
  ControlMessageType,
  DeviceMessageType,
  MotionEventAction,
  KeyAction,
};
