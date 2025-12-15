# AGENTS.md

This file provides guidance to AI coding assistants when working with this repository.

For protocol details, architecture diagrams, and low-level implementation notes, see [docs/internals.md](./docs/internals.md).

## Project Overview

scrcpy-vscode is a VS Code extension that mirrors Android device screens directly in the editor. It uses the scrcpy server component running on the Android device and implements a custom client using WebCodecs for H.264 video decoding and Opus audio playback.

## Build Commands

```bash
# Install dependencies
npm install

# Build extension and webview
npm run compile

# Watch mode for development
npm run watch

# Run extension (press F5 in VS Code)
```

## Code Formatting & Linting

The project uses **Prettier** for code formatting and **ESLint** for linting TypeScript files.

```bash
# Format all files
npm run format

# Check formatting without changes (for CI)
npm run format:check

# Run ESLint
npm run lint

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

**Pre-commit hook**: Husky + lint-staged automatically formats and lints staged files before each commit.

**VS Code integration**: Format-on-save is enabled via `.vscode/settings.json`. Install the Prettier extension (`esbenp.prettier-vscode`) for best experience.

**Configuration files**:

- `.prettierrc.json` - Prettier settings (single quotes, trailing commas, 100 char width)
- `.prettierignore` - Files to skip formatting
- `.eslintrc.json` - ESLint rules with TypeScript support
- `.editorconfig` - Cross-editor settings for consistent formatting

## CI/CD

The project uses **GitHub Actions** for continuous integration and deployment.

**Workflow file**: `.github/workflows/ci.yml`

### Build Job (runs on every push/PR to main)

1. Checkout code
2. Setup Node.js 20
3. Install dependencies (`npm ci`)
4. Run linter (`npm run lint`)
5. Check formatting (`npm run format:check`)
6. Compile (`npm run compile`)
7. Run tests with coverage (`npm run test:coverage`)
8. Upload coverage report to Codecov

### Publish Job (runs only on version tags `v*`)

1. Build production package (`npm run package`)
2. Package extension (`vsce package`)
3. Publish to VS Code Marketplace
4. Publish to Open VSX Registry

### Required GitHub Secrets

Configure these in repository Settings > Secrets and variables > Actions:

| Secret     | Description                               | How to obtain                                                                            |
| ---------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `VSCE_PAT` | VS Code Marketplace Personal Access Token | Create at [Azure DevOps](https://dev.azure.com) with "Marketplace > Manage" scope        |
| `OVSX_PAT` | Open VSX Personal Access Token            | Create at [open-vsx.org/user-settings/tokens](https://open-vsx.org/user-settings/tokens) |

### Publishing a Release

1. Update version in `package.json`
2. Commit the version bump
3. Create and push a tag: `git tag v0.1.0 && git push origin v0.1.0`
4. The workflow automatically builds, verifies, and publishes to both marketplaces

## Project Structure

```
src/
├── extension.ts          # Entry point, registers provider and commands
├── ScrcpyViewProvider.ts # WebviewView provider for sidebar view
├── DeviceManager.ts      # Multi-device session management
├── ScrcpyConnection.ts   # ADB communication, scrcpy protocol
└── webview/
    ├── main.ts           # WebView entry, message handling, tab management
    ├── VideoRenderer.ts  # WebCodecs H.264 decoder (with pause/resume)
    ├── AudioRenderer.ts  # WebCodecs Opus decoder (with pause/resume/mute)
    ├── InputHandler.ts   # Pointer and scroll event handling
    └── KeyboardHandler.ts # Keyboard input (text injection + keycodes)
