# Changelog

All notable changes to the "Scrcpy for VS Code" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Touch ripple visualization** - Show animated ripple circles at touch points when enabled via `scrcpy.showTouchRipples` setting (useful for screen recordings and demos)

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
