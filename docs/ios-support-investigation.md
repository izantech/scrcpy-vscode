# iOS Device Support Investigation

## Executive Summary

**Current State:** scrcpy-vscode is Android-only, using the scrcpy protocol over ADB.

**iOS Challenge:** There is no direct equivalent to scrcpy for iOS. iOS screen mirroring relies on Apple's proprietary AirPlay protocol, which requires reverse-engineering and has significant architectural differences from the Android approach.

**Recommendation:** For macOS users, use **CoreMediaIO + AVFoundation** (same technology as QuickTime) for real-time USB streaming. For cross-platform support, fall back to `pymobiledevice3` for basic device management and screenshot capabilities.

## Technical Comparison: Android vs iOS

| Aspect          | Android (scrcpy)                      | iOS                                                         |
| --------------- | ------------------------------------- | ----------------------------------------------------------- |
| **Protocol**    | Custom binary over ADB                | CoreMediaIO (macOS), AirPlay (WiFi), libimobiledevice (USB) |
| **Connection**  | USB/WiFi via ADB                      | USB via CoreMediaIO/libimobiledevice, WiFi via AirPlay      |
| **Server**      | scrcpy server (Java) pushed to device | No server needed - iOS exposes as AVCaptureDevice on macOS  |
| **Video codec** | H.264/H.265/AV1                       | H.264 (native frames via AVFoundation)                      |
| **Control**     | Binary control messages over socket   | No standardized control protocol                            |
| **Device info** | ADB shell commands                    | libimobiledevice/pymobiledevice3                            |
| **Latency**     | ~35-70ms                              | ~50-100ms (CoreMediaIO), ~100-200ms (AirPlay)               |

## iOS Mirroring Options Analysis

### Option A: AirPlay Receiver (UxPlay-based)

**Description:** Implement an AirPlay receiver that iOS devices can connect to for screen mirroring.

**Tools:**

