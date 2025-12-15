/**
 * Platform capabilities - defines what features each device platform supports
 */

export type DevicePlatform = 'android' | 'ios';
export type VideoCodec = 'h264' | 'h265' | 'av1';

export interface PlatformCapabilities {
  // Control
  supportsTouch: boolean;
  supportsKeyboard: boolean;
  supportsSystemButtons: boolean; // home, back, recent apps
  supportsVolumeControl: boolean;

  // Features
  supportsRotation: boolean;
  supportsDisplaySelection: boolean;
  supportsVirtualDisplay: boolean;
  supportsCameraSource: boolean;
  supportsScreenOff: boolean;

  // File operations
  supportsApkInstall: boolean;
  supportsFileUpload: boolean;
  supportsAppLaunch: boolean;

  // Audio/Video
  supportsAudioCapture: boolean;
  supportedVideoCodecs: VideoCodec[];
}

export const ANDROID_CAPABILITIES: PlatformCapabilities = {
  // Control - full support
  supportsTouch: true,
  supportsKeyboard: true,
  supportsSystemButtons: true,
  supportsVolumeControl: true,

  // Features - full support
  supportsRotation: true,
  supportsDisplaySelection: true,
  supportsVirtualDisplay: true,
  supportsCameraSource: true,
  supportsScreenOff: true,

  // File operations - full support
  supportsApkInstall: true,
  supportsFileUpload: true,
  supportsAppLaunch: true,

  // Audio/Video - full support
  supportsAudioCapture: true,
  supportedVideoCodecs: ['h264', 'h265', 'av1'],
};

export const IOS_CAPABILITIES: PlatformCapabilities = {
  // Control - display only for MVP
  supportsTouch: false,
  supportsKeyboard: false,
  supportsSystemButtons: false,
  supportsVolumeControl: false,

  // Features - limited
  supportsRotation: false,
  supportsDisplaySelection: false,
  supportsVirtualDisplay: false,
  supportsCameraSource: false,
  supportsScreenOff: false,

  // File operations - none for MVP
  supportsApkInstall: false,
  supportsFileUpload: false,
  supportsAppLaunch: false,

  // Audio/Video - CoreMediaIO supports both
  supportsAudioCapture: true,
  supportedVideoCodecs: ['h264'],
};

/**
 * Get capabilities for a given platform
 */
export function getCapabilities(platform: DevicePlatform): PlatformCapabilities {
  switch (platform) {
    case 'android':
      return ANDROID_CAPABILITIES;
    case 'ios':
      return IOS_CAPABILITIES;
    default:
      return ANDROID_CAPABILITIES;
  }
}

/**
 * Check if iOS support is available on the current host platform
 */
export function isIOSSupportAvailable(): boolean {
  return process.platform === 'darwin';
}
