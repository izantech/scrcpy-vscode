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
├── ScrcpyConnection.ts   # ADB communication, scrcpy protocol
└── webview/
    ├── main.ts           # WebView entry, message handling
    ├── VideoRenderer.ts  # WebCodecs H.264 decoder
    └── InputHandler.ts   # Pointer event handling
```

## Key Files

- **ScrcpyViewProvider.ts**: WebviewView provider
  - Implements `vscode.WebviewViewProvider` for sidebar integration
  - Auto-connects when view becomes visible
  - Handles message passing between extension and webview
  - Creates HTML content with VS Code theme variables

- **ScrcpyConnection.ts**: Core connection logic
  - `connect()`: Discovers devices via `adb devices`
  - `startScrcpy()`: Starts server, accepts video+control sockets
  - `handleScrcpyStream()`: Parses video protocol
  - `sendTouch()`: Sends control messages

- **VideoRenderer.ts**: H.264 decoding
  - Uses WebCodecs API in Annex B mode (no description)
  - Merges config packets with keyframes (like scrcpy client)
  - Extracts codec string from SPS

## Protocol Notes

### Video Stream (from scrcpy server)
1. Device name: 64 bytes (UTF-8, null-padded)
2. Codec metadata: 12 bytes (codec_id + width + height)
3. Packets: 12-byte header (pts_flags + size) + data

### Control Messages (to scrcpy server)
- Touch events: 32 bytes (type, action, pointer_id, x, y, dimensions, pressure, buttons)

### Connection Setup
1. `adb reverse localabstract:scrcpy_XXXX tcp:PORT`
2. Start server via `adb shell app_process`
3. Accept 2 connections: video first, then control
4. Video socket receives stream, control socket receives touch commands

## Reference: scrcpy Source

The main scrcpy repository is at `/Users/izan/Dev/Projects/scrcpy/`. Key reference files:

- `server/src/main/java/com/genymobile/scrcpy/Options.java` - Server parameters
- `server/src/main/java/com/genymobile/scrcpy/device/DesktopConnection.java` - Socket handling
- `app/src/demuxer.c` - Protocol parsing (C client)
- `app/src/decoder.c` - Video decoding (FFmpeg)
- `app/src/packet_merger.h` - Config packet merging

## Common Tasks

### Adding a new server parameter
1. Check `Options.java` in scrcpy for available parameters
2. Add to `serverArgs` array in `ScrcpyConnection.ts`

### Adding keyboard input
1. Add key event handler in `InputHandler.ts`
2. Implement `sendKey()` in `ScrcpyConnection.ts`
3. Use control message type 0 (INJECT_KEYCODE)

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
1. Connect Android device
2. Run extension (F5)
3. Click the Android Device icon in the Activity Bar (left sidebar)
4. Drag the view to the Secondary Sidebar (right side) for optimal placement
5. Verify video displays and touch works
