# Changelog

All notable changes to the "Scrcpy for VS Code" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - iOS Support (feature/ios branch)

### Added

- **iOS device support (macOS only)** - Mirror iOS device screens directly in VS Code
  - Uses CoreMediaIO/AVFoundation for native screen capture via Swift helper binary
  - Automatic device discovery and connection
  - H.264 video streaming with hardware decoding
  - Platform-aware UI showing Apple icon for iOS devices
  - **Video source selection** - Use `scrcpy.videoSource` (`display`/`camera`) to choose iOS screen capture vs Continuity Camera
  - **Window capture fallback** - Automatically detects iPhone Mirroring or AirPlay windows when CoreMediaIO device unavailable (macOS 26+)
- **iOS preview tool** - Standalone CLI for testing iOS capture outside VS Code
  - `npm run ios:preview -- list --video-source display` to list capture sources
  - `npm run ios:preview -- preview <UDID>` to preview capture with FPS counter
  - Useful for debugging screen recording permissions and device detection
- **WebDriverAgent integration** - Optional touch/keyboard input for iOS devices
  - Tap, swipe, and scroll gestures via WDA HTTP API
  - Keyboard text input support
  - Home, Back (swipe gesture), and Volume control buttons
  - Recents button available on devices with physical home button (iPhone 8, SE, older)
  - iproxy USB port forwarding for WDA connection
  - WDA status indicator in device tooltip (connected/connecting/unavailable/disabled)
  - **WDA overlay button** - Shows "Start WDA" pill button on iOS video when touch input is unavailable, allowing quick launch of WDA
  - **In-extension WDA setup** - Click overlay button to run WebDriverAgent setup directly in VS Code
  - Progress states shown on button (Checking Xcode, Building, Starting, etc.)
  - Modal dialogs guide user through required actions (install Xcode, configure signing, connect device)
  - Button shows spinner during setup, "Action Required" state when user input needed, error state with retry option
  - **Rotation control** - Rotate iOS device screen via WDA when connected
  - **Clipboard sync** - Bidirectional clipboard sync between PC and iOS device (Ctrl+C/Ctrl+V)
  - **App launcher** - Launch iOS apps by bundle ID, with searchable app list
    - App listing uses `ideviceinstaller` (works without WDA connection)
    - App launching requires WDA (shows helpful error with instructions if not connected)
    - Prompts to install `ideviceinstaller` via Homebrew if not found
- **iOS screenshots** - Native screenshot capture via ios-helper binary
  - Uses AVFoundation single-frame capture
  - Outputs lossless PNG at device resolution
- **Platform abstraction layer** - `IDeviceConnection` interface for cross-platform support
  - `PlatformCapabilities` defines per-platform feature availability with granular button controls
  - Separate capabilities for Home, Back, Recents buttons (not a single `supportsSystemButtons`)
  - Dynamic capability updates based on WDA connection status and device model
  - Common interface methods for rotation (`rotate`), clipboard (`pasteFromHost`, `copyToHost`), and app management (`launchApp`, `getInstalledApps`)
  - Platform-agnostic app list format (`appId`, `displayName`) works across Android (package name) and iOS (bundle ID)
- **iOS-specific settings**
  - `scrcpy.ios.enabled` - Enable/disable iOS device support (auto-enabled on macOS)
  - `scrcpy.ios.webDriverAgentEnabled` - Enable/disable WDA input control
  - `scrcpy.ios.webDriverAgentPort` - WDA port (default: 8100)
- **iOS setup commands**
  - `Setup iOS Input Control (WebDriverAgent)` - Guided one-time setup for WDA
  - `Start iOS Input Control` - Launch WDA for touch/keyboard input

### Changed

- Refactored `DeviceService` to support multiple connection types (Android/iOS)
- Platform-neutral status messages and error handling
- Control buttons now respect platform capabilities (volume buttons shown only when supported)
- Moved WiFi connection to overflow menu (less prominent, cleaner toolbar)
- iOS setup commands now appear in overflow menu on macOS

### Fixed

- Fixed iOS streaming crash in `ios-helper` when converting H.264 AVCC NAL units to Annex B
- Fixed `ios-helper` path resolution so the packaged extension can find the bundled binary under `dist/`
- Fixed iOS screen capture device discovery on macOS 26.x by auto-starting `iOSScreenCaptureAssistant`
- Fixed WDA touch coordinates when video dimensions differ from device screen (window capture mode)
  - Now fetches actual device screen size from WDA for accurate touch mapping