```

## Key Files

- **ScrcpyViewProvider.ts**: WebviewView provider
  - Implements `vscode.WebviewViewProvider` for sidebar integration
  - Uses `DeviceManager` for multi-device support
  - Auto-connects ALL available devices on startup (USB and WiFi already in ADB)
  - Reads settings from `vscode.workspace.getConfiguration('scrcpy')`
  - Listens for config changes and auto-reconnects
  - Handles message passing between extension and webview
  - Generates HTML with tab bar (top), canvas container (center), control toolbar (bottom)
  - Handles view lifecycle (move between sidebars, dispose/recreate) using `AbortController` to cancel stale async operations

- **DeviceManager.ts**: Multi-device session management
  - Manages multiple `ScrcpyConnection` instances (one per device)
  - `getAvailableDevices()`: Lists connected ADB devices with model names (excludes mDNS duplicates)
  - `addDevice()`: Connects to a specific device by serial, auto-switches to new device tab
  - `removeDevice()`: Disconnects and removes a device session
  - `switchToDevice()`: Switches active device (pauses inactive, resumes active with stored config)
  - `pairWifi()`: Pairs with a device using Android 11+ Wireless Debugging (`adb pair`)
  - `connectWifi()`: Connects to a device over WiFi using `adb connect`
  - `disconnectWifi()`: Disconnects a WiFi device using `adb disconnect`
  - Prevents duplicate device connections
  - Notifies webview of session list changes
  - Device monitoring: Uses `adb track-devices` for efficient push-based detection (no polling)
  - Auto-connect: New USB devices are connected automatically (WiFi excluded from auto-connect, but included in startup)
  - Auto-reconnect: Configurable retries (1-5) with 1.5s delay on unexpected disconnect (works for both USB and WiFi)
  - `takeScreenshot()`: Delegates to active session's connection for screenshot capture
  - `installApk()`: Installs APK on active device via `adb install`
  - `pushFiles()`: Uploads files/folders to active device in a single `adb push` command

- **ScrcpyConnection.ts**: Core connection logic
  - Accepts `ScrcpyConfig` for configurable server parameters
  - Accepts optional `targetDeviceSerial` to connect to specific device
  - Accepts optional `onError` callback for unexpected disconnects
  - `connect()`: Discovers devices via `adb devices`
  - `startScrcpy()`: Starts server with config-based args
  - `handleScrcpyStream()`: Parses video protocol
  - `handleAudioStream()`: Parses audio protocol (Opus codec)
  - `handleControlSocketData()`: Parses device messages (clipboard, ACKs)
  - `sendTouch()`: Sends touch control messages (32 bytes, uses stored `deviceWidth`/`deviceHeight` for coordinate mapping)
  - `sendScroll()`: Sends scroll control messages (21 bytes, uses 16-bit fixed-point encoding for scroll amounts)
  - `sendKeyDown()` / `sendKeyUp()`: Sends separate key down/up events (14 bytes each)
  - `rotateDevice()`: Rotates device screen counter-clockwise (1 byte control message)
  - `takeScreenshot()`: Captures device screen via `adb exec-out screencap -p` (original resolution, lossless PNG)
  - `updateDimensions()`: Updates stored dimensions when webview detects rotation via SPS parsing
  - Clipboard sync: On-demand via `pasteFromHost()` (Ctrl+V) and `copyToHost()` (Ctrl+C), listens for device clipboard messages
  - `installApk()`: Installs APK via `adb install -r`
  - `pushFiles()`: Uploads files/folders in a single `adb push` command (default destination: `/sdcard/Download/`)
  - Error handling: Reports unexpected disconnects via `onError` callback (shows reconnect UI)

- **VideoRenderer.ts**: H.264 decoding
  - Uses WebCodecs API in Annex B mode (no description)
  - Merges config packets with keyframes (like scrcpy client)
  - Extracts codec string from SPS
  - Parses SPS to detect dimension changes on rotation (notifies extension via `dimensionsChanged` message)
  - `fitToContainer()`: Sizes canvas to fit container while maintaining aspect ratio
  - `configure()`: Skips reconfiguration if dimensions unchanged (preserves canvas content on tab switch)
  - `pause()`: Stops rendering and clears frame queue (for inactive tabs)
  - `resume()`: Resumes rendering

- **AudioRenderer.ts**: Opus audio decoding and playback
  - Uses `opus-decoder` WASM library (WebCodecs Opus not supported in VS Code webviews)
  - Uses Web Audio API for scheduled playback
  - `pause()`: Stops playback (for inactive tabs)
  - `resume()`: Resumes playback
  - `setMuted()`: Toggles audio mute (for user control via toolbar button)

## Protocol Notes

### Video Stream (from scrcpy server)

1. Device name: 64 bytes (UTF-8, null-padded)
2. Codec metadata: 12 bytes (codec_id + width + height)
3. Packets: 12-byte header (pts_flags + size) + data

### Audio Stream (from scrcpy server, when audio=true)

1. Codec ID: 4 bytes (0x6f707573 = "opus")
2. Packets: 12-byte header (pts_flags + size) + Opus data

### Control Messages (to scrcpy server)

- Touch events: 32 bytes (type=2, action, pointer_id, x, y, dimensions, pressure, buttons)
- Scroll events: 21 bytes (type=3, x, y, dimensions, hScroll, vScroll, buttons)
- Key events: 14 bytes (type=0, action, keycode, repeat, metastate)
- Set clipboard: variable (type=9, sequence 8 bytes, paste flag 1 byte, length 4 bytes, UTF-8 text)
- Rotate device: 1 byte (type=11)

### Device Messages (from scrcpy server via control socket)

- Clipboard: variable (type=0, length 4 bytes, UTF-8 text)
- ACK clipboard: 9 bytes (type=1, sequence 8 bytes)

### Connection Setup

1. `adb reverse localabstract:scrcpy_XXXX tcp:PORT`
2. Start server via `adb shell app_process`
3. Accept 2 connections (audio=false) or 3 connections (audio=true): video, [audio], control
4. Video socket receives stream, audio socket receives Opus stream (if enabled)
5. Control socket is bidirectional (sends touch/keys, receives clipboard)

## Reference: scrcpy Source

The main scrcpy repository is at `/Users/izan/Dev/Projects/scrcpy/`. Key reference files:

- `server/src/main/java/com/genymobile/scrcpy/Options.java` - Server parameters
- `server/src/main/java/com/genymobile/scrcpy/device/DesktopConnection.java` - Socket handling
- `app/src/demuxer.c` - Protocol parsing (C client)
- `app/src/decoder.c` - Video decoding (FFmpeg)
- `app/src/packet_merger.h` - Config packet merging

## Common Tasks

### Adding a new setting

1. Add to `contributes.configuration` in `package.json`
2. Add to `ScrcpyConfig` interface in `ScrcpyConnection.ts`
3. Add to `_getConfig()` in `ScrcpyViewProvider.ts`
4. Use in `serverArgs` array in `ScrcpyConnection.ts`

### Adding a new server parameter (without UI)

1. Check `Options.java` in scrcpy for available parameters
2. Add to `serverArgs` array in `ScrcpyConnection.ts`

### Adding new control buttons

1. Add button HTML in `_getHtmlForWebview()` in `ScrcpyViewProvider.ts` with `data-keycode` attribute
2. The pointer event handlers in `webview/main.ts` automatically pick up new buttons
3. Buttons support long press (sends KEY_DOWN on press, KEY_UP on release)
4. Android keycodes: HOME=3, BACK=4, VOL_UP=24, VOL_DOWN=25, POWER=26, MENU=82, APP_SWITCH=187

### Adding text/keyboard input

Text/keyboard input is implemented via `KeyboardHandler.ts`:

- Click on canvas to enable keyboard input (blue outline indicates focus)
- Regular typing uses INJECT_TEXT (type 1) for efficient text injection
- Special keys (Enter, Backspace, Tab, arrows) use INJECT_KEYCODE (type 0)
- Modifier combos (Ctrl+C, etc.) use INJECT_KEYCODE with metastate
- Unfocusing the canvas releases any pressed keys

### Audio Implementation Notes

Audio support is implemented using:

1. `audio=true` and `audio_codec=opus` in server args (configured via `scrcpy.audio` setting)
2. 3rd socket connection for audio stream
3. `opus-decoder` WASM library for decoding (WebCodecs Opus is not supported in VS Code webviews)
4. Web Audio API for playback with scheduled buffer queueing
5. CSP includes `'wasm-unsafe-eval'` to allow WebAssembly compilation
6. Mute button in toolbar for user control

## Debugging

1. Extension logs: Check "Output" panel in VS Code
2. WebView logs: Help > Toggle Developer Tools in Extension Host
3. Server logs: `adb logcat | grep scrcpy`

## Testing

### Automated Tests

The project uses **Vitest** for unit and integration testing with **happy-dom** for browser environment simulation.

```bash
# Run all tests
npm test

