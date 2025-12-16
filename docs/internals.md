# Internals

Technical documentation for developers working on the scrcpy-vscode extension.

## Architecture

```
scrcpy-vscode/
├── src/
│   ├── extension.ts          # Extension entry point, provider registration
│   ├── ScrcpyViewProvider.ts # WebviewView provider for sidebar integration
│   ├── AppStateManager.ts    # Centralized state management (single source of truth)
│   ├── DeviceService.ts      # Multi-device session management
│   ├── ScrcpyConnection.ts   # ADB/scrcpy server communication
│   ├── ScrcpyProtocol.ts     # Protocol constants and codec IDs
│   ├── types/
│   │   ├── AppState.ts       # State interfaces (DeviceState, AppStateSnapshot, etc.)
│   │   └── WebviewActions.ts # Typed actions from webview to extension
│   └── webview/
│       ├── main.ts           # WebView entry point, tab management
│       ├── VideoRenderer.ts  # WebCodecs H.264/H.265/AV1 decoder (with pause/resume)
│       ├── AudioRenderer.ts  # Opus decoder using opus-decoder WASM library
│       ├── InputHandler.ts   # Touch/mouse/scroll/gesture event handling
│       ├── KeyboardHandler.ts # Keyboard input (text + keycodes)
│       ├── CodecUtils.ts     # Video codec detection and configuration
│       ├── RecordingManager.ts # Screen recording to WebM/MP4
│       └── WebviewTemplate.ts # HTML template generation
├── dist/                     # Compiled output
│   ├── extension.js          # Main extension bundle
│   └── webview/
│       └── main.js           # WebView bundle
└── package.json              # Extension manifest
```

## State Management

The extension uses centralized state management through `AppStateManager`:

```
┌─────────────────────────────────────────────────────────┐
│                    AppStateManager                       │
│              (Single Source of Truth)                    │
├─────────────────────────────────────────────────────────┤
│ • devices: Map<serial, DeviceState>                     │
│ • activeDeviceId: string | null                         │
│ • settings: ScrcpyConfig                                │
│ • toolStatus: { adb, scrcpy }                           │
│ • statusMessage: string                                 │
│ • deviceInfo: Map<serial, DeviceInfo>                   │
├─────────────────────────────────────────────────────────┤
│ subscribe() → StateSnapshot on every change             │
│ (batched via microtask scheduling)                      │
└─────────────────────────────────────────────────────────┘
        │
        ▼ stateSnapshot messages
┌─────────────────────────────────────────────────────────┐
│                      WebView                             │
│           (Receives unified state updates)               │
└─────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Single Source of Truth**: All state lives in `AppStateManager`
2. **Unidirectional Flow**: WebView receives snapshots, sends typed actions back
3. **Batched Updates**: Multiple state mutations are batched into single snapshot
4. **No State Duplication**: WebView renders from received state, doesn't store copies

### State Types

- `DeviceState`: Connection status, error info per device
- `AppStateSnapshot`: Complete state sent to webview
- `WebviewActions`: Typed action messages from webview to extension

## Data Flow

```
Android Device                    VS Code Extension
┌──────────────┐                 ┌─────────────────┐
│ scrcpy-server│ ──H.264+Opus────│ Extension Host  │
│ (captures    │   streams via   │ (ADB, sockets)  │
│  screen +    │     ADB         │       │         │
│  audio)      │                 │       ▼         │
└──────────────┘                 │   WebView       │
       ▲                         │ (WebCodecs +    │
       │                         │  opus-decoder   │
       └── control messages ─────│  + Canvas)      │
           (touch, clipboard)    └─────────────────┘
