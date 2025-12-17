import Foundation
import AVFoundation

/// Message types for the binary protocol
enum MessageType: UInt8 {
    case deviceList = 0x01
    case deviceInfo = 0x02
    case videoConfig = 0x03
    case videoFrame = 0x04
    case error = 0x05
    case status = 0x06
    case screenshot = 0x07
}

/// Writes binary messages to stdout following the protocol format
class MessageWriter {

    private static let stdout = FileHandle.standardOutput

    /// Write a message to stdout
    static func write(type: MessageType, payload: Data) {
        var message = Data()

        // Type (1 byte)
        message.append(type.rawValue)

        // Length (4 bytes big-endian)
        var length = UInt32(payload.count).bigEndian
        message.append(Data(bytes: &length, count: 4))

        // Payload
        message.append(payload)

        stdout.write(message)
    }

    /// Write an error message
    static func writeError(_ message: String) {
        write(type: .error, payload: message.data(using: .utf8) ?? Data())
    }

    /// Write a status message
    static func writeStatus(_ message: String) {
        write(type: .status, payload: message.data(using: .utf8) ?? Data())
    }

    /// Write device list as JSON
    static func writeDeviceList(_ devices: [IOSDeviceInfo]) {
        let encoder = JSONEncoder()
        if let data = try? encoder.encode(devices) {
            write(type: .deviceList, payload: data)
        }
    }

    /// Write video config (SPS/PPS with dimensions)
    static func writeVideoConfig(width: Int, height: Int, configData: Data) {
        var payload = Data()

        // Width (4 bytes big-endian)
        var w = UInt32(width).bigEndian
        payload.append(Data(bytes: &w, count: 4))

        // Height (4 bytes big-endian)
        var h = UInt32(height).bigEndian
        payload.append(Data(bytes: &h, count: 4))

        // Config data (SPS/PPS in Annex B format)
        payload.append(configData)

        write(type: .videoConfig, payload: payload)
    }

    /// Write video frame
    static func writeVideoFrame(data: Data, isKeyFrame: Bool, isConfig: Bool, pts: UInt64) {
        var payload = Data()

        // Flags (1 byte)
        var flags: UInt8 = 0
        if isKeyFrame { flags |= 0x01 }
        if isConfig { flags |= 0x02 }
        payload.append(flags)

        // PTS (8 bytes big-endian)
        var ptsValue = pts.bigEndian
        payload.append(Data(bytes: &ptsValue, count: 8))

        // Frame data
        payload.append(data)

        write(type: .videoFrame, payload: payload)
    }

    /// Write screenshot (PNG data)
    static func writeScreenshot(_ pngData: Data) {
        write(type: .screenshot, payload: pngData)
    }
}

/// Main application for iOS screen capture
class IOSHelperApp: ScreenCaptureDelegate {

    private var screenCapture: ScreenCapture?
    private var windowCapture: WindowCapture?
    private var frameEncoder: FrameEncoder?
    private var frameCount: UInt64 = 0

    /// List connected iOS devices
    func listDevices(videoSource: String) {
        let normalized = videoSource.lowercased()
        if normalized == "camera" {
            MessageWriter.writeStatus("Scanning for iOS camera devices...")
        } else {
            MessageWriter.writeStatus("Scanning for iOS screen devices...")
        }

        let devices: [IOSDeviceInfo]
        if normalized == "camera" {
            devices = DeviceEnumerator.getIOSCameraDevices()
        } else {
            let directDevices = DeviceEnumerator.getIOSDevices()
            let mirroringDevices = MirroringWindowEnumerator.getMirroringWindows()
            devices = directDevices + mirroringDevices
        }

        if devices.isEmpty {
            if normalized == "camera" {
                MessageWriter.writeStatus(
                    "No iOS camera devices found. Try enabling Continuity Camera and selecting your iPhone as a camera source."
                )
            } else {
                MessageWriter.writeStatus(
                    "No iOS screen devices found. Ensure Screen Recording permission, connect via USB, and trust this Mac. To use Continuity Camera instead, set scrcpy.videoSource=camera."
                )
            }
        }

        MessageWriter.writeDeviceList(devices)
    }

    /// Start streaming from a specific device
    func startStream(udid: String) {
        MessageWriter.writeStatus("Looking for device: \(udid)")

        if udid.hasPrefix("window:") {
            let idString = String(udid.dropFirst("window:".count))
            guard let windowID = UInt32(idString) else {
                MessageWriter.writeError("Invalid window ID: \(udid)")
                exit(1)
            }

            MessageWriter.writeStatus("Capturing iPhone Mirroring window: \(windowID)")
            windowCapture = WindowCapture(windowID: windowID)
            windowCapture?.delegate = self

            do {
                try windowCapture?.start()
                MessageWriter.writeStatus("Capture started")
                RunLoop.main.run()
            } catch {
                MessageWriter.writeError("Failed to start window capture: \(error.localizedDescription)")
                exit(1)
            }
        }

        guard let device = DeviceEnumerator.findDevice(udid: udid) else {
            MessageWriter.writeError("Device not found: \(udid)")
            exit(1)
        }

        MessageWriter.writeStatus("Found device: \(device.localizedName)")

        // Create screen capture
        screenCapture = ScreenCapture(device: device)
        screenCapture?.delegate = self

        do {
            try screenCapture?.start()
            MessageWriter.writeStatus("Capture started")

            // Keep running until terminated
            RunLoop.main.run()
        } catch {
            MessageWriter.writeError("Failed to start capture: \(error.localizedDescription)")
            exit(1)
        }
    }