- Removed dead code (`getIOSDevicesFromContinuityCamera`) superseded by window capture fallback
- **Fixed iOS touch events not being sent** - Touch down action (action=0) was incorrectly filtered due to JavaScript falsy check
- **Updated WDA client to use W3C Actions API** - Migrated from legacy `/wda/touch/perform` endpoint to standard W3C WebDriver Actions API (`/actions`) for tap and swipe gestures
- **Improved iOS scroll performance** - Now uses WDA's native `/wda/scroll` endpoint with direction/distance instead of slow swipe gestures
- **Reduced iOS input latency** - Touch and scroll are now fire-and-forget (don't wait for WDA response), session is pre-created on connection, and scroll events are debounced to prevent stuttering
- **Added iOS Back gesture** - Wide swipe from left edge to right (90% of screen width) simulates iOS native back navigation
- **Device-aware Recents button** - Recents button (double home tap) only shown on devices with physical home button; hidden on Face ID devices where the gesture isn't supported via WDA
- **Improved WDA startup reliability** - Script now waits up to 30 seconds with retry loop instead of failing after 5 seconds; starts iproxy before xcodebuild; shows progress indicator during connection attempts
- **iOS permission error handling** - Shows user-friendly error notification with "Open Settings" button when Screen Recording permission is missing
  - Detects CoreMediaIO permission errors (status 268435459) and launchctl kickstart failures (exit code 150)
  - Provides clear guidance on how to grant Screen Recording permission in System Settings
  - ios-preview CLI tool auto-opens System Settings to the Screen Recording panel when permission error detected
  - Permission error notification shown only once per session to avoid spam
- **iOS lifecycle management** - iOS helper is now preloaded at extension startup when iOS support is enabled
  - Helper is only loaded if `scrcpy.iosSupport` setting is enabled
  - When user enables iOS support via settings, helper is preloaded automatically
  - When user disables iOS support via settings, all iOS connections are stopped and resources cleaned up
  - iOS capture is prewarmed when user clicks an iOS device tab for faster initial connection
- **Fixed ios-helper binary being killed (SIGKILL/exit code 137)** - Copying the binary to dist invalidated code signature
  - Webpack now re-signs the binary after copying with `codesign --force --sign -`
  - Also clears extended attributes (`xattr -c`) that could cause TCC rejection
- **Single ios-helper process enforcement** - Prevents multiple concurrent ios-helper processes
  - TypeScript: Concurrent device list calls return the same promise instead of spawning new processes
  - Swift: New list operation kills any previous list processes before running
- **iOS device info in tooltip** - Device tooltip now shows real iOS device info (battery, iOS version, storage, model name) via `ideviceinfo` from libimobiledevice
  - Maps ProductType identifiers to human-readable model names (iPhone 16 Pro Max, iPad Air M2, etc.)
  - Resolves CoreMediaIO UID to real iOS UDID for libimobiledevice compatibility
  - Graceful fallback when libimobiledevice is not installed
- **Improved tooltip layout** - Input status (✅/❌) now displayed on bottom row with battery info; aligned icons with fixed-width column
- **Capability-based menu visibility** - Menu items now use capability context variables (e.g., `scrcpy.supportsAppLaunch`) instead of platform checks, enabling dynamic updates when WDA connects/disconnects
- **Fixed WDA setup iproxy lifecycle** - Setup script process now kept alive after completion so iproxy continues running for touch input
- **iOS screen lock detection via libimobiledevice** - Replaced unreliable WDA `isLocked` polling with `ideviceinfo` lock detection
  - Uses lockdownd error code -17 (PASSWORD_PROTECTED) to detect locked state
  - Works independently of WDA - lock detection available even without WebDriverAgent
  - Shows "Device screen is off - wake device to resume" overlay when device is locked
  - Automatically hides overlay when device is unlocked

### Known Issues

- **iOS screen capture on macOS 26 / iOS 26** - On macOS 26.x with iOS 26.x (including 26.1), the CoreMediaIO screen capture device may not appear until Screen Recording permission is granted and `iOSScreenCaptureAssistant` is running. If screen capture isn't available, set `scrcpy.videoSource` to `camera` to use Continuity Camera instead.

### Documentation

- Added iOS input control research documentation
- Added WebDriverAgent setup guide with troubleshooting
- Updated AGENTS.md with iOS architecture and manual testing instructions

## [Unreleased] - Control Center

### Changed

- **Redesigned Control Center** - Complete visual overhaul with floating opaque sections (Display, Appearance, Audio & Volume, System Shortcuts, Accessibility, Developer)
- **Floating sections** - Removed container wrapper, sections now float independently with opaque backgrounds
- **Collapsible sections** - Click section headers to collapse/expand, state persists across sessions via localStorage
- **New setting icons** - Each setting now has a distinctive colorful gradient icon (moon for dark mode, palette for appearance group, accessibility symbols, etc.)
- **Cycle buttons** - Replaced segmented controls with cycle buttons for Orientation, Dark Mode, and Navigation Mode that cycle through options on click
- **Improved control contrast** - Enhanced toggle switches, sliders, and buttons with better visibility against dark backgrounds
- **Clickable toggle rows** - Entire row is now clickable to toggle switches, not just the switch itself
- **Compact layout** - Control center uses 75% width with hidden scrollbars, extends to toolbar edge
- **Toolbar reorganization** - Power button moved to left group, Control Center button moved to right group
- **OKLCH gradient mask** - Perceptually uniform fade effect at top edge when scrolling
- **Renamed to Control Center** - Full codebase refactor from "Device Settings" to "Control Center"

### Added

- **Display group** - New settings group with screen orientation control (Auto/Portrait/Landscape)
- **Proper orientation control** - Orientation button now sets device rotation lock via ADB settings instead of just rotating 90°
- **Audio & Volume group** - Consolidated audio forwarding toggle with volume up/down buttons
- **System Shortcuts group** - Quick access to Notification Panel and Settings Panel
- **WiFi connection timeout** - Added 15 second timeout to prevent hanging on unreachable devices
- **Control Center button active state** - Button highlights when Control Center is open (like macOS)
- **Dimmed toolbar** - Other toolbar buttons dim when Control Center is open
- **Click outside to close** - Clicking anywhere outside Control Center closes it
- **Dynamic scroll fade** - Top fade effect only appears when scrolled down
- Localization strings for new settings groups and controls

### Fixed

- **Orientation change stale frame** - Canvas now clears immediately when changing orientation to avoid displaying outdated frames while waiting for new video stream
- **Cycle button width** - Fixed width prevents slider resizing when label text changes
- **Orientation flash** - Fixed brief wrong orientation when switching modes by setting user_rotation before disabling auto-rotate

### Removed

- **Contextual dropdown menu** - Replaced by unified Control Center popup with all controls
- **Standalone rotation button** - Orientation now controlled via Display group in Control Center
- **Select to Speak toggle** - Removed as it's incompatible with scrcpy's touch injection

## [0.1.3] - 2025-12-16

### Added

- **Tool availability check** - Extension now checks for ADB and scrcpy at startup and displays a warning alert when tools are missing
- **Custom ADB path setting** - New `scrcpy.adbPath` setting to specify custom ADB installation directory
- **Improved empty state UI** - Redesigned warning alert with title/subtitle layout and pill-shaped buttons
- **Directory picker links in settings** - All path settings now include "Choose directory" and "Reset" links directly in the settings UI
- **Command emojis** - Added descriptive emojis to all commands for better visual identification in menus

### Changed

- Removed VS Code notification popup for missing tools in favor of inline warning alert
- Warning alert now shows structured title ("Missing dependency") with detailed subtitle message
- Buttons in empty state now use pill shape for modern appearance
- Simplified command titles by removing "Scrcpy:" prefix for cleaner menu display
- **State management refactored** - Centralized all application state in `AppStateManager` with single source of truth pattern
- Renamed `DeviceManager` to `DeviceService` with state delegation to `AppStateManager`
- Webview now receives unified `stateSnapshot` messages instead of multiple partial update messages
- Removed legacy message handlers (`sessionList`, `connectionStateChanged`, `settings`, `toolStatus`)

### Fixed

- Tool status UI not updating after resetting path settings from invalid to valid paths
- Added status bar feedback when updating or resetting path settings
- Eliminated state duplication between extension host and webview
- Fixed potential race conditions from partial state updates
- Canvas now properly resizes when frame dimensions change (e.g., device rotation)
- Status overlays scoped per device tab and stale device info cleared on disconnect

## [0.1.2] - 2025-12-15

### Changed

- Updated extension icon to official scrcpy icon with "unofficial" ribbon

### Fixed

- Correct extension ID in settings command

## [0.1.1] - 2025-12-15

### Changed

- Reduced extension package size from 717 KB to 134 KB by improving `.vscodeignore`

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

[0.1.3]: https://github.com/izantech/scrcpy-vscode/releases/tag/0.1.3
[0.1.2]: https://github.com/izantech/scrcpy-vscode/releases/tag/0.1.2
[0.1.1]: https://github.com/izantech/scrcpy-vscode/releases/tag/0.1.1
[0.1.0]: https://github.com/izantech/scrcpy-vscode/releases/tag/0.1.0
