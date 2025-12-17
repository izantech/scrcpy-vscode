import AppKit
import AVFoundation
import CoreGraphics
import CoreMediaIO
import Foundation

private struct CaptureSource {
    let udid: String
    let name: String
    let mediaType: String
    let deviceType: String
}

private enum VideoSource: String {
    case display
    case camera
}

private func isContinuityCameraUniqueID(_ uniqueID: String) -> Bool {
    uniqueID.hasSuffix("00000001") || uniqueID.hasSuffix("00000002")
}

private func kickstartIOSScreenCaptureAssistant() {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    task.arguments = ["kickstart", "-k", "system/com.apple.cmio.iOSScreenCaptureAssistant"]
    do {
        try task.run()
        task.waitUntilExit()
    } catch {
        // Best-effort: continue even if this fails.
        fputs("[ios-preview] launchctl kickstart failed: \(error)\n", stderr)
    }
}

private func enableScreenCaptureDevices() {
    kickstartIOSScreenCaptureAssistant()

    var allow: UInt32 = 1
    let dataSize = UInt32(MemoryLayout<UInt32>.size)

    func setHardwareProperty(_ selector: CMIOObjectPropertySelector, label: String) {
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
            fputs("[ios-preview] Failed to enable \(label) (status=\(status))\n", stderr)
        }
    }

    setHardwareProperty(
        CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
        label: "screen capture devices"
    )
    setHardwareProperty(
        CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowWirelessScreenCaptureDevices),
        label: "wireless screen capture devices"
    )
}

private func resolveVideoSource(from args: [String]) -> VideoSource {
    var i = 0
    while i < args.count {
        if args[i] == "--video-source", i + 1 < args.count {
            return VideoSource(rawValue: args[i + 1].lowercased()) ?? .display
        }
        i += 1
    }
    return .display
}

private func listCaptureSources(videoSource: VideoSource) -> [CaptureSource] {
    enableScreenCaptureDevices()

    if !CGPreflightScreenCaptureAccess() {
        fputs(
            "[ios-preview] Screen Recording permission is not granted for this process.\n",
            stderr
        )
        fputs(
            "[ios-preview] Grant Screen Recording permission to this binary (or your terminal) in:\n",
            stderr
        )
        fputs(
            "[ios-preview] System Settings > Privacy & Security > Screen Recording, then restart.\n",
            stderr
        )
        return []
    }

    let deviceTypes: [AVCaptureDevice.DeviceType] = [
        .external,
        .continuityCamera,
        .deskViewCamera,
    ]

    let maxAttempts = 6
    let attemptDelay: TimeInterval = 0.5

    for attempt in 0..<maxAttempts {
        if attempt > 0 {
            Thread.sleep(forTimeInterval: attemptDelay)
        }

        var sources: [CaptureSource] = []
        var seen = Set<String>()

        if videoSource == .display {
            let muxed = AVCaptureDevice.DiscoverySession(
                deviceTypes: deviceTypes,
                mediaType: .muxed,
                position: .unspecified
            ).devices

            for device in muxed {
                let name = device.localizedName
                let udid = device.uniqueID
                if isContinuityCameraUniqueID(udid) || name.lowercased().contains("camera") {
                    continue
                }
                if name.lowercased().contains("facetime") {
                    continue
                }
                if seen.contains(udid) {
                    continue
                }
                seen.insert(udid)
                sources.append(
                    CaptureSource(
                        udid: udid,
                        name: name,
                        mediaType: "muxed",
                        deviceType: device.deviceType.rawValue
                    )
                )
            }

            if !sources.isEmpty {
                return sources.sorted { $0.name < $1.name }
            }
        } else {
            let video = AVCaptureDevice.DiscoverySession(
                deviceTypes: deviceTypes,
                mediaType: .video,
                position: .unspecified
            ).devices

            for device in video {
                let name = device.localizedName
                let udid = device.uniqueID
                let lowerName = name.lowercased()
                if lowerName.contains("facetime") {
                    continue
                }
                if device.deviceType != .continuityCamera && device.deviceType != .deskViewCamera && !isContinuityCameraUniqueID(udid) {
                    continue
                }
                if seen.contains(udid) {
                    continue
                }
                seen.insert(udid)
                sources.append(
                    CaptureSource(
                        udid: udid,
                        name: name,
                        mediaType: "video",
                        deviceType: device.deviceType.rawValue
                    )
                )
            }

            if !sources.isEmpty {
                return sources.sorted { $0.name < $1.name }
            }
        }
    }

    return []
}