- [UxPlay](https://github.com/antimof/UxPlay) - Most mature open-source AirPlay receiver
- [RPiPlay](https://github.com/FD-/RPiPlay) - Raspberry Pi optimized (less actively maintained)

**Pros:**

- Real-time streaming with low latency
- Mature implementation with iOS 9+ support
- H.264/H.265 hardware-accelerated decoding
- Audio streaming support (AAC-ELD, ALAC)

**Cons:**

- GPL-3.0 license (incompatible with our Apache-2.0)
- Requires iOS device to initiate connection (user must select receiver from Control Center)
- Limited control support (no standardized touch/keyboard protocol)
- Complex protocol implementation
- Requires mDNS/Bonjour for device discovery

### Option B: pymobiledevice3 Integration (Recommended for Phase 1)

**Description:** Use Python-based iOS device communication library for device management and screenshot capture.

**Tools:**

- [pymobiledevice3](https://github.com/doronz88/pymobiledevice3) - Pure Python implementation of libimobiledevice
- [tidevice3](https://pypi.org/project/tidevice3/) - CLI wrapper around pymobiledevice3

**Pros:**

- MIT license (compatible with Apache-2.0)
- Pure Python, easy to integrate
- Active development, supports iOS 17+
- Rich feature set: device info, screenshots, app management, file operations
- Works on macOS, Windows, Linux

**Cons:**

- No real-time streaming (screenshot polling only)
- Realistic refresh rate: ~1-5 fps
- Requires Python 3.9+ installation
- Higher latency than native streaming

**Capabilities:**

- Device discovery and listing
- Device info (model, iOS version, UDID, battery, storage)
- Screenshot capture (`pymobiledevice3 developer dvt screenshot`)
- App listing and management
- File system operations
- Developer image mounting

### Option C: tidevice3 CLI Wrapper

**Description:** Simplified CLI tool built on pymobiledevice3.

**Pros:**

- Simple command-line interface
- Screen recording to file (`t3 screenrecord out.mp4`)
- Easy to call from Node.js

**Cons:**

- No real-time streaming
- Limited feature set compared to pymobiledevice3
- Recording outputs to file, not live stream

### Option D: Custom AirPlay Implementation

**Description:** Build a custom AirPlay receiver optimized for VS Code integration.

**Pros:**

- Full control over implementation
- Could be optimized for VS Code webview
- Potential for tighter integration

**Cons:**

- Massive engineering effort
- Requires reverse-engineering Apple protocols
- Ongoing maintenance burden as Apple updates protocols
- Would take months to implement properly

### Option E: CoreMediaIO + AVFoundation (macOS only) ⭐ RECOMMENDED

**Description:** Use Apple's native frameworks to capture iOS screen via USB, the same technology QuickTime uses for "Movie Recording" from iOS devices.

**How it works:**

1. Enable screen capture devices via CoreMediaIO:

   ```swift
   var prop = CMIOObjectPropertyAddress(
       mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
       mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
       mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain)
   )
   var allow: UInt32 = 1
   CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &prop, 0, nil, UInt32(MemoryLayout.size(ofValue: allow)), &allow)
   ```

2. Get iOS device as AVCaptureDevice:

   ```swift
   let device = AVCaptureDevice.default(for: .muxed)  // .muxed = video + audio
   ```

3. Capture frames via standard AVCaptureSession

**Pros:**

- Native macOS framework (no external dependencies)
- Real-time streaming with low latency (~50-100ms)
- Same technology QuickTime uses - proven and reliable
- Includes audio capture (`.muxed` type)
- No license concerns (Apple framework)
- USB-based = stable connection

**Cons:**

- **macOS only** - won't work on Windows/Linux
- Requires native code (Swift/Objective-C helper or Node.js native addon)
- No touch/keyboard control (display only)
- Devices take a moment to appear after enabling

**Implementation Options:**

1. **Swift CLI helper**: Small Swift executable that captures frames and outputs to stdout/socket
2. **Node.js native addon**: Use N-API to call CoreMediaIO/AVFoundation directly
3. **Electron approach**: If VS Code webview limitations are hit, could use Electron's native module support

**References:**

- [Apple Developer Forums - AVFoundation iOS capture](https://developer.apple.com/forums/thread/94744)
- [IOSCaptureSample-withDAL](https://github.com/jyu0414/IOSCaptureSample-withDAL) - Sample code for iOS screen capture on macOS
- [CoreMediaIO DAL Plugin Example](https://github.com/johnboiles/coremediaio-dal-minimal-example)

## Recommended Phased Approach

### Phase 1: CoreMediaIO Streaming (macOS)

**Goal:** Real-time iOS screen mirroring on macOS using native frameworks.

**Features:**

- iOS device discovery via CoreMediaIO/AVFoundation
- Real-time video streaming (same as QuickTime)
- Audio capture support
- Device info display

**Technical Requirements:**

- Swift CLI helper binary (bundled with extension for macOS)
- Frame streaming via stdout or local socket
- Platform detection to enable only on macOS

**Estimated Scope:** Medium

### Phase 2: Cross-platform Fallback (pymobiledevice3)

**Goal:** Basic iOS support for Windows/Linux users.

**Features:**

- Device discovery via pymobiledevice3
- Device info display (model, iOS version, battery, storage)
- Screenshot capture (single frame or polling)
- Basic device management UI

**Technical Requirements:**

- Python 3.9+ runtime dependency (or bundled)
- New `iOSConnection` class implementing device interface
- Screenshot polling for pseudo-live view (1-5 fps)

**Estimated Scope:** Medium

### Phase 3: Enhanced Features

**Goal:** Feature parity improvements across platforms.

**Features:**

- App list viewing
- File operations (upload/download)
- Screenshot saving with timestamp
- Improved device info UI

**Technical Requirements:**

- App list parsing and display
- File browser UI component

**Estimated Scope:** Medium

### Phase 4: Touch Control (Future Research)

**Goal:** Investigate touch/keyboard control for iOS.

**Potential Approaches:**

1. **WebDriverAgent:** Appium's WebDriverAgent for touch injection (requires developer signing)
2. **Accessibility APIs:** Limited control via accessibility features
3. **Companion App:** iOS app that receives and injects touch events

**Note:** This is significantly more complex than Android's scrcpy control and may not be feasible without a companion app.

## Architecture Changes Required

### Current Architecture (Android-only)

```
Extension
    └── ScrcpyViewProvider
        └── DeviceManager
            └── DeviceSession
                └── ScrcpyConnection
                    └── ADB (child_process)
```

### Proposed Architecture (Multi-platform)

```
Extension
    └── ScrcpyViewProvider
        └── DeviceManager
            └── DeviceSession
                └── IDeviceConnection (interface)
                    ├── ScrcpyConnection (Android)
                    │   └── ADB (child_process)
                    └── iOSConnection (iOS)
                        ├── CoreMediaIOHelper (macOS - Swift CLI)
                        └── pymobiledevice3 (Windows/Linux - Python CLI)
```

### Key Abstractions to Introduce

1. **IDeviceConnection Interface**

   ```typescript
   interface IDeviceConnection {
     connect(): Promise<void>;
     disconnect(): Promise<void>;
     getDeviceInfo(): Promise<DeviceInfo>;
     takeScreenshot(): Promise<Buffer>;
     // Platform-specific methods optional
   }
   ```

2. **Extended DeviceInfo**

   ```typescript
   interface DeviceInfo {
     serial: string;
     name: string;
     model?: string;
     platform: 'android' | 'ios'; // NEW
   }
   ```

3. **Platform-agnostic Configuration**
   - Shared settings (screenshot path, etc.)
   - Platform-specific settings (scrcpy codec for Android, screenshot interval for iOS)

## Dependencies

### Phase 1 Dependencies (macOS - CoreMediaIO)

| Dependency       | Purpose                  | License       | Installation                   |
| ---------------- | ------------------------ | ------------- | ------------------------------ |
| CoreMediaIO      | iOS device video capture | Apple (macOS) | Built into macOS               |
| AVFoundation     | Video/audio capture API  | Apple (macOS) | Built into macOS               |
| Swift CLI helper | Bridge to Node.js        | Apache-2.0    | Bundled with extension (macOS) |

### Phase 2 Dependencies (Cross-platform - pymobiledevice3)

| Dependency      | Purpose                     | License | Installation                  |
| --------------- | --------------------------- | ------- | ----------------------------- |
| Python 3.9+     | Runtime for pymobiledevice3 | PSF     | System install                |
| pymobiledevice3 | iOS device communication    | MIT     | `pip install pymobiledevice3` |

### Alternative: Node.js Bindings

Instead of Python dependency, could create/use Node.js bindings for libimobiledevice:

- [node-libimobiledevice](https://github.com/nicholasareed/node-libimobiledevice) (outdated)
- Custom N-API bindings (significant development effort)

## Licensing Considerations

| Tool/Library     | License       | Compatible with Apache-2.0?    |
| ---------------- | ------------- | ------------------------------ |
| CoreMediaIO      | Apple (macOS) | Yes (system framework)         |
| AVFoundation     | Apple (macOS) | Yes (system framework)         |
| pymobiledevice3  | MIT           | Yes                            |
| libimobiledevice | LGPL-2.1      | Yes (as library)               |
| libusbmuxd       | LGPL-2.1      | Yes (as library)               |
| UxPlay           | GPL-3.0       | No (would require relicensing) |
| tidevice3        | MIT           | Yes                            |

**Recommendation:** Use CoreMediaIO/AVFoundation for macOS (no license concerns - system frameworks). Use MIT-licensed pymobiledevice3 for cross-platform fallback.

## Open Questions

1. **Swift CLI vs Node.js Addon:** Should we build a Swift CLI helper that pipes frames, or a Node.js native addon that calls CoreMediaIO directly?
   - CLI: Easier to build and debug, separate process
   - Addon: Better performance, single process, more complex build

2. **Frame Format:** What format should the Swift helper output?
   - Raw BGRA frames (simple but large bandwidth)
   - JPEG frames (compressed, lower quality)
   - H.264 stream (complex but efficient, matches Android)

3. **Cross-platform Fallback:** Should we require Python/pymobiledevice3 for Windows/Linux, or skip iOS support on those platforms initially?

4. **Touch Control:** Is touch control a hard requirement for full parity? Options:
   - WebDriverAgent (requires Apple Developer account)
   - Companion iOS app (App Store distribution)
   - Accept display-only limitation initially

5. **Separate Extension:** Should iOS support be a separate VS Code extension?
   - Pros: Cleaner separation, optional macOS binary
   - Cons: User confusion, duplicate UI code

## Next Steps

1. Create proof-of-concept Swift CLI for CoreMediaIO capture on macOS
2. Test frame streaming to Node.js (stdout/socket)
3. Integrate with existing webview video renderer
4. Implement device detection (iOS vs Android)
5. Add iOS device tab support in UI
6. Evaluate cross-platform options for Phase 2

## References

- [pymobiledevice3 GitHub](https://github.com/doronz88/pymobiledevice3)
- [libimobiledevice](https://libimobiledevice.org/)
- [UxPlay GitHub](https://github.com/antimof/UxPlay)
- [AirPlay Protocol Specification (unofficial)](https://nto.github.io/AirPlay.html)
- [scrcpy GitHub](https://github.com/Genymobile/scrcpy)
