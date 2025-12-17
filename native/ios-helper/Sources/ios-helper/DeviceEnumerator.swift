import AVFoundation
import CoreMediaIO

/// Device information structure
struct IOSDeviceInfo: Codable {
    let udid: String
    let name: String
    let model: String
    let isCameraFallback: Bool  // True if screen capture is unavailable and using camera as fallback

    init(udid: String, name: String, model: String, isCameraFallback: Bool = false) {
        self.udid = udid
        self.name = name
        self.model = model
        self.isCameraFallback = isCameraFallback
    }
}

/// Manages iOS device discovery via CoreMediaIO/AVFoundation
class DeviceEnumerator {

    /// Enable CoreMediaIO screen capture devices
    /// This is required before iOS devices appear as AVCaptureDevice
    static func enableScreenCaptureDevices() {
        var property = CMIOObjectPropertyAddress(
            mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
            mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
            mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain)
        )

        var allow: UInt32 = 1
        let dataSize = UInt32(MemoryLayout<UInt32>.size)

        CMIOObjectSetPropertyData(
            CMIOObjectID(kCMIOObjectSystemObject),
            &property,
            0,
            nil,
            dataSize,
            &allow
        )
    }

    /// List ALL CoreMediaIO devices directly (for debugging)
    static func listAllCoreMediaIODevices() {
        fputs("\n[DeviceEnumerator] === CoreMediaIO Direct Device Enumeration ===\n", stderr)

        // Get all devices from CoreMediaIO
        var propertyAddress = CMIOObjectPropertyAddress(
            mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices),
            mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
            mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain)
        )

        var dataSize: UInt32 = 0
        var status = CMIOObjectGetPropertyDataSize(
            CMIOObjectID(kCMIOObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            &dataSize
        )

        guard status == noErr else {
            fputs("[DeviceEnumerator] Failed to get device list size: \(status)\n", stderr)
            return
        }

        let deviceCount = Int(dataSize) / MemoryLayout<CMIODeviceID>.size
        fputs("[DeviceEnumerator] CoreMediaIO reports \(deviceCount) device(s)\n", stderr)

        guard deviceCount > 0 else {
            fputs("[DeviceEnumerator] No CoreMediaIO devices found\n", stderr)
            return
        }

        var devices = [CMIODeviceID](repeating: 0, count: deviceCount)
        status = CMIOObjectGetPropertyData(
            CMIOObjectID(kCMIOObjectSystemObject),
            &propertyAddress,
            0,
            nil,
            dataSize,
            &dataSize,
            &devices
        )

        guard status == noErr else {
            fputs("[DeviceEnumerator] Failed to get device list: \(status)\n", stderr)
            return
        }

        for deviceID in devices {
            let name = getDeviceName(deviceID) ?? "Unknown"
            let uid = getDeviceUID(deviceID) ?? "Unknown"
            let isScreen = isScreenCaptureDevice(deviceID)
            fputs("  - Device ID \(deviceID): \(name) [UID: \(uid)] \(isScreen ? "[SCREEN]" : "")\n", stderr)
        }

        fputs("[DeviceEnumerator] === End CoreMediaIO Enumeration ===\n\n", stderr)
    }

    /// Get device name from CoreMediaIO device ID
    private static func getDeviceName(_ deviceID: CMIODeviceID) -> String? {
        var propertyAddress = CMIOObjectPropertyAddress(
            mSelector: CMIOObjectPropertySelector(kCMIOObjectPropertyName),
            mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
            mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain)
        )

        var name: CFString? = nil
        var dataSize = UInt32(MemoryLayout<CFString?>.size)

        let status = CMIOObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            dataSize,
            &dataSize,
            &name
        )

        guard status == noErr, let deviceName = name else {
            return nil
        }

        return deviceName as String
    }

    /// Get device UID from CoreMediaIO device ID
    private static func getDeviceUID(_ deviceID: CMIODeviceID) -> String? {
        var propertyAddress = CMIOObjectPropertyAddress(
            mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceUID),
            mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
            mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain)
        )

        var uid: CFString? = nil
        var dataSize = UInt32(MemoryLayout<CFString?>.size)

        let status = CMIOObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            dataSize,
            &dataSize,
            &uid
        )

        guard status == noErr, let deviceUID = uid else {
            return nil
        }

        return deviceUID as String
    }

    /// Check if device is a screen capture device
    private static func isScreenCaptureDevice(_ deviceID: CMIODeviceID) -> Bool {
        // Check if this is marked as a screen capture device
        // by looking for specific properties or naming patterns
        if let name = getDeviceName(deviceID) {
            // Screen devices typically don't have "Camera" in the name
            return !name.lowercased().contains("camera")
        }
        return false
    }

    /// Get list of connected iOS devices (screen capture, not cameras)
    static func getIOSDevices() -> [IOSDeviceInfo] {
        enableScreenCaptureDevices()

        // Short delay to allow devices to appear
        Thread.sleep(forTimeInterval: 0.5)

        // Debug: list all CoreMediaIO devices directly
        listAllCoreMediaIODevices()

        var devices: [IOSDeviceInfo] = []

        // Method 0: Try the default muxed device (as suggested by Apple forums)
        if let defaultMuxed = AVCaptureDevice.default(for: .muxed) {
            fputs("[DeviceEnumerator] Default muxed device: \(defaultMuxed.localizedName) [\(defaultMuxed.uniqueID)]\n", stderr)
            let name = defaultMuxed.localizedName
            let udid = defaultMuxed.uniqueID
            if !name.lowercased().contains("camera") {
                if let model = determineModel(from: name, isScreenDevice: true) {
                    fputs("[DeviceEnumerator] Adding default muxed device: \(name) [\(udid)] as \(model)\n", stderr)
                    devices.append(IOSDeviceInfo(udid: udid, name: name, model: model))
                }
            }
        } else {
            fputs("[DeviceEnumerator] No default muxed device found\n", stderr)
        }

        // Try multiple discovery methods to find iOS screen capture devices
        // Method 1: Look for muxed (video+audio) devices - typical for screen capture
        let muxedDiscovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external],
            mediaType: .muxed,
            position: .unspecified
        )

        fputs("[DeviceEnumerator] Muxed devices found: \(muxedDiscovery.devices.count)\n", stderr)
        for device in muxedDiscovery.devices {
            fputs("  - [muxed] \(device.localizedName) [\(device.uniqueID)]\n", stderr)
        }

        // Method 2: Also check video-only devices
        let videoDiscovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external],
            mediaType: .video,
            position: .unspecified
        )

        fputs("[DeviceEnumerator] Video devices found: \(videoDiscovery.devices.count)\n", stderr)
        for device in videoDiscovery.devices {
            fputs("  - [video] \(device.localizedName) [\(device.uniqueID)]\n", stderr)
        }

        // Method 3: Check all external devices with nil mediaType (shows everything)
        let allExternalDiscovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external],
            mediaType: nil,
            position: .unspecified
        )

        fputs("[DeviceEnumerator] All external devices (nil mediaType): \(allExternalDiscovery.devices.count)\n", stderr)
        for device in allExternalDiscovery.devices {
            let hasVideo = device.hasMediaType(.video)
            let hasAudio = device.hasMediaType(.audio)
            let hasMuxed = device.hasMediaType(.muxed)
            fputs("  - [all] \(device.localizedName) [\(device.uniqueID)] video=\(hasVideo) audio=\(hasAudio) muxed=\(hasMuxed)\n", stderr)
        }

        // Combine both, preferring muxed devices (screen) over video-only (camera)
        var seenUDIDs = Set<String>()

        // First add muxed devices (these are typically screens)
        for device in muxedDiscovery.devices {
            let name = device.localizedName
            let udid = device.uniqueID

            // Skip camera devices
            if name.lowercased().contains("camera") {
                fputs("[DeviceEnumerator] Skipping camera device: \(name)\n", stderr)
                continue
            }

            seenUDIDs.insert(udid)

            // This is a muxed (video+audio) non-camera device - likely a screen
            if let model = determineModel(from: name, isScreenDevice: true) {
                fputs("[DeviceEnumerator] Adding muxed screen device: \(name) [\(udid)] as \(model)\n", stderr)
                devices.append(IOSDeviceInfo(udid: udid, name: name, model: model))
            }
        }

        // Then add video devices we haven't seen yet (that aren't cameras)
        for device in videoDiscovery.devices {
            let name = device.localizedName
            let udid = device.uniqueID

            // Skip if we already have this device or if it's a camera
            if seenUDIDs.contains(udid) || name.lowercased().contains("camera") {
                if !seenUDIDs.contains(udid) {
                    fputs("[DeviceEnumerator] Skipping camera device: \(name)\n", stderr)
                }
                continue
            }

            // This is a video-only non-camera device - might be a screen
            if let model = determineModel(from: name, isScreenDevice: true) {
                fputs("[DeviceEnumerator] Adding video screen device: \(name) [\(udid)] as \(model)\n", stderr)
                devices.append(IOSDeviceInfo(udid: udid, name: name, model: model))
            }
        }

        // Finally, check all external devices in case we missed any screen devices
        for device in allExternalDiscovery.devices {
            let name = device.localizedName
            let udid = device.uniqueID

            // Skip if already seen, is a camera, or doesn't have video/muxed capability
            if seenUDIDs.contains(udid) {
                continue
            }

            if name.lowercased().contains("camera") {
                continue
            }

            // Must have video or muxed capability
            guard device.hasMediaType(.video) || device.hasMediaType(.muxed) else {
                continue
            }

            seenUDIDs.insert(udid)

            if let model = determineModel(from: name, isScreenDevice: true) {
                fputs("[DeviceEnumerator] Adding external screen device: \(name) [\(udid)] as \(model)\n", stderr)
                devices.append(IOSDeviceInfo(udid: udid, name: name, model: model))
            }
        }

        // If no screen devices found, try to detect iOS devices via Continuity Camera
        if devices.isEmpty {
            fputs("\n[DeviceEnumerator] No screen capture devices found, trying Continuity Camera fallback...\n", stderr)
            devices = getIOSDevicesFromContinuityCamera()
        }

        return devices
    }

    /// Determine device model from name
    /// Returns "iOS Device" for devices that don't match known patterns but appear to be iOS devices
    private static func determineModel(from name: String, isScreenDevice: Bool = false) -> String? {
        let lowerName = name.lowercased()
        if lowerName.contains("iphone") {
            return "iPhone"
        } else if lowerName.contains("ipad") {
            return "iPad"
        } else if lowerName.contains("ipod") {
            return "iPod"
        }

        // If this is identified as a screen device (not camera), include it as iOS Device
        // This handles cases where the device has a custom name
        if isScreenDevice {
            fputs("[DeviceEnumerator] Device '\(name)' doesn't match known iOS patterns, but is a screen device\n", stderr)
            return "iOS Device"
        }

        return nil  // Skip non-iOS devices
    }

    /// Extract base device name from camera device name
    /// e.g., "iPhone de Izan Camera" -> "iPhone de Izan"
    private static func extractBaseDeviceName(from cameraName: String) -> String {
        // Remove " Camera" suffix if present
        if cameraName.hasSuffix(" Camera") {
            return String(cameraName.dropLast(7))
        }
        // Remove " Desk View Camera" suffix if present
        if cameraName.hasSuffix(" Desk View Camera") {
            return String(cameraName.dropLast(17))
        }
        return cameraName
    }

    /// Get UDID prefix from camera UID (removes the suffix like 00000001)
    /// e.g., "75806487-CBC7-416B-87D2-A16C00000001" -> "75806487-CBC7-416B-87D2-A16C"
    private static func getUDIDPrefix(from uid: String) -> String? {
        // Camera UIDs end with 00000001 or 00000002
        // The base UDID is everything before the last 8 characters
        guard uid.count >= 8 else { return nil }
        return String(uid.dropLast(8))
    }

    /// Get devices from Continuity Camera as fallback when screen capture is unavailable
    /// This allows detecting iOS devices even when USB screen mirroring isn't available
    static func getIOSDevicesFromContinuityCamera() -> [IOSDeviceInfo] {
        fputs("\n[DeviceEnumerator] Checking Continuity Camera devices as fallback...\n", stderr)

        var devices: [IOSDeviceInfo] = []
        var seenPrefixes = Set<String>()

        // Check video devices for Continuity Camera
        let videoDiscovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external],
            mediaType: .video,
            position: .unspecified
        )

        for device in videoDiscovery.devices {
            let name = device.localizedName

            // Look for camera devices that indicate an iOS device is connected
            if name.lowercased().contains("camera") && !name.lowercased().contains("facetime") {
                // Check if it's an iOS device camera (has iPhone/iPad in name)
                if let model = determineModel(from: name, isScreenDevice: false) {
                    let baseName = extractBaseDeviceName(from: name)
                    if let prefix = getUDIDPrefix(from: device.uniqueID), !seenPrefixes.contains(prefix) {
                        seenPrefixes.insert(prefix)
                        // Use the prefix + "00000000" as a synthetic UDID for the screen device
                        let syntheticUDID = prefix + "00000000"
                        fputs("[DeviceEnumerator] Found iOS device via Continuity Camera: \(baseName) [synthetic UDID: \(syntheticUDID)]\n", stderr)
                        fputs("[DeviceEnumerator] WARNING: Screen capture may not be available. Using camera device for detection.\n", stderr)
                        devices.append(IOSDeviceInfo(udid: syntheticUDID, name: baseName, model: model, isCameraFallback: true))
                    }
                }
            }
        }

        return devices
    }

    /// Find a specific device by UDID (screen capture, not camera)
    /// Also handles synthetic UDIDs from Continuity Camera fallback
    static func findDevice(udid: String) -> AVCaptureDevice? {
        enableScreenCaptureDevices()

        // Small delay to allow devices to appear
        Thread.sleep(forTimeInterval: 0.3)

        // Try muxed devices first (screen capture)
        let muxedDiscovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external],
            mediaType: .muxed,
            position: .unspecified
        )

        // Then video devices
        let videoDiscovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external],
            mediaType: .video,
            position: .unspecified
        )

        // Debug: log all available devices
        fputs("[DeviceEnumerator] Looking for UDID: \(udid)\n", stderr)
        fputs("[DeviceEnumerator] Available devices:\n", stderr)

        for device in muxedDiscovery.devices {
            let isCamera = device.localizedName.lowercased().contains("camera")
            fputs("  - [muxed] \(device.localizedName) [\(device.uniqueID)] \(isCamera ? "(camera)" : "(screen)")\n", stderr)
        }
        for device in videoDiscovery.devices {
            let isCamera = device.localizedName.lowercased().contains("camera")
            fputs("  - [video] \(device.localizedName) [\(device.uniqueID)] \(isCamera ? "(camera)" : "(screen)")\n", stderr)
        }

        // First try to find in muxed devices (preferred for screen capture)
        let muxedDevice = muxedDiscovery.devices.first { device in
            device.uniqueID == udid && !device.localizedName.lowercased().contains("camera")
        }

        if let device = muxedDevice {
            fputs("[DeviceEnumerator] Found muxed screen device: \(device.localizedName)\n", stderr)
            return device
        }

        // Fall back to video devices (non-camera)
        let videoDevice = videoDiscovery.devices.first { device in
            device.uniqueID == udid && !device.localizedName.lowercased().contains("camera")
        }

        if let device = videoDevice {
            fputs("[DeviceEnumerator] Found video screen device: \(device.localizedName)\n", stderr)
            return device
        }

        // Check if this is a synthetic UDID from Continuity Camera fallback
        // Synthetic UDIDs end with "00000000" and real camera UDIDs end with "00000001" or "00000002"
        if udid.hasSuffix("00000000") {
            let prefix = String(udid.dropLast(8))
            fputs("[DeviceEnumerator] UDID appears to be synthetic (from Continuity Camera fallback)\n", stderr)
            fputs("[DeviceEnumerator] Looking for camera device with prefix: \(prefix)\n", stderr)

            // Find the camera device with matching prefix
            // Prefer "...00000001" (main camera) over "...00000002" (desk view)
            let cameraUDID = prefix + "00000001"
            if let cameraDevice = videoDiscovery.devices.first(where: { $0.uniqueID == cameraUDID }) {
                fputs("[DeviceEnumerator] Found Continuity Camera device: \(cameraDevice.localizedName)\n", stderr)
                fputs("[DeviceEnumerator] NOTE: Screen capture unavailable, using camera as fallback\n", stderr)
                return cameraDevice
            }

            // Try any device with the prefix
            if let anyDevice = videoDiscovery.devices.first(where: { $0.uniqueID.hasPrefix(prefix) }) {
                fputs("[DeviceEnumerator] Found device with matching prefix: \(anyDevice.localizedName)\n", stderr)
                return anyDevice
            }
        }

        // Check if only camera device exists (no screen)
        let cameraDevice = videoDiscovery.devices.first { $0.uniqueID == udid }
        if cameraDevice != nil {
            fputs("[DeviceEnumerator] Only found camera device for this UDID, no screen device available.\n", stderr)
            fputs("[DeviceEnumerator] The iOS screen might not be available as a capture source.\n", stderr)
            fputs("[DeviceEnumerator] Try: 1) Unlock the iPhone  2) Trust this Mac  3) Check USB connection\n", stderr)
        } else {
            fputs("[DeviceEnumerator] Device not found with UDID: \(udid)\n", stderr)
        }

        return nil
    }
}