private func printUsage() {
    print(
        """
        ios-preview - minimal iOS capture preview for scrcpy-vscode

        Usage:
          ios-preview list [--video-source display|camera]
          ios-preview preview [<UDID>] [--video-source display|camera]

        Notes:
          - Requires Screen Recording permission.
          - For iOS screen capture on macOS 26, this tool will kickstart:
              system/com.apple.cmio.iOSScreenCaptureAssistant
          - Press 'q' to quit the preview window.
        """
    )
}

private final class PreviewView: NSView {
    private let previewLayer: AVCaptureVideoPreviewLayer

    init(session: AVCaptureSession) {
        previewLayer = AVCaptureVideoPreviewLayer(session: session)
        super.init(frame: .zero)
        wantsLayer = true
        previewLayer.videoGravity = .resizeAspect
        layer?.addSublayer(previewLayer)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()
        previewLayer.frame = bounds
    }
}

private final class FrameCounter: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private var frameCount = 0
    private var lastLog = Date()

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        _ = sampleBuffer
        _ = connection
        frameCount += 1

        let now = Date()
        if now.timeIntervalSince(lastLog) >= 1.0 {
            let fps = frameCount
            frameCount = 0
            lastLog = now
            fputs("[ios-preview] fps=\(fps)\n", stderr)
        }
    }
}

private func runPreview(udid: String, videoSource: VideoSource) -> Int32 {
    enableScreenCaptureDevices()

    guard let device = AVCaptureDevice(uniqueID: udid) else {
        fputs("[ios-preview] Device not found: \(udid)\n", stderr)
        return 1
    }

    let session = AVCaptureSession()
    session.beginConfiguration()

    do {
        let input = try AVCaptureDeviceInput(device: device)
        if session.canAddInput(input) {
            session.addInput(input)
        } else {
            fputs("[ios-preview] Cannot add device input to session\n", stderr)
            return 1
        }
    } catch {
        fputs("[ios-preview] Failed to create device input: \(error)\n", stderr)
        return 1
    }

    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ]

    let counter = FrameCounter()
    let queue = DispatchQueue(label: "com.scrcpy.ios-preview.frames")
    output.setSampleBufferDelegate(counter, queue: queue)
    if session.canAddOutput(output) {
        session.addOutput(output)
    }

    session.commitConfiguration()

    let app = NSApplication.shared
    app.setActivationPolicy(.regular)

    let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 480, height: 800),
        styleMask: [.titled, .closable, .miniaturizable, .resizable],
        backing: .buffered,
        defer: false
    )

    let titleSuffix = videoSource == .camera ? "camera" : "display"
    window.title = "ios-preview (\(titleSuffix)) — \(device.localizedName)"

    let view = PreviewView(session: session)
    window.contentView = view
    window.center()
    window.makeKeyAndOrderFront(nil)

    let monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
        if event.charactersIgnoringModifiers?.lowercased() == "q" {
            NSApplication.shared.terminate(nil)
            return nil
        }
        return event
    }

    app.activate(ignoringOtherApps: true)

    fputs("[ios-preview] Starting capture for \(udid)\n", stderr)
    session.startRunning()
    app.run()

    if let monitor {
        NSEvent.removeMonitor(monitor)
    }

    return 0
}

func main() -> Int32 {
    let args = Array(CommandLine.arguments.dropFirst())
    if args.isEmpty || args.contains("-h") || args.contains("--help") || args.contains("help") {
        printUsage()
        return 0
    }

    let command = args[0]
    let videoSource = resolveVideoSource(from: args)

    switch command {
    case "list":
        let sources = listCaptureSources(videoSource: videoSource)
        if sources.isEmpty {
            print("No sources found (\(videoSource.rawValue)).")
            return 1
        }
        for (idx, s) in sources.enumerated() {
            print("[\(idx)] \(s.name) [\(s.udid)] media=\(s.mediaType) type=\(s.deviceType)")
        }
        return 0

    case "preview":
        let explicitUDID = args.dropFirst().first { !$0.hasPrefix("--") && $0 != "preview" }
        if let explicitUDID {
            return runPreview(udid: explicitUDID, videoSource: videoSource)
        }

        let sources = listCaptureSources(videoSource: videoSource)
        if sources.isEmpty {
            print("No sources found (\(videoSource.rawValue)).")
            return 1
        }

        print("Select a source:")
        for (idx, s) in sources.enumerated() {
            print("[\(idx)] \(s.name) [\(s.udid)]")
        }
        print("Enter number (default 0): ", terminator: "")

        let selection = (readLine() ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let index = Int(selection) ?? 0
        let chosenIndex = max(0, min(index, sources.count - 1))
        return runPreview(udid: sources[chosenIndex].udid, videoSource: videoSource)

    default:
        printUsage()
        return 1
    }
}

exit(main())
