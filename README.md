# Scrcpy for VS Code

Display and control your Android device screen directly within VS Code, similar to Android Studio's "Running Devices" feature.

## Features

- View Android device screen in real-time
- Touch input support (tap, drag)
- Hardware-accelerated video decoding (WebCodecs API)
- Configurable video quality, resolution, and FPS
- Turn device screen off while mirroring (saves battery)
- Auto-detects installed scrcpy version
- Settings accessible via gear icon in view toolbar

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

1. Connect your Android device via USB (or enable wireless debugging)
2. Verify ADB sees your device: `adb devices`
3. Click the **Android Device** icon in the Activity Bar (left sidebar)
4. The device screen appears in the sidebar view
5. **Tip**: Drag the view to the Secondary Sidebar (right side) for optimal placement - VS Code remembers this position

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

## Architecture

```
scrcpy-vscode/
├── src/
│   ├── extension.ts          # Extension entry point, provider registration
│   ├── ScrcpyViewProvider.ts # WebviewView provider for sidebar integration
│   ├── ScrcpyConnection.ts   # ADB/scrcpy server communication
│   └── webview/
│       ├── main.ts           # WebView entry point, message handling
│       ├── VideoRenderer.ts  # WebCodecs H.264 decoder
│       └── InputHandler.ts   # Touch/mouse event handling
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
│ scrcpy-server│ ──H.264 stream──│ Extension Host  │
│ (captures    │      via        │ (ADB, sockets)  │
│  screen)     │     ADB         │       │         │
└──────────────┘                 │       ▼         │
       ▲                         │   WebView       │
       │                         │ (WebCodecs      │
       └── control messages ─────│  decoder +      │
           (touch events)        │  Canvas)        │
                                 └─────────────────┘
```

### Connection Flow

1. **Device Discovery**: `adb devices` to find connected devices
2. **Version Detection**: `scrcpy --version` to get installed version
3. **Server Push**: Push scrcpy-server.jar to device if not present
4. **Reverse Tunnel**: `adb reverse localabstract:scrcpy_XXXX tcp:PORT`
5. **Server Start**: Launch scrcpy server via `adb shell app_process`
6. **Socket Accept**: Accept two connections (video + control)
7. **Stream Processing**: Parse scrcpy protocol and decode H.264

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
- Click the "Settings" button in the error screen to configure the path

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

- Single device support (uses first detected device)
- Video only (audio forwarding not implemented)
- Touch input only (keyboard input not implemented)
- No rotation handling
- No clipboard sync

## Future Improvements

- [ ] Multi-device selection dialog
- [ ] Keyboard input support
- [ ] Audio forwarding
- [ ] Screen rotation handling
- [ ] Clipboard synchronization
- [ ] Wireless ADB support
- [ ] Status bar with FPS/bitrate info

## Requirements

- VS Code 1.85.0 or higher
- Node.js 18.x or higher (for development)
- ADB installed and accessible
- scrcpy installed (for server binary)

## License

Apache-2.0 (following scrcpy project)

## Credits

- [scrcpy](https://github.com/Genymobile/scrcpy) by Genymobile - The Android screen mirroring tool
