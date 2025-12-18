import AVFoundation
import CoreMediaIO
import CoreGraphics
import Foundation
import AppKit

/// Error types for screen capture permission issues
public enum PermissionError: Error, CustomStringConvertible {
    case screenRecordingPermissionDenied
    case screenCaptureAssistantFailed(exitCode: Int32, message: String)
    case coreMediaIOError(status: OSStatus, property: String)

    public var description: String {
        switch self {
        case .screenRecordingPermissionDenied:
            return "Screen Recording permission not granted"
        case .screenCaptureAssistantFailed(let exitCode, let message):
            return "iOSScreenCaptureAssistant failed (exit \(exitCode)): \(message)"
        case .coreMediaIOError(let status, let property):
            return "CoreMediaIO error \(status) setting \(property)"
        }
    }

    /// User-friendly guidance message
    public var guidance: String {
        switch self {
        case .screenRecordingPermissionDenied:
            return """
            Screen Recording permission is required for iOS screen capture.

            To fix:
            1. Open System Settings > Privacy & Security > Screen Recording
            2. Enable permission for Terminal or VS Code
            3. Restart the application after granting permission
            """
        case .screenCaptureAssistantFailed:
            return """
            The iOS Screen Capture Assistant service failed to start.
            This is usually a permission issue.

            To fix:
            1. Open System Settings > Privacy & Security > Screen Recording
            2. Enable permission for Terminal or VS Code
            3. Restart the application after granting permission
            """
        case .coreMediaIOError:
            return """
            Failed to enable screen capture devices.
            This is usually a permission issue.

            To fix:
            1. Open System Settings > Privacy & Security > Screen Recording
            2. Enable permission for Terminal or VS Code
            3. Restart the application after granting permission
            """
        }
    }

    /// URL to open Screen Recording settings
    public static let screenRecordingSettingsURL = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

    /// Open Screen Recording settings in System Settings
    public static func openScreenRecordingSettings() {
        if let url = URL(string: screenRecordingSettingsURL) {
            NSWorkspace.shared.open(url)
        }
    }
}