```

## Connection Flow

1. **Device Discovery**: `adb devices` to find connected devices
2. **Version Detection**: `scrcpy --version` to get installed version
3. **Server Push**: Push scrcpy-server.jar to device if not present
4. **Reverse Tunnel**: `adb reverse localabstract:scrcpy_XXXX tcp:PORT`
5. **Server Start**: Launch scrcpy server via `adb shell app_process`
6. **Socket Accept**: Accept 2 connections (video + control) or 3 if audio enabled (video + audio + control)
7. **Stream Processing**: Parse scrcpy protocol and decode H.264 video + Opus audio

## Protocol Details

### Video Stream Format

1. Device name (64 bytes, null-padded UTF-8)
2. Codec metadata (12 bytes): codec_id (4) + width (4) + height (4)
3. Video packets: pts_flags (8) + size (4) + data

### PTS Flags (8 bytes)

- Bit 63: Config packet (SPS/PPS)
- Bit 62: Keyframe
- Bits 0-61: PTS value

### Control Messages (Touch) - 32 bytes

```
Offset  Size  Field
0       1     Type (2 = INJECT_TOUCH_EVENT)
1       1     Action (0=down, 1=up, 2=move)
2       8     Pointer ID (-1 for mouse/finger)
10      4     X position
14      4     Y position
18      2     Screen width
20      2     Screen height
22      2     Pressure (0xFFFF = full, 0 = up)
24      4     Action button
28      4     Buttons
```

### Control Messages (Scroll) - 21 bytes

```
Offset  Size  Field
0       1     Type (3 = INJECT_SCROLL_EVENT)
1       4     X position
5       4     Y position
9       2     Screen width
11      2     Screen height
13      2     Horizontal scroll (16-bit signed fixed-point)
15      2     Vertical scroll (16-bit signed fixed-point)
17      4     Buttons
```

Note: Scroll values are encoded as 16-bit signed fixed-point numbers. The value is normalized to [-1, 1] range and multiplied by 32768 (2^15).

### Control Messages (Key Event) - 14 bytes

```
Offset  Size  Field
0       1     Type (0 = INJECT_KEYCODE)
1       1     Action (0=down, 1=up)
2       4     Keycode (Android AKEYCODE_*)
6       4     Repeat count
10      4     Metastate
```

### Android Keycodes

- `AKEYCODE_HOME` (3) - Home button
- `AKEYCODE_BACK` (4) - Back button
- `AKEYCODE_VOLUME_UP` (24) - Volume Up
- `AKEYCODE_VOLUME_DOWN` (25) - Volume Down
- `AKEYCODE_POWER` (26) - Power button
- `AKEYCODE_ENTER` (66) - Enter key
- `AKEYCODE_DEL` (67) - Backspace key
- `AKEYCODE_TAB` (61) - Tab key
- `AKEYCODE_ESCAPE` (111) - Escape key
- `AKEYCODE_DPAD_UP/DOWN/LEFT/RIGHT` (19-22) - Arrow keys
- `AKEYCODE_APP_SWITCH` (187) - Recent Apps

### Control Messages (Inject Text) - Variable length

```
Offset  Size  Field
0       1     Type (1 = INJECT_TEXT)
1       4     Text length (big-endian)
5       n     UTF-8 text data (max 300 bytes)
```

### Control Messages (Set Clipboard) - Variable length

```
Offset  Size  Field
0       1     Type (9 = SET_CLIPBOARD)
1       8     Sequence number
9       1     Paste flag (0=no, 1=yes)
10      4     Text length (big-endian)
14      n     UTF-8 text data
```

### Control Messages (Rotate Device) - 1 byte

```
Offset  Size  Field
0       1     Type (11 = ROTATE_DEVICE)
```

### Device Messages (Clipboard) - Variable length

```
Offset  Size  Field
0       1     Type (0 = CLIPBOARD)
1       4     Text length (big-endian)
5       n     UTF-8 text data
```

## Video Decoding

Uses WebCodecs API following the same approach as the native scrcpy client:

1. **Config Storage**: SPS/PPS packets are stored when received
2. **Packet Merging**: Config is prepended to the next keyframe (like `sc_packet_merger`)
3. **Annex B Format**: Data passed with start codes, no avcC description
4. **Codec String**: Derived from SPS profile/constraint/level bytes

## Development

```bash
# Install dependencies
npm install

# Build
npm run compile

# Watch mode
npm run watch

# Press F5 in VS Code to launch Extension Development Host
```

### Debugging

1. Open the project in VS Code
2. Press F5 to launch Extension Development Host
3. In the new window, run "Scrcpy: Start"
4. Open DevTools: Help > Toggle Developer Tools
5. Check console for logs

## Reference: scrcpy Source

The main scrcpy repository is at https://github.com/Genymobile/scrcpy. Key reference files:

- `server/src/main/java/com/genymobile/scrcpy/Options.java` - Server parameters
- `server/src/main/java/com/genymobile/scrcpy/device/DesktopConnection.java` - Socket handling
- `app/src/demuxer.c` - Protocol parsing (C client)
- `app/src/decoder.c` - Video decoding (FFmpeg)
- `app/src/packet_merger.h` - Config packet merging
