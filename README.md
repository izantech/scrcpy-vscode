# Scrcpy for VS Code

[![Visual Studio Marketplace Version](https://img.shields.io/visualstudio-marketplace/v/izantech.scrcpy-vscode?style=flat-square&color=007acc)](https://marketplace.visualstudio.com/items?itemName=izantech.scrcpy-vscode)
[![Installs](https://img.shields.io/visualstudio-marketplace/i/izantech.scrcpy-vscode?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=izantech.scrcpy-vscode)
[![Rating](https://img.shields.io/visualstudio-marketplace/r/izantech.scrcpy-vscode?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=izantech.scrcpy-vscode)

Display and control your Android device screen directly within VS Code, similar to Android Studio's "Running Devices" feature.

## Features

- **Multi-device support** with tab bar for switching between devices
- View Android device screen in real-time
- **Audio streaming** - hear device audio with mute button (requires scrcpy 2.0+)
- Touch input support (tap, drag)
- **Mouse wheel scrolling** - scroll content using the mouse wheel (configurable sensitivity)
- **Keyboard input** - click canvas to enable typing, with modifier support (Ctrl, Alt, Shift)
- **Device control buttons** with long press support (Volume, Back, Home, Recent Apps, Power, Rotate)
- **Clipboard sync** - Ctrl+V pastes from PC to device, Ctrl+C copies from device to PC
- **WiFi connection** - connect wirelessly via Android 11+ Wireless Debugging or legacy adb tcpip
- **APK installation** - install APKs via toolbar button
- **File upload** - upload files and folders to device via toolbar button
- **Auto-connect** - automatically connects when devices are plugged in
- **Auto-reconnect** - automatic reconnection on disconnect (configurable retries)
- Hardware-accelerated video decoding (WebCodecs API)
- Configurable video quality, resolution, and FPS
- Turn device screen off while mirroring (saves battery)

### Video & Streaming

- **[Camera Mirroring](docs/feature-camera-mirroring.md)** - Mirror device front/back camera instead of screen display
- **[Screen Recording](docs/feature-screen-recording.md)** - Record device screen to WebM or MP4 format
- **[Virtual Display](docs/feature-virtual-display.md)** - Create a separate virtual display instead of mirroring main screen
- **[Multiple Display Support](docs/feature-multiple-display.md)** - Select which physical display to mirror (for devices with external monitors)
- **[H.265/AV1 Codec](docs/feature-h265-av1.md)** - Support for newer video codecs for better quality/compression
- **[Crop Region](docs/feature-crop-region.md)** - Mirror only a specific portion of the screen

### Input & Control

- **[App Launcher](docs/feature-app-launcher.md)** - Launch apps by package name from a searchable list
- **[Quick Panel Access](docs/feature-quick-panel.md)** - Buttons to open notification and settings panels
- **[Gesture Support](docs/feature-gesture-support.md)** - Two-finger pinch-to-zoom on canvas
- **[UHID Keyboard](docs/feature-uhid-keyboard.md)** - Hardware keyboard simulation for better game/app compatibility
- **[Keyboard Shortcuts](docs/feature-keyboard-shortcuts.md)** - Alt+1 through Alt+9 to switch between device tabs

### Audio

- **[Audio Source Selection](docs/feature-audio-source.md)** - Choose between device output, microphone, or playback capture
- **[Microphone Capture](docs/feature-mic-capture.md)** - Record device microphone audio instead of playback

### Information & Status

- **[Device Info Panel](docs/feature-device-info.md)** - Show model, Android version, battery, storage on hover
- **[Enhanced Stats](docs/feature-enhanced-stats.md)** - Display FPS, bitrate, and frame drop statistics
- **[Connection Status](docs/feature-connection-status.md)** - Visual indicator of connecting/connected/disconnected state per tab
- **[Screenshot Preview](docs/feature-screenshot-preview.md)** - Show thumbnail preview after taking screenshot with save/copy options

## Prerequisites

1. **ADB installed and in PATH**
   - macOS: `brew install android-platform-tools`
   - Linux: `sudo apt install adb`
   - Windows: Download [Platform Tools](https://developer.android.com/studio/releases/platform-tools)

2. **scrcpy installed** (for the server component)
   - macOS: `brew install scrcpy`
   - Linux: `sudo apt install scrcpy`
   - Windows: Download from [scrcpy releases](https://github.com/Genymobile/scrcpy/releases)

3. **Android device connected** via USB or WiFi with debugging enabled
   - Enable Developer Options: Settings > About Phone > Tap "Build number" 7 times
   - Enable USB Debugging: Settings > Developer Options > USB Debugging
   - For wireless: Enable Wireless debugging (Android 11+) or use `adb tcpip 5555`

## Usage

1. Connect your Android device(s) via USB (or enable wireless debugging)
2. Verify ADB sees your device: `adb devices`
3. Click the **scrcpy** icon in the Activity Bar (left sidebar)
4. The first device automatically connects and appears in the sidebar view
5. **Tip**: Drag the view to the Secondary Sidebar (right side) for optimal placement

### Multi-Device Support

- Click the **+** button in the tab bar to add another device
- Switch between devices by clicking their tabs
- Close a device connection by clicking the **×** on its tab
- Only the active tab streams video (saves resources)

### WiFi Connection

**Android 11+ (with pairing):**

1. On your device: Settings > Developer Options > Wireless debugging > Enable
2. Tap "Pair device with pairing code" to get the pairing address and code
3. In VS Code: Run "Scrcpy: Connect to Device over WiFi" or click the WiFi icon in the view title
4. Select "Pair new device (Android 11+)"
5. Enter the pairing address and 6-digit code
6. Enter the connection address from the main Wireless debugging screen

**Legacy method (Android 10 and below):**

1. Connect device via USB and run: `adb tcpip 5555`
2. Disconnect USB cable
3. Run "Scrcpy: Connect to Device over WiFi" and enter device IP (e.g., `192.168.1.100:5555`)

## Commands

| Command                               | Description                                       |
| ------------------------------------- | ------------------------------------------------- |
| `Scrcpy: Start Device Mirroring`      | Focus the view and connect to device              |
| `Scrcpy: Stop Device Mirroring`       | Disconnect from device                            |
| `Scrcpy: Connect to Device over WiFi` | Connect wirelessly (supports Android 11+ pairing) |
| `Scrcpy: Install APK`                 | Select and install an APK file on the device      |
| `Scrcpy: Upload Files to Device`      | Upload files or folders to /sdcard/Download/      |
| `Scrcpy: Open Settings`               | Open extension settings                           |

## Settings

Click the **gear icon** in the scrcpy view toolbar to access settings.

| Setting                        | Default | Description                                                        |
| ------------------------------ | ------- | ------------------------------------------------------------------ |
| `scrcpy.path`                  | (empty) | Path to scrcpy installation directory (with directory picker link) |
| `scrcpy.adbPath`               | (empty) | Path to ADB installation directory (with directory picker link)    |
| `scrcpy.apkInstallDefaultPath` | (empty) | Default folder for APK file picker (with directory picker link)    |
| `scrcpy.screenshotSavePath`    | (empty) | Default folder for screenshots (with directory picker link)        |
| `scrcpy.recordingSavePath`     | (empty) | Default folder for recordings (with directory picker link)         |
| `scrcpy.screenOff`             | `false` | Turn device screen off while mirroring                             |
| `scrcpy.stayAwake`             | `true`  | Keep device awake during mirroring                                 |
| `scrcpy.maxSize`               | `1920`  | Maximum screen dimension in pixels                                 |
| `scrcpy.bitRate`               | `8`     | Video bitrate in Mbps                                              |
| `scrcpy.maxFps`                | `60`    | Maximum frames per second                                          |
| `scrcpy.showTouches`           | `false` | Show visual touch feedback on device                               |
| `scrcpy.audio`                 | `true`  | Enable audio streaming (requires scrcpy 2.0+)                      |
| `scrcpy.clipboardSync`         | `true`  | Enable clipboard sync                                              |
| `scrcpy.autoConnect`           | `true`  | Auto-connect when devices are plugged in                           |
| `scrcpy.autoReconnect`         | `true`  | Auto-reconnect when connection is lost                             |
| `scrcpy.reconnectRetries`      | `2`     | Number of reconnection attempts                                    |
| `scrcpy.lockVideoOrientation`  | `false` | Lock video orientation                                             |
| `scrcpy.scrollSensitivity`     | `1.0`   | Mouse wheel scroll sensitivity (0.1-5.0)                           |
| `scrcpy.showStats`             | `false` | Show FPS statistics overlay                                        |

## Troubleshooting

### "No Android devices found"

- Ensure device is connected via USB
- Check `adb devices` shows your device as "device" (not "unauthorized")
- Accept the USB debugging prompt on your device

### "Failed to get scrcpy version"

- Ensure scrcpy is installed: `scrcpy --version`
- Ensure scrcpy is in your PATH, or set `scrcpy.path` in settings

### "Disconnected from device"

- This can happen if Android Studio or another tool restarts ADB
- The extension will automatically attempt to reconnect
- If auto-reconnect fails, click the **Reconnect** button

### Video not displaying

- Open DevTools in the Extension Development Host (Help > Toggle Developer Tools)
- Check console for WebCodecs errors

## Requirements

- VS Code 1.85.0 or higher
- ADB installed and accessible
- scrcpy installed (for server binary)

## License

Apache-2.0 (following scrcpy project)

## Credits

- [scrcpy](https://github.com/Genymobile/scrcpy) by Genymobile - The Android screen mirroring tool
