# Scrcpy for VS Code

Display and control your Android device screen directly within VS Code, similar to Android Studio's "Running Devices" feature.

## Features

- **Multi-device support** with tab bar for switching between devices
- View Android device screen in real-time
- **Audio streaming** - hear device audio with mute button (requires scrcpy 2.0+)
- Touch input support (tap, drag)
- **Keyboard input** - click canvas to enable typing, with modifier support (Ctrl, Alt, Shift)
- **Device control buttons** with long press support (Volume, Back, Home, Recent Apps, Power)
- **Clipboard sync** - Ctrl+V pastes from PC to device, Ctrl+C copies from device to PC
- **Auto-connect** - automatically connects when devices are plugged in
- **Auto-reconnect** - automatic reconnection on disconnect (configurable retries)
- Hardware-accelerated video decoding (WebCodecs API)
- Configurable video quality, resolution, and FPS
- Turn device screen off while mirroring (saves battery)
- Auto-detects installed scrcpy version
- Settings accessible via gear icon in view toolbar
- Resource-efficient: inactive device tabs pause video and audio streaming

## Prerequisites

1. **ADB installed and in PATH**
   - macOS: `brew install android-platform-tools`
   - Linux: `sudo apt install adb`
   - Windows: Download [Platform Tools](https://developer.android.com/studio/releases/platform-tools)

2. **scrcpy installed** (for the server component)
   - macOS: `brew install scrcpy`
   - Linux: `sudo apt install scrcpy`
   - Windows: Download from [scrcpy releases](https://github.com/Genymobile/scrcpy/releases)

3. **Android device connected** via USB with USB debugging enabled
   - Enable Developer Options: Settings > About Phone > Tap "Build number" 7 times
   - Enable USB Debugging: Settings > Developer Options > USB Debugging

## Usage

1. Connect your Android device(s) via USB (or enable wireless debugging)
2. Verify ADB sees your device: `adb devices`
3. Click the **Android Device** icon in the Activity Bar (left sidebar)
4. The first device automatically connects and appears in the sidebar view
5. **Tip**: Drag the view to the Secondary Sidebar (right side) for optimal placement - VS Code remembers this position

### Multi-Device Support

- Click the **+** button in the tab bar to add another device
- A device picker shows all available devices (excluding already connected ones)
- Switch between devices by clicking their tabs
- Close a device connection by clicking the **×** on its tab
- Only the active tab streams video (saves resources)

## Commands

| Command | Description |
|---------|-------------|
| `Scrcpy: Start` | Focus the view and connect to device |
| `Scrcpy: Stop` | Disconnect from device |
| `Scrcpy: Open Settings` | Open extension settings |

## Settings

Click the **gear icon** in the scrcpy view toolbar to access settings. Changes apply immediately.

| Setting | Default | Description |
|---------|---------|-------------|
| `scrcpy.path` | (empty) | Path to scrcpy installation directory (leave empty to use PATH) |
| `scrcpy.screenOff` | `false` | Turn device screen off while mirroring (saves battery) |
| `scrcpy.stayAwake` | `true` | Keep device awake during mirroring |
| `scrcpy.maxSize` | `1920` | Maximum screen dimension in pixels (720/1080/1440/1920) |
| `scrcpy.bitRate` | `8` | Video bitrate in Mbps (2/4/8/16/32) |
| `scrcpy.maxFps` | `60` | Maximum frames per second (15/30/60) |
| `scrcpy.showTouches` | `false` | Show visual touch feedback on device screen |
| `scrcpy.audio` | `true` | Enable audio streaming from device (requires scrcpy 2.0+) |
| `scrcpy.clipboardSync` | `true` | Enable clipboard sync (Ctrl+V to paste, Ctrl+C to copy) |
| `scrcpy.autoConnect` | `true` | Automatically connect to devices when they are plugged in |
| `scrcpy.autoReconnect` | `true` | Automatically attempt to reconnect when connection is lost |
| `scrcpy.reconnectRetries` | `2` | Number of reconnection attempts (1/2/3/5) |

## Architecture

```
scrcpy-vscode/
├── src/
│   ├── extension.ts          # Extension entry point, provider registration
│   ├── ScrcpyViewProvider.ts # WebviewView provider for sidebar integration
│   ├── DeviceManager.ts      # Multi-device session management
│   ├── ScrcpyConnection.ts   # ADB/scrcpy server communication
│   └── webview/
│       ├── main.ts           # WebView entry point, tab management
│       ├── VideoRenderer.ts  # WebCodecs H.264 decoder (with pause/resume)
│       ├── AudioRenderer.ts  # Opus decoder using opus-decoder WASM library
│       ├── InputHandler.ts   # Touch/mouse event handling
│       └── KeyboardHandler.ts # Keyboard input (text + keycodes)
├── dist/                     # Compiled output
│   ├── extension.js          # Main extension bundle
│   └── webview/
│       └── main.js           # WebView bundle
└── package.json              # Extension manifest
```

### Data Flow

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

### Connection Flow

1. **Device Discovery**: `adb devices` to find connected devices
2. **Version Detection**: `scrcpy --version` to get installed version
3. **Server Push**: Push scrcpy-server.jar to device if not present
4. **Reverse Tunnel**: `adb reverse localabstract:scrcpy_XXXX tcp:PORT`
5. **Server Start**: Launch scrcpy server via `adb shell app_process`
6. **Socket Accept**: Accept 2 connections (video + control) or 3 if audio enabled (video + audio + control)
7. **Stream Processing**: Parse scrcpy protocol and decode H.264 video + Opus audio

### Protocol Details

**Video Stream Format:**

1. Device name (64 bytes, null-padded UTF-8)
2. Codec metadata (12 bytes): codec_id (4) + width (4) + height (4)
3. Video packets: pts_flags (8) + size (4) + data

**PTS Flags (8 bytes):**

- Bit 63: Config packet (SPS/PPS)
- Bit 62: Keyframe
- Bits 0-61: PTS value

**Control Messages (Touch) - 32 bytes:**

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

**Control Messages (Key Event) - 14 bytes:**

```
Offset  Size  Field
0       1     Type (0 = INJECT_KEYCODE)
1       1     Action (0=down, 1=up)
2       4     Keycode (Android AKEYCODE_*)
6       4     Repeat count
10      4     Metastate
```

**Android Keycodes used:**

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

**Control Messages (Inject Text) - Variable length:**

```
Offset  Size  Field
0       1     Type (1 = INJECT_TEXT)
1       4     Text length (big-endian)
5       n     UTF-8 text data (max 300 bytes)
```

**Control Messages (Set Clipboard) - Variable length:**

```
Offset  Size  Field
0       1     Type (9 = SET_CLIPBOARD)
1       8     Sequence number
9       1     Paste flag (0=no, 1=yes)
10      4     Text length (big-endian)
14      n     UTF-8 text data
```

**Device Messages (Clipboard) - Variable length:**

```
Offset  Size  Field
0       1     Type (0 = CLIPBOARD)
1       4     Text length (big-endian)
5       n     UTF-8 text data
```

### Video Decoding

Uses WebCodecs API following the same approach as the native scrcpy client:

1. **Config Storage**: SPS/PPS packets are stored when received
2. **Packet Merging**: Config is prepended to the next keyframe (like `sc_packet_merger`)
3. **Annex B Format**: Data passed with start codes, no avcC description
4. **Codec String**: Derived from SPS profile/constraint/level bytes

## Configuration

Server parameters are configurable via VS Code settings (see [Settings](#settings) above).

The extension reads your settings and passes them to the scrcpy server. If scrcpy is not in your PATH, you can set the `scrcpy.path` setting to point to your scrcpy installation directory.

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
- The extension will automatically attempt to reconnect (up to 2 times)
- If auto-reconnect fails, click the **Reconnect** button to try again
- Check that the device is still connected via USB

### "Timeout waiting for device connection"

- Check device screen for any permission prompts
- Try running `scrcpy` directly to verify it works
- Check `adb logcat | grep scrcpy` for server errors

### Video not displaying

- Open DevTools in the Extension Development Host
- Check console for WebCodecs errors
- Ensure your VS Code version supports WebCodecs

### Touch not working

- Verify video is displaying first
- Check that control socket is connected (console logs)
- Ensure device has touch permissions for scrcpy

## Known Limitations

- No rotation handling
- Audio requires scrcpy 2.0+ and a device that supports audio capture

## Future Improvements

- [x] ~~Multi-device support~~ ✅ Implemented (tab bar with device switching)
- [x] ~~Clipboard synchronization~~ ✅ Implemented (Ctrl+V/Ctrl+C for paste/copy)
- [x] ~~Hardware button controls~~ ✅ Implemented (with long press support)
- [x] ~~Text/keyboard input~~ ✅ Implemented (click canvas to enable, supports modifiers)
- [x] ~~Audio forwarding~~ ✅ Implemented (Opus via opus-decoder WASM library)
- [ ] Screen rotation handling
- [ ] Wireless ADB support

## Requirements

- VS Code 1.85.0 or higher
- Node.js 18.x or higher (for development)
- ADB installed and accessible
- scrcpy installed (for server binary)

## License

Apache-2.0 (following scrcpy project)

## Credits

- [scrcpy](https://github.com/Genymobile/scrcpy) by Genymobile - The Android screen mirroring tool
