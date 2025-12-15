# iOS Device Support Investigation

## Executive Summary

**Current State:** scrcpy-vscode is Android-only, using the scrcpy protocol over ADB.

**iOS Challenge:** There is no direct equivalent to scrcpy for iOS. iOS screen mirroring relies on Apple's proprietary AirPlay protocol, which requires reverse-engineering and has significant architectural differences from the Android approach.

**Recommendation:** A phased approach starting with `pymobiledevice3` for basic device management and screenshot capabilities, with potential future expansion to real-time streaming via AirPlay integration.

## Technical Comparison: Android vs iOS

| Aspect          | Android (scrcpy)                      | iOS                                                 |
| --------------- | ------------------------------------- | --------------------------------------------------- |
| **Protocol**    | Custom binary over ADB                | AirPlay (Apple proprietary)                         |
| **Connection**  | USB/WiFi via ADB                      | USB via libimobiledevice, WiFi via AirPlay          |
| **Server**      | scrcpy server (Java) pushed to device | No equivalent - must receive AirPlay stream         |
| **Video codec** | H.264/H.265/AV1                       | H.264 (AirPlay)                                     |
| **Control**     | Binary control messages over socket   | No standardized control protocol                    |
| **Device info** | ADB shell commands                    | libimobiledevice/pymobiledevice3                    |
| **Latency**     | ~35-70ms                              | ~100-200ms (AirPlay), higher for screenshot polling |

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

## Recommended Phased Approach

### Phase 1: Foundation (pymobiledevice3)

**Goal:** Basic iOS device support with screenshot capabilities.

**Features:**

- Device discovery via pymobiledevice3
- Device info display (model, iOS version, battery, storage)
- Single screenshot capture
- Basic device management UI (separate tab or device type indicator)

**Technical Requirements:**

- Python 3.9+ runtime dependency
- New `iOSConnection` class implementing device interface
- Device type detection (iOS vs Android)
- Screenshot display in webview

**Estimated Scope:** Medium

### Phase 2: Enhanced Features

**Goal:** Improved user experience with "live view" and app management.

**Features:**

- Screenshot polling for pseudo-live view (1-5 fps, user-configurable)
- App list viewing
- File operations (upload/download)
- Screenshot saving with timestamp

**Technical Requirements:**

- Efficient screenshot polling with configurable interval
- App list parsing and display
- File browser UI component

**Estimated Scope:** Medium

### Phase 3: Real-time Streaming (Future)

**Goal:** True real-time screen mirroring for iOS.

**Potential Approaches:**

1. **AirPlay Integration:**
   - Evaluate licensing options (separate tool vs integration)
   - Consider running UxPlay as external service
   - Stream via local network to webview

2. **Native Companion App:**
   - iOS app that captures screen and streams to extension
   - More control over protocol and features
   - Requires App Store distribution

3. **ScreenCaptureKit (macOS only):**
   - Use Apple's ScreenCaptureKit for Mac-connected iOS devices
   - Limited to macOS development machines

**Open Questions:**

- Which approach best balances features vs complexity?
- Is GPL-licensed code acceptable if isolated?
- Should we require a companion iOS app?

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
                        └── pymobiledevice3 (child_process)
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

### Phase 1 Dependencies

| Dependency      | Purpose                     | License | Installation                  |
| --------------- | --------------------------- | ------- | ----------------------------- |
| Python 3.9+     | Runtime for pymobiledevice3 | PSF     | System install                |
| pymobiledevice3 | iOS device communication    | MIT     | `pip install pymobiledevice3` |

### Alternative: Node.js Bindings

Instead of Python dependency, could create/use Node.js bindings for libimobiledevice:

- [node-libimobiledevice](https://github.com/nicholasareed/node-libimobiledevice) (outdated)
- Custom N-API bindings (significant development effort)

## Licensing Considerations

| Tool/Library     | License  | Compatible with Apache-2.0?    |
| ---------------- | -------- | ------------------------------ |
| pymobiledevice3  | MIT      | Yes                            |
| libimobiledevice | LGPL-2.1 | Yes (as library)               |
| libusbmuxd       | LGPL-2.1 | Yes (as library)               |
| UxPlay           | GPL-3.0  | No (would require relicensing) |
| tidevice3        | MIT      | Yes                            |

**Recommendation:** Use MIT-licensed pymobiledevice3 for Phase 1. Evaluate GPL implications separately if AirPlay streaming is pursued in Phase 3.

## Open Questions

1. **Python Dependency:** Should iOS support require users to install Python/pymobiledevice3, or should we bundle it?

2. **Node.js Alternative:** Is it worth investing in Node.js bindings for libimobiledevice to avoid Python dependency?

3. **AirPlay Licensing:** If we pursue AirPlay streaming, how do we handle GPL-3.0 licensing? Options:
   - Run as separate process (license boundary unclear)
   - Fork and relicense (requires contributor agreement)
   - Use alternative MIT-licensed implementation (none mature enough)

4. **Companion App:** Should we develop an iOS companion app for better streaming?
   - Pros: Full control, optimized protocol, App Store distribution
   - Cons: Development cost, ongoing maintenance, user friction

5. **Separate Extension:** Should iOS support be a separate VS Code extension?
   - Pros: Cleaner separation, optional dependency
   - Cons: User confusion, duplicate UI code

## Next Steps

1. Create proof-of-concept for pymobiledevice3 integration
2. Implement device detection (iOS vs Android)
3. Add basic iOS device info display
4. Implement screenshot capture for iOS
5. Evaluate user experience and decide on Phase 2 scope

## References

- [pymobiledevice3 GitHub](https://github.com/doronz88/pymobiledevice3)
- [libimobiledevice](https://libimobiledevice.org/)
- [UxPlay GitHub](https://github.com/antimof/UxPlay)
- [AirPlay Protocol Specification (unofficial)](https://nto.github.io/AirPlay.html)
- [scrcpy GitHub](https://github.com/Genymobile/scrcpy)
