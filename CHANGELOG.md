# Changelog

All notable changes to the "Scrcpy for VS Code" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-12-15

### Added

- Initial release of Scrcpy for VS Code
- **Multi-device support** with tab bar for switching between connected devices
- **Real-time screen mirroring** using WebCodecs API for hardware-accelerated decoding
- **Audio streaming** with mute control (requires scrcpy 2.0+)
- **Touch input support** including tap, drag, and mouse wheel scrolling
- **Keyboard input** with modifier key support (Ctrl, Alt, Shift)
- **Device control buttons** with long press support (Volume, Back, Home, Recent Apps, Power, Rotate)
- **Clipboard synchronization** between PC and device (Ctrl+V to paste, Ctrl+C to copy)
- **WiFi connection** support for Android 11+ Wireless Debugging and legacy adb tcpip
- **APK installation** via toolbar button
- **File upload** to device via toolbar button
- **Auto-connect** when devices are plugged in
- **Auto-reconnect** on disconnect with configurable retry count

### Video & Streaming Features

- Camera mirroring (front/back/external)
- Screen recording to WebM or MP4 format
- Virtual display mode
- Multiple display selection (for devices with external monitors)
- H.264, H.265, and AV1 video codec support
- Crop region configuration
- Configurable video quality, resolution, and FPS

### Input & Control Features

- App launcher with searchable package list
- Quick panel access (notification and settings panels)
- Two-finger pinch-to-zoom gesture support
- UHID keyboard mode for better game/app compatibility
- Keyboard shortcuts (Alt+1 through Alt+9) to switch device tabs

### Audio Features

- Audio source selection (device output, microphone, playback capture)
- Microphone capture mode

### Information & Status Features

- Device info panel showing model, Android version, battery, and storage
- FPS, bitrate, and frame drop statistics overlay
- Per-tab connection status indicator
- Screenshot preview with save/copy options

### Localization

- English (default)
- Spanish

[0.1.0]: https://github.com/izantech/scrcpy-vscode/releases/tag/0.1.0