/// Result of enabling screen capture devices
public struct EnableScreenCaptureResult {
    public let errors: [PermissionError]
    public var hasPermissionError: Bool {
        errors.contains { error in
            switch error {
            case .screenRecordingPermissionDenied, .screenCaptureAssistantFailed, .coreMediaIOError:
                return true
            }
        }
    }
}

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

    /// Device types to scan for iOS capture sources.
    /// On newer macOS versions, iPhone sources may show up as Continuity Camera types instead of generic `.external`.
    private static let discoveryDeviceTypes: [AVCaptureDevice.DeviceType] = [
        .external,
        .continuityCamera,
        .deskViewCamera,
    ]

    /// Enable CoreMediaIO screen capture devices
    /// This is required before iOS devices appear as AVCaptureDevice
    /// Returns a result containing any errors that occurred
    @discardableResult
    static func enableScreenCaptureDevices() -> EnableScreenCaptureResult {
        var errors: [PermissionError] = []

        // Try to kickstart the iOS Screen Capture Assistant
        if let kickstartError = kickstartIOSScreenCaptureAssistant() {
            errors.append(kickstartError)
        }

        var allow: UInt32 = 1
        let dataSize = UInt32(MemoryLayout<UInt32>.size)

        func setHardwareProperty(_ selector: CMIOObjectPropertySelector, label: String) -> PermissionError? {
            var property = CMIOObjectPropertyAddress(
                mSelector: selector,
                mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
                mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain)
            )

            let status = CMIOObjectSetPropertyData(
                CMIOObjectID(kCMIOObjectSystemObject),
                &property,
                0,
                nil,
                dataSize,
                &allow
            )

            if status != noErr {
                fputs(
                    "[DeviceEnumerator] Failed to enable \(label) (status=\(status)).\n",
                    stderr
                )
                return .coreMediaIOError(status: status, property: label)
            }
            return nil
        }

        // Present wired screen capture devices to this process.
        if let err = setHardwareProperty(
            CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
            label: "screen capture devices"
        ) {
            errors.append(err)
        }

        // Present wireless screen capture devices (default is 0 on newer macOS).
        if let err = setHardwareProperty(
            CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowWirelessScreenCaptureDevices),
            label: "wireless screen capture devices"
        ) {
            errors.append(err)
        }

        return EnableScreenCaptureResult(errors: errors)
    }

    /// Ensure `iOSScreenCaptureAssistant` is running.
    ///
    /// On macOS Tahoe, the screen capture DAL can fail to surface muxed iOS devices until the
    /// corresponding launchd service is started.
    /// Returns an error if the kickstart fails with a permission-related error.
    private static func kickstartIOSScreenCaptureAssistant() -> PermissionError? {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        task.arguments = ["kickstart", "-k", "system/com.apple.cmio.iOSScreenCaptureAssistant"]

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        task.standardOutput = stdoutPipe
        task.standardError = stderrPipe

        do {
            try task.run()
            task.waitUntilExit()
        } catch {
            // Best-effort; continue enumeration even if kickstart fails.
            fputs("[DeviceEnumerator] Failed to run launchctl kickstart: \(error)\n", stderr)
            return nil
        }

        let outData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        let errData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        let out = String(data: outData, encoding: .utf8) ?? ""
        let err = String(data: errData, encoding: .utf8) ?? ""
        let combined = (out + err).trimmingCharacters(in: .whitespacesAndNewlines)

        if task.terminationStatus != 0 {
            if !combined.isEmpty {
                fputs("[DeviceEnumerator] launchctl kickstart output: \(combined)\n", stderr)
            }

            // Check for permission-related error (exit code 150 = "Operation not permitted")
            if combined.contains("Operation not permitted") ||
               combined.contains("System Integrity Protection") ||
               task.terminationStatus == 150 {
                return .screenCaptureAssistantFailed(
                    exitCode: task.terminationStatus,
                    message: combined.isEmpty ? "Permission denied" : combined
                )
            }
        }

        return nil
    }

    /// Continuity Camera device IDs typically end with these suffixes.
    private static func isContinuityCameraUniqueID(_ uniqueID: String) -> Bool {
        uniqueID.hasSuffix("00000001") || uniqueID.hasSuffix("00000002")
    }

    /// Try to resolve a screen capture device related to a known Continuity Camera UDID prefix.
    ///
    /// On macOS 26/iOS 26, the iPhone screen capture device may not appear in standard discovery sessions,
    /// but can still sometimes be opened directly by uniqueID. We probe a small range of suffixes and
    /// prefer muxed (audio+video) devices when possible.
    private static func resolveScreenDevice(forUDIDPrefix prefix: String) -> AVCaptureDevice? {
        // Probe a small range of suffixes (hex). 0x01/0x02 are known camera variants, so skip them.
        let maxSuffix: UInt32 = 0x40

        var best: AVCaptureDevice?
        var bestScore = Int.min
        for i in 0...maxSuffix {
            if i == 0x01 || i == 0x02 {
                continue
            }

            let suffix = String(format: "%08X", i)
            let candidateUDID = prefix + suffix

            guard let candidate = AVCaptureDevice(uniqueID: candidateUDID) else {
                continue
            }

            guard candidate.hasMediaType(.video) || candidate.hasMediaType(.muxed) else {
                continue
            }

            if isContinuityCameraUniqueID(candidate.uniqueID) {
                continue
            }

            // Heuristic scoring:
            // - Prefer muxed devices (often iPhone screen capture shows as muxed)
            // - Prefer names without "camera" (to avoid selecting Continuity Camera variants)
            var score = 0
            if candidate.hasMediaType(.muxed) {
                score += 2
            }
            if !candidate.localizedName.lowercased().contains("camera") {
                score += 1
            }

            if score > bestScore {
                bestScore = score
                best = candidate
            }

            // Prefer muxed devices (often the screen capture device).
            if candidate.hasMediaType(.muxed) {
                return candidate
            }
        }

        return best
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

        // kCMIOObjectPropertyName: caller is responsible for releasing the returned CFObject.
        // Use Unmanaged to avoid raw-pointer warnings and to manage ownership correctly.
        var name: Unmanaged<CFString>?
        var dataSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)

        let status = CMIOObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            dataSize,
            &dataSize,
            &name
        )

        guard status == noErr, let deviceName = name?.takeRetainedValue() else {
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

        // kCMIODevicePropertyDeviceUID: caller is responsible for releasing the returned CFObject.
        var uid: Unmanaged<CFString>?
        var dataSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)

        let status = CMIOObjectGetPropertyData(
            deviceID,
            &propertyAddress,
            0,
            nil,
            dataSize,
            &dataSize,
            &uid
        )

        guard status == noErr, let deviceUID = uid?.takeRetainedValue() else {
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

    /// Result of getting iOS devices, including any permission errors
    struct GetDevicesResult {
        let devices: [IOSDeviceInfo]
        let errors: [PermissionError]

        var hasPermissionError: Bool {
            !errors.isEmpty
        }
    }

    /// Get list of connected iOS devices (screen capture, not cameras)
    /// Returns both devices and any permission errors that occurred
    static func getIOSDevicesWithErrors() -> GetDevicesResult {
        var errors: [PermissionError] = []

        let enableResult = enableScreenCaptureDevices()
        errors.append(contentsOf: enableResult.errors)

        if !CGPreflightScreenCaptureAccess() {
            fputs(
                "[DeviceEnumerator] Screen Recording permission is not granted for this process.\n",
                stderr
            )
            fputs(
                "[DeviceEnumerator] To enable iOS screen capture, grant Screen Recording permission to Visual Studio Code (or the parent terminal) in:\n",
                stderr
            )
            fputs(
                "[DeviceEnumerator] System Settings > Privacy & Security > Screen Recording, then restart the app.\n",
                stderr
            )
            errors.append(.screenRecordingPermissionDenied)
            return GetDevicesResult(devices: [], errors: errors)
        }

        // Continue with device enumeration...
        let devices = enumerateIOSDevices()
        return GetDevicesResult(devices: devices, errors: errors)
    }

    /// Get list of connected iOS devices (screen capture, not cameras)
    /// Legacy method for backward compatibility - use getIOSDevicesWithErrors() for error handling
    static func getIOSDevices() -> [IOSDeviceInfo] {
        let result = getIOSDevicesWithErrors()
        return result.devices
    }

    /// Internal device enumeration logic
    private static func enumerateIOSDevices() -> [IOSDeviceInfo] {

        // Debug: list all CoreMediaIO devices directly
        listAllCoreMediaIODevices()

        // Some macOS versions take a while to surface the iPhone screen capture device after enabling.
        // Poll a few times to give the DAL time to register devices.
        // On macOS 26/iOS 26, the device can take 10+ seconds to appear sometimes.
        let maxAttempts = 12
        let attemptDelay: TimeInterval = 1.0

        for attempt in 0..<maxAttempts {
            if attempt > 0 {
                Thread.sleep(forTimeInterval: attemptDelay)
            }

            var devices: [IOSDeviceInfo] = []
            var seenUDIDs = Set<String>()

            // Method 1: Look for muxed (video+audio) devices - typical for screen capture
            let muxedDiscovery = AVCaptureDevice.DiscoverySession(
                deviceTypes: discoveryDeviceTypes,
                mediaType: .muxed,
                position: .unspecified
            )

            fputs(
                "[DeviceEnumerator] (attempt \(attempt + 1)/\(maxAttempts)) Muxed devices found: \(muxedDiscovery.devices.count)\n",
                stderr
            )
            for device in muxedDiscovery.devices {
                fputs(
                    "  - [muxed] \(device.localizedName) [\(device.uniqueID)] type=\(device.deviceType.rawValue)\n",
                    stderr
                )
            }

            // Method 2: Also check video devices (some iOS sources appear video-only)
            let videoDiscovery = AVCaptureDevice.DiscoverySession(
                deviceTypes: discoveryDeviceTypes,
                mediaType: .video,
                position: .unspecified
            )

            fputs(
                "[DeviceEnumerator] (attempt \(attempt + 1)/\(maxAttempts)) Video devices found: \(videoDiscovery.devices.count)\n",
                stderr
            )
            for device in videoDiscovery.devices {
                fputs(
                    "  - [video] \(device.localizedName) [\(device.uniqueID)] type=\(device.deviceType.rawValue)\n",
                    stderr
                )
            }

            // Method 3: Check all devices of relevant types (shows everything)
            let allDiscovery = AVCaptureDevice.DiscoverySession(
                deviceTypes: discoveryDeviceTypes,
                mediaType: nil,
                position: .unspecified
            )

            fputs(
                "[DeviceEnumerator] (attempt \(attempt + 1)/\(maxAttempts)) All devices (nil mediaType): \(allDiscovery.devices.count)\n",
                stderr
            )
            for device in allDiscovery.devices {
                let hasVideo = device.hasMediaType(.video)
                let hasAudio = device.hasMediaType(.audio)
                let hasMuxed = device.hasMediaType(.muxed)
                fputs(
                    "  - [all] \(device.localizedName) [\(device.uniqueID)] type=\(device.deviceType.rawValue) video=\(hasVideo) audio=\(hasAudio) muxed=\(hasMuxed)\n",
                    stderr
                )
            }

            // Derive known iOS uniqueID prefixes from Continuity Camera devices.
            var iosPrefixes = Set<String>()
            for device in muxedDiscovery.devices + videoDiscovery.devices + allDiscovery.devices {
                let udid = device.uniqueID
                if isContinuityCameraUniqueID(udid) || device.deviceType == .continuityCamera || device.deviceType == .deskViewCamera {
                    if let prefix = getUDIDPrefix(from: udid) {
                        iosPrefixes.insert(prefix)
                    }
                }
            }

            func isKnownIOSDevice(name: String, udid: String) -> Bool {
                if determineModel(from: name, isScreenDevice: false) != nil {
                    return true
                }
                return iosPrefixes.contains(where: { udid.hasPrefix($0) })
            }

            func resolveModel(name: String, udid: String) -> String? {
                if let model = determineModel(from: name, isScreenDevice: false) {
                    return model
                }
                if iosPrefixes.contains(where: { udid.hasPrefix($0) }) {
                    return determineModel(from: name, isScreenDevice: true)
                }
                return nil
            }

            // Method 0: Try the default muxed device (as suggested by Apple forums)
            if let defaultMuxed = AVCaptureDevice.default(for: .muxed) {
                fputs(
                    "[DeviceEnumerator] Default muxed device: \(defaultMuxed.localizedName) [\(defaultMuxed.uniqueID)]\n",
                    stderr
                )
                let name = defaultMuxed.localizedName
                let udid = defaultMuxed.uniqueID
                if !isContinuityCameraUniqueID(udid),
                   isKnownIOSDevice(name: name, udid: udid),
                   let model = resolveModel(name: name, udid: udid) {
                    fputs("[DeviceEnumerator] Adding default muxed device: \(name) [\(udid)] as \(model)\n", stderr)
                    seenUDIDs.insert(udid)
                    devices.append(IOSDeviceInfo(udid: udid, name: name, model: model))
                }
            } else if attempt == 0 {
                fputs("[DeviceEnumerator] No default muxed device found\n", stderr)
            }

            for device in muxedDiscovery.devices {
                let name = device.localizedName
                let udid = device.uniqueID

                if isContinuityCameraUniqueID(udid) {
                    continue
                }

                if seenUDIDs.contains(udid) {
                    continue
                }

                guard isKnownIOSDevice(name: name, udid: udid),
                      let model = resolveModel(name: name, udid: udid) else {
                    continue
                }

                seenUDIDs.insert(udid)
                fputs("[DeviceEnumerator] Adding muxed screen device: \(name) [\(udid)] as \(model)\n", stderr)
                devices.append(IOSDeviceInfo(udid: udid, name: name, model: model))
            }

            for device in videoDiscovery.devices {
                let name = device.localizedName
                let udid = device.uniqueID

                if seenUDIDs.contains(udid) {
                    continue
                }

                if isContinuityCameraUniqueID(udid) {
                    continue
                }

                guard isKnownIOSDevice(name: name, udid: udid),
                      let model = resolveModel(name: name, udid: udid) else {
                    continue
                }

                seenUDIDs.insert(udid)
                fputs("[DeviceEnumerator] Adding video screen device: \(name) [\(udid)] as \(model)\n", stderr)
                devices.append(IOSDeviceInfo(udid: udid, name: name, model: model))
            }

            for device in allDiscovery.devices {
                let name = device.localizedName
                let udid = device.uniqueID

                if seenUDIDs.contains(udid) {
                    continue
                }

                if isContinuityCameraUniqueID(udid) {
                    continue
                }

                guard device.hasMediaType(.video) || device.hasMediaType(.muxed) else {
                    continue
                }

                guard isKnownIOSDevice(name: name, udid: udid),
                      let model = resolveModel(name: name, udid: udid) else {
                    continue
                }

                seenUDIDs.insert(udid)
                fputs("[DeviceEnumerator] Adding screen device: \(name) [\(udid)] as \(model)\n", stderr)
                devices.append(IOSDeviceInfo(udid: udid, name: name, model: model))
            }

            // If we saw Continuity Camera devices, try to resolve a related screen device by uniqueID.
            for prefix in iosPrefixes {
                if let screenDevice = resolveScreenDevice(forUDIDPrefix: prefix) {
                    let name = screenDevice.localizedName
                    let udid = screenDevice.uniqueID
                    if seenUDIDs.contains(udid) {
                        continue
                    }

                    // Only include if it looks like iOS (by prefix).
                    guard let model = determineModel(from: name, isScreenDevice: true) else {
                        continue
                    }

                    fputs(
                        "[DeviceEnumerator] Resolved screen device from prefix: \(name) [\(udid)] as \(model)\n",
                        stderr
                    )
                    seenUDIDs.insert(udid)
                    devices.append(IOSDeviceInfo(udid: udid, name: name, model: model))
                }
            }

            if !devices.isEmpty {
                return devices
            }
        }

        fputs("\n[DeviceEnumerator] No screen capture devices found.\n", stderr)
        return []
    }

    /// Get Continuity Camera devices (explicit camera capture mode)
    static func getIOSCameraDevices() -> [IOSDeviceInfo] {
        enableScreenCaptureDevices()

        fputs("\n[DeviceEnumerator] Listing iOS Continuity Camera devices...\n", stderr)

        var devices: [IOSDeviceInfo] = []

        // Group devices by UDID prefix so we only list one camera per iOS device.
        var devicesByPrefix: [String: [AVCaptureDevice]] = [:]

        let videoDiscovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: discoveryDeviceTypes,
            mediaType: .video,
            position: .unspecified
        )

        for device in videoDiscovery.devices {
            let lowerName = device.localizedName.lowercased()

            // Skip Mac cameras.
            if lowerName.contains("facetime") {
                continue
            }

            // Only include Continuity Camera / Desk View camera sources.
            if device.deviceType != .continuityCamera && device.deviceType != .deskViewCamera && !isContinuityCameraUniqueID(device.uniqueID) {
                continue
            }

            guard let prefix = getUDIDPrefix(from: device.uniqueID) else {
                continue
            }

            devicesByPrefix[prefix, default: []].append(device)
        }

        for (_, candidates) in devicesByPrefix {
            // Prefer the main camera (suffix 00000001) over other variants (e.g., Desk View 00000002).
            let chosen = candidates.sorted { a, b in
                let aIsMain = a.uniqueID.hasSuffix("00000001")
                let bIsMain = b.uniqueID.hasSuffix("00000001")
                if aIsMain != bIsMain {
                    return aIsMain
                }
                return a.localizedName < b.localizedName
            }.first

            guard let chosen else {
                continue
            }

            let name = chosen.localizedName
            let udid = chosen.uniqueID
            let model = determineModel(from: name, isScreenDevice: true) ?? "iOS Device"
            fputs("[DeviceEnumerator] Adding camera device: \(name) [\(udid)] as \(model)\n", stderr)
            devices.append(IOSDeviceInfo(udid: udid, name: name, model: model, isCameraFallback: false))
        }

        devices.sort { $0.name < $1.name }
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

    /// Find a specific device by UDID (screen capture, not camera)
    /// Also handles synthetic UDIDs from Continuity Camera fallback
    static func findDevice(udid: String) -> AVCaptureDevice? {
        enableScreenCaptureDevices()

        // Small delay to allow devices to appear
        Thread.sleep(forTimeInterval: 0.3)

        // Try muxed devices first (screen capture)
        let muxedDiscovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: discoveryDeviceTypes,
            mediaType: .muxed,
            position: .unspecified
        )

        // Then video devices
        let videoDiscovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: discoveryDeviceTypes,
            mediaType: .video,
            position: .unspecified
        )

        // Debug: log all available devices
        fputs("[DeviceEnumerator] Looking for UDID: \(udid)\n", stderr)
        fputs("[DeviceEnumerator] Available devices:\n", stderr)

        for device in muxedDiscovery.devices {
            let isCamera = device.localizedName.lowercased().contains("camera")
            fputs("  - [muxed] \(device.localizedName) [\(device.uniqueID)] type=\(device.deviceType.rawValue) \(isCamera ? "(camera)" : "(screen)")\n", stderr)
        }
        for device in videoDiscovery.devices {
            let isCamera = device.localizedName.lowercased().contains("camera")
            fputs("  - [video] \(device.localizedName) [\(device.uniqueID)] type=\(device.deviceType.rawValue) \(isCamera ? "(camera)" : "(screen)")\n", stderr)
        }

        // First try to find in muxed devices (preferred for screen capture)
        let muxedDevice = muxedDiscovery.devices.first { device in
            device.uniqueID == udid
        }

        if let device = muxedDevice {
            fputs("[DeviceEnumerator] Found muxed screen device: \(device.localizedName)\n", stderr)
            return device
        }

        // Fall back to video devices (non-camera)
        let videoDevice = videoDiscovery.devices.first { device in
            device.uniqueID == udid
        }

        if let device = videoDevice {
            fputs("[DeviceEnumerator] Found video screen device: \(device.localizedName)\n", stderr)
            return device
        }

        // As a fallback, try to create the device directly by uniqueID.
        if let directDevice = AVCaptureDevice(uniqueID: udid) {
            fputs(
                "[DeviceEnumerator] Found device via AVCaptureDevice(uniqueID:): \(directDevice.localizedName)\n",
                stderr
            )
            return directDevice
        }

        // Check if this is a synthetic UDID from Continuity Camera fallback
        // Synthetic UDIDs end with "00000000" and real camera UDIDs end with "00000001" or "00000002"
        if udid.hasSuffix("00000000") {
            let prefix = String(udid.dropLast(8))
            fputs("[DeviceEnumerator] UDID appears to be synthetic (from Continuity Camera fallback)\n", stderr)
            fputs("[DeviceEnumerator] Looking for camera device with prefix: \(prefix)\n", stderr)

            // Try to resolve an actual screen device for this prefix (some systems use a different suffix).
            if let screenDevice = resolveScreenDevice(forUDIDPrefix: prefix) {
                fputs(
                    "[DeviceEnumerator] Resolved screen device from synthetic prefix: \(screenDevice.localizedName) [\(screenDevice.uniqueID)]\n",
                    stderr
                )
                return screenDevice
            }

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