    /// Take a single screenshot from a device
    func takeScreenshot(udid: String) {
        if udid.hasPrefix("window:") {
            let idString = String(udid.dropFirst("window:".count))
            guard let windowID = UInt32(idString) else {
                MessageWriter.writeError("Invalid window ID: \(udid)")
                exit(1)
            }

            let capture = WindowCapture(windowID: windowID)
            capture.captureOneFrame { result in
                switch result {
                case .success(let pngData):
                    MessageWriter.writeScreenshot(pngData)
                    exit(0)
                case .failure(let error):
                    MessageWriter.writeError("Screenshot failed: \(error.localizedDescription)")
                    exit(1)
                }
            }

            RunLoop.main.run()
            return
        }

        guard let device = DeviceEnumerator.findDevice(udid: udid) else {
            MessageWriter.writeError("Device not found: \(udid)")
            exit(1)
        }

        // Create screen capture for single frame
        let capture = ScreenCapture(device: device)
        capture.captureOneFrame { result in
            switch result {
            case .success(let pngData):
                MessageWriter.writeScreenshot(pngData)
                exit(0)
            case .failure(let error):
                MessageWriter.writeError("Screenshot failed: \(error.localizedDescription)")
                exit(1)
            }
        }

        // Run until callback completes
        RunLoop.main.run()
    }

    // MARK: - ScreenCaptureDelegate

    func screenCapture(_ capture: AnyObject, didStart width: Int, height: Int) {
        MessageWriter.writeStatus("Capturing at \(width)x\(height)")

        // Initialize encoder
        frameEncoder = FrameEncoder()
        frameEncoder?.onEncodedFrame = { [weak self] data, isConfig, isKeyFrame, w, h in
            if isConfig {
                // Send video config (SPS/PPS)
                MessageWriter.writeVideoConfig(width: w, height: h, configData: data)
            } else {
                // Send video frame
                self?.frameCount += 1
                MessageWriter.writeVideoFrame(
                    data: data,
                    isKeyFrame: isKeyFrame,
                    isConfig: false,
                    pts: self?.frameCount ?? 0
                )
            }
        }

        do {
            try frameEncoder?.initialize(width: width, height: height)
        } catch {
            MessageWriter.writeError("Failed to initialize encoder: \(error.localizedDescription)")
        }
    }

    func screenCapture(_ capture: AnyObject, didOutputVideoFrame frame: CMSampleBuffer) {
        frameEncoder?.encode(frame)
    }

    func screenCapture(_ capture: AnyObject, didReceiveError error: Error) {
        MessageWriter.writeError(error.localizedDescription)
    }
}

// MARK: - Main Entry Point

func printUsage() {
    fputs("""
    ios-helper - iOS Screen Capture Helper for scrcpy-vscode

    Usage:
      ios-helper list [--video-source display|camera]
                                 List iOS capture sources
      ios-helper stream <UDID>    Stream video from a specific capture source
      ios-helper screenshot <UDID> Take a single screenshot from a capture source

    The output is a binary protocol on stdout for consumption by the VS Code extension.

    """, stderr)
}

func main() {
    let args = CommandLine.arguments

    guard args.count >= 2 else {
        printUsage()
        exit(1)
    }

    let command = args[1]
    let app = IOSHelperApp()

    switch command {
    case "list":
        var videoSource = "display"
        var i = 2
        while i < args.count {
            let arg = args[i]
            if arg == "--video-source", i + 1 < args.count {
                videoSource = args[i + 1]
                i += 2
                continue
            }
            i += 1
        }

        app.listDevices(videoSource: videoSource)
        exit(0)

    case "stream":
        guard args.count >= 3 else {
            fputs("Error: stream command requires a device UDID\n", stderr)
            printUsage()
            exit(1)
        }
        let udid = args[2]
        app.startStream(udid: udid)

    case "screenshot":
        guard args.count >= 3 else {
            fputs("Error: screenshot command requires a device UDID\n", stderr)
            printUsage()
            exit(1)
        }
        let udid = args[2]
        app.takeScreenshot(udid: udid)

    case "-h", "--help", "help":
        printUsage()
        exit(0)

    default:
        fputs("Unknown command: \(command)\n", stderr)
        printUsage()
        exit(1)
    }
}

main()
