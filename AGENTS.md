# AGENTS.md

This file provides guidance to AI coding assistants when working with this repository.

## Project Overview

scrcpy-vscode is a VS Code extension that mirrors Android device screens directly in the editor. It uses the scrcpy server component running on the Android device and implements a custom client using WebCodecs for H.264 video decoding.

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
    └── InputHandler.ts   # Pointer event handling
```

## Key Files

- **ScrcpyViewProvider.ts**: WebviewView provider
  - Implements `vscode.WebviewViewProvider` for sidebar integration
  - Uses `DeviceManager` for multi-device support
  - Auto-connects first device when view becomes visible
  - Reads settings from `vscode.workspace.getConfiguration('scrcpy')`
  - Listens for config changes and auto-reconnects
  - Handles message passing between extension and webview
  - Generates HTML with tab bar (top), canvas container (center), control toolbar (bottom)

- **DeviceManager.ts**: Multi-device session management
  - Manages multiple `ScrcpyConnection` instances (one per device)
  - `getAvailableDevices()`: Lists connected ADB devices with model names
  - `addDevice()`: Connects to a specific device by serial
  - `removeDevice()`: Disconnects and removes a device session
  - `switchToDevice()`: Switches active device (pauses inactive, resumes active)
  - Prevents duplicate device connections
  - Notifies webview of session list changes

- **ScrcpyConnection.ts**: Core connection logic
  - Accepts `ScrcpyConfig` for configurable server parameters
  - Accepts optional `targetDeviceSerial` to connect to specific device
  - `connect()`: Discovers devices via `adb devices`
  - `startScrcpy()`: Starts server with config-based args
  - `handleScrcpyStream()`: Parses video protocol
  - `handleControlSocketData()`: Parses device messages (clipboard, ACKs)
  - `sendTouch()`: Sends touch control messages (32 bytes)
  - `sendKeyDown()` / `sendKeyUp()`: Sends separate key down/up events (14 bytes each)
  - Clipboard sync: Polls host clipboard every 1s, listens for device clipboard messages

- **VideoRenderer.ts**: H.264 decoding
  - Uses WebCodecs API in Annex B mode (no description)
  - Merges config packets with keyframes (like scrcpy client)
  - Extracts codec string from SPS
  - `pause()`: Stops rendering and clears frame queue (for inactive tabs)
  - `resume()`: Resumes rendering

## Protocol Notes

### Video Stream (from scrcpy server)
1. Device name: 64 bytes (UTF-8, null-padded)
2. Codec metadata: 12 bytes (codec_id + width + height)
3. Packets: 12-byte header (pts_flags + size) + data

### Control Messages (to scrcpy server)
- Touch events: 32 bytes (type=2, action, pointer_id, x, y, dimensions, pressure, buttons)
- Key events: 14 bytes (type=0, action, keycode, repeat, metastate)
- Set clipboard: variable (type=9, sequence 8 bytes, paste flag 1 byte, length 4 bytes, UTF-8 text)

### Device Messages (from scrcpy server via control socket)
- Clipboard: variable (type=0, length 4 bytes, UTF-8 text)
- ACK clipboard: 9 bytes (type=1, sequence 8 bytes)

### Connection Setup
1. `adb reverse localabstract:scrcpy_XXXX tcp:PORT`
2. Start server via `adb shell app_process`
3. Accept 2 connections: video first, then control
4. Video socket receives stream, control socket is bidirectional (sends touch/keys, receives clipboard)

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
1. Add keyboard event handler in `webview/main.ts`
2. Send keycode messages via `sendKeyDown()` / `sendKeyUp()` in `ScrcpyConnection.ts`
3. Or use INJECT_TEXT (type 1) for text strings

### Adding audio support
1. Set `audio=true` in server args
2. Accept 3rd socket connection (audio)
3. Implement audio decoding (Opus codec)

## Debugging

1. Extension logs: Check "Output" panel in VS Code
2. WebView logs: Help > Toggle Developer Tools in Extension Host
3. Server logs: `adb logcat | grep scrcpy`

## Testing

No automated tests yet. Manual testing:
1. Connect Android device(s)
2. Run extension (F5)
3. Click the Android Device icon in the Activity Bar (left sidebar)
4. Drag the view to the Secondary Sidebar (right side) for optimal placement
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
   - Copy text on host (VS Code) and verify it appears on device (paste in an app)
   - Copy text on device and verify it appears on host clipboard
   - Toggle `scrcpy.clipboardSync` setting and verify sync stops/starts