# Watch mode for development
npm run test:watch

# Run with coverage report
npm run test:coverage

# Open Vitest UI
npm run test:ui
```

**Test structure:**

```
test/
├── unit/
│   ├── H264Utils.test.ts       # H.264 SPS parsing tests
│   ├── ScrcpyProtocol.test.ts  # Protocol constants tests
│   └── webview/
│       ├── InputHandler.test.ts    # Pointer/scroll event tests
│       └── KeyboardHandler.test.ts # Keyboard input tests
├── integration/
│   ├── DeviceManager.test.ts   # Device discovery & WiFi tests
│   └── ScrcpyConnection.test.ts # Connection & control tests
├── mocks/
│   ├── vscode.ts       # VS Code API mock
│   ├── child_process.ts # spawn/exec mock
│   └── net.ts          # Socket/Server mock
├── fixtures/
│   └── h264-samples.ts # H.264 NAL unit samples
└── setup.ts            # Global test setup
```

**Coverage:** Tests cover ~50% of the codebase overall, with webview code at ~96% coverage.

**CI Integration:** Tests run automatically on every push/PR via GitHub Actions with coverage reporting to Codecov.

### Manual Testing

1. Connect Android device(s)
2. Run extension (F5)
3. Click the scrcpy icon in the Activity Bar (left sidebar)
4. Drag the view to the Secondary Sidebar (right side) for optimal placement
   - The view can be moved between primary and secondary sidebars without issues
5. Verify video displays and touch works
6. Verify control buttons work (Volume, Back, Home, Recent Apps, Power)
   - Quick tap: should trigger single key press
   - Long press: should trigger long press action (e.g., hold Power for power menu)
7. Test multi-device support:
   - Click "+" button to add another device
   - Verify device picker shows available devices
   - Switch between tabs and verify only active tab renders video
   - Close tabs with "×" button and verify cleanup
8. Test clipboard sync:
   - Enable keyboard input by clicking on canvas
   - Press Ctrl+V (or Cmd+V on Mac) to paste from PC to device
   - Press Ctrl+C (or Cmd+C on Mac) to copy from device to PC
   - Toggle `scrcpy.clipboardSync` setting and verify sync is disabled
9. Test auto-connect:
   - Start with no devices connected (should show "No devices connected" with phone icon)
   - Plug in a device via USB
   - Verify device auto-connects instantly (uses `adb track-devices`, no polling delay)
   - Unplug device, verify error screen
   - Plug in again, verify auto-reconnects
   - Toggle `scrcpy.autoConnect` setting and verify behavior changes
   - Reload window (Cmd+R) and verify all devices (including WiFi) reconnect automatically
10. Test auto-reconnect:
    - Open Android Studio while connected (restarts ADB)
    - Verify "Reconnecting (attempt 1/2)..." status shows
    - If reconnect succeeds, verify video resumes
    - If reconnect fails after all attempts, verify error screen with phone icon
    - Click "Reconnect" button and verify manual reconnection works
    - Plug in device again after failure, verify auto-connect picks it up
11. Test keyboard input:
    - Click on canvas to enable keyboard (blue outline should appear)
    - Type text in an input field on the device and verify it appears
    - Test special keys: Enter, Backspace, Tab, Escape, arrow keys
    - Test modifier combos: Ctrl+A (select all), Ctrl+C (copy), Ctrl+V (paste)
    - Click outside canvas and verify keyboard is disabled (outline disappears)
    - Switch between device tabs and verify keyboard is disabled on switch
12. Test audio:
    - Play audio on device (music, video, etc.)
    - Verify audio is heard through PC speakers
    - Click mute button in toolbar and verify audio stops
    - Click mute button again to unmute
    - Switch device tabs and verify only active tab plays audio
    - Toggle `scrcpy.audio` setting and reconnect to verify audio is disabled
13. Test screen rotation:
    - Click rotate button (↺) in toolbar and verify device rotates counter-clockwise
    - Verify canvas resizes to match new orientation
    - Verify touch input still works correctly after rotation
    - Toggle `scrcpy.lockVideoOrientation` setting and reconnect
    - Rotate device physically and verify video stays fixed when lock is enabled
14. Test screenshots:
    - Click screenshot button (📷) in toolbar next to rotate button
    - Verify loading spinner appears on button while capturing
    - By default, screenshot saves to Downloads folder and opens in editor
    - Verify PNG has device's original resolution (not scaled) and lossless quality
    - Test `scrcpy.screenshotSavePath` setting to change default save location
    - Test `scrcpy.screenshotShowSaveDialog` setting to enable save dialog
15. Test mouse wheel scrolling:
    - Position mouse over the device view (no click required)
    - Use mouse wheel to scroll vertically
    - Verify content scrolls in the expected direction
    - Use horizontal scroll (if available on trackpad/mouse) to scroll horizontally
    - Test `scrcpy.scrollSensitivity` setting to adjust scroll speed (0.1-5.0, default 1.0)
16. Test WiFi connection (Android 11+ with pairing):
    - Enable wireless debugging on your Android device (Settings > Developer options > Wireless debugging)
    - Tap "Pair device with pairing code" to get the pairing address and code
    - Run command "Scrcpy: Connect to Device over WiFi" or click the WiFi icon in the view title
    - Select "Pair new device (Android 11+)"
    - Enter the pairing address (IP:port shown in the pairing dialog)
    - Enter the 6-digit pairing code
    - Verify pairing success notification appears
    - Enter the connection address from the main Wireless debugging screen (different from pairing address)
    - Verify device connects and video displays
    - Verify touch and control buttons work over WiFi
17. Test WiFi connection (legacy or already paired):
    - For devices already paired, or using legacy `adb tcpip 5555`
    - Run command "Scrcpy: Connect to Device over WiFi"
    - Select "Connect to paired device"
    - Enter the device IP address and port (e.g., 192.168.1.100:5555)
    - Verify connection progress notification appears
    - Verify device connects and video displays
18. Test APK install button:
    - Click the package icon (📦) in the view title bar
    - Verify file picker opens with APK filter
    - By default, file picker should open in Downloads folder
    - Test `scrcpy.apkInstallDefaultPath` setting to change default folder
    - Select an APK file and verify "Installing..." progress notification appears
    - Verify success notification appears when installation completes
    - Verify APK is installed on device
19. Test file upload button:
    - Click the cloud upload icon (☁️↑) in the view title bar (leftmost button)
    - Verify file/folder picker opens allowing multiple selection
    - By default, file picker should open in Downloads folder
    - Test single file upload: select one file and verify progress notification
    - Test multiple file upload: select several files and verify progress shows count
    - Test folder upload: select a folder and verify it uploads recursively (adb push handles this)
    - Test mixed selection: select files and folders together
    - Verify files appear in `/sdcard/Download/` on device
    - Verify summary notification shows success/failure count
