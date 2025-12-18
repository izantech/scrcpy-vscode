import AppKit
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

/// Captures a macOS window using ScreenCaptureKit and forwards video frames as `CMSampleBuffer`.
///
/// Used to capture the iPhone Mirroring (or AirPlay) window when a direct CoreMediaIO screen device
/// isn't available.
class WindowCapture: NSObject {

    weak var delegate: ScreenCaptureDelegate?

    private let windowID: UInt32
    private let sessionQueue = DispatchQueue(label: "com.scrcpy.ios-helper.windowcapture")

    private var stream: SCStream?
    private var hasStarted = false
    private var videoWidth = 0
    private var videoHeight = 0

    // Single frame capture support
    private var singleFrameCompletion: ((Result<Data, Error>) -> Void)?
    private var isSingleFrameMode = false

    // Frozen dark frame detection for screen off state
    private var consecutiveFrozenDarkFrames = 0
    private var isScreenOff = false
    private let frozenDarkFrameThreshold = 30  // ~0.5 second at 60fps before considering screen off
    private let darkThreshold: UInt8 = 70  // Max RGB value to consider "dark"
    private var lastFrameSignature: (r: UInt8, g: UInt8, b: UInt8)? = nil

    // Debug frame dumping
    private var isFrameDumpEnabled = false
    private var frameDumpStartTime: Date?
    private var frameDumpCount = 0
    private let frameDumpDuration: TimeInterval = 10.0  // Dump frames for 10 seconds
    private let frameDumpDirectory = "/tmp/ios-screen-debug"

    init(windowID: UInt32) {
        self.windowID = windowID
        super.init()
        fputs("[WindowCapture] Initialized with windowID: \(windowID)\n", stderr)
    }

    func start() throws {
        let semaphore = DispatchSemaphore(value: 0)
        var startError: Error?

        Task.detached { [weak self] in
            defer { semaphore.signal() }
            guard let self else { return }

            do {
                let content = try await SCShareableContent.excludingDesktopWindows(
                    false,
                    onScreenWindowsOnly: true
                )

                guard let window = content.windows.first(where: { $0.windowID == self.windowID }) else {
                    throw WindowCaptureError.windowNotFound(self.windowID)
                }

                let filter = SCContentFilter(desktopIndependentWindow: window)

                let config = SCStreamConfiguration()
                config.capturesAudio = false
                config.showsCursor = false
                config.pixelFormat = kCVPixelFormatType_32BGRA
                config.queueDepth = 8
                config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
                config.width = Int(window.frame.width)
                config.height = Int(window.frame.height)

                let stream = SCStream(filter: filter, configuration: config, delegate: self)
                try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: self.sessionQueue)
                self.stream = stream

                try await stream.startCapture()
                fputs("[WindowCapture] Capture started for windowID: \(self.windowID)\n", stderr)
            } catch {
                startError = error
            }
        }

        semaphore.wait()
        if let startError {
            throw startError
        }
    }

    func stop() {
        let currentStream = stream
        stream = nil

        Task.detached {
            do {
                try await currentStream?.stopCapture()
            } catch {
                // Best-effort shutdown.
            }
        }
    }

    /// Capture a single frame and return as PNG data
    func captureOneFrame(completion: @escaping (Result<Data, Error>) -> Void) {
        isSingleFrameMode = true
        singleFrameCompletion = completion

        do {
            try start()
        } catch {
            completion(.failure(error))
        }
    }

    /// Convert CMSampleBuffer to PNG data
    private func convertToPNG(_ sampleBuffer: CMSampleBuffer) -> Data? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return nil
        }

        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext()

        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else {
            return nil
        }

        let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
        return bitmapRep.representation(using: .png, properties: [:])
    }

    /// Get a signature from the frame by sampling multiple points
    private func getFrameSignature(_ sampleBuffer: CMSampleBuffer) -> (r: UInt8, g: UInt8, b: UInt8)? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return nil
        }

        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
            return nil
        }

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let pointer = baseAddress.assumingMemoryBound(to: UInt8.self)

        // Sample multiple points and combine into a signature
        let samplePoints = [
            (width / 4, height / 4),
            (width / 2, height / 2),
            (3 * width / 4, 3 * height / 4),
        ]

        var totalR: UInt16 = 0
        var totalG: UInt16 = 0
        var totalB: UInt16 = 0

        for (x, y) in samplePoints {
            let offset = y * bytesPerRow + x * 4
            totalB += UInt16(pointer[offset])
            totalG += UInt16(pointer[offset + 1])
            totalR += UInt16(pointer[offset + 2])
        }

        return (
            r: UInt8(totalR / 3),
            g: UInt8(totalG / 3),
            b: UInt8(totalB / 3)
        )
    }

    /// Check if frame is frozen AND dark (screen off detection)
    private func checkForFrozenFrame(_ sampleBuffer: CMSampleBuffer) {
        guard let currentSignature = getFrameSignature(sampleBuffer) else {
            return
        }

        // Check if frame is dark (all RGB values below threshold)
        let isDark = currentSignature.r < darkThreshold &&
                     currentSignature.g < darkThreshold &&
                     currentSignature.b < darkThreshold

        if let lastSig = lastFrameSignature {
            let rDiff = abs(Int(currentSignature.r) - Int(lastSig.r))
            let gDiff = abs(Int(currentSignature.g) - Int(lastSig.g))
            let bDiff = abs(Int(currentSignature.b) - Int(lastSig.b))

            let isFrozen = rDiff <= 2 && gDiff <= 2 && bDiff <= 2

            if isFrozen && isDark {
                consecutiveFrozenDarkFrames += 1

                if consecutiveFrozenDarkFrames >= frozenDarkFrameThreshold && !isScreenOff {
                    isScreenOff = true
                    fputs("[WindowCapture] Frozen dark frames detected (\(consecutiveFrozenDarkFrames) identical, RGB=\(currentSignature.r),\(currentSignature.g),\(currentSignature.b)) - screen appears to be off\n", stderr)
                    MessageWriter.writeStatus("SCREEN_OFF")
                }
            } else {
                if isScreenOff {
                    isScreenOff = false
                    fputs("[WindowCapture] Frame changed or not dark - screen is on\n", stderr)
                    MessageWriter.writeStatus("SCREEN_ON")
                }
                consecutiveFrozenDarkFrames = 0
            }
        }

        lastFrameSignature = currentSignature
    }

    /// Start dumping frames to disk for debugging
    func startFrameDump() {
        // Create directory if needed
        try? FileManager.default.createDirectory(atPath: frameDumpDirectory, withIntermediateDirectories: true)

        // Clear any existing files
        if let files = try? FileManager.default.contentsOfDirectory(atPath: frameDumpDirectory) {
            for file in files {
                try? FileManager.default.removeItem(atPath: "\(frameDumpDirectory)/\(file)")
            }
        }

        frameDumpCount = 0
        frameDumpStartTime = Date()
        isFrameDumpEnabled = true
        fputs("[WindowCapture] Started frame dump to \(frameDumpDirectory)\n", stderr)
        MessageWriter.writeStatus("DEBUG: Frame dump started - saving to \(frameDumpDirectory)")
    }

    /// Save a frame to disk if dumping is enabled
    private func maybeDumpFrame(_ sampleBuffer: CMSampleBuffer) {
        guard isFrameDumpEnabled, let startTime = frameDumpStartTime else { return }

        // Check if we've exceeded the dump duration
        if Date().timeIntervalSince(startTime) >= frameDumpDuration {
            isFrameDumpEnabled = false
            fputs("[WindowCapture] Frame dump complete - saved \(frameDumpCount) frames\n", stderr)
            MessageWriter.writeStatus("DEBUG: Frame dump complete - \(frameDumpCount) frames saved to \(frameDumpDirectory)")
            return
        }

        frameDumpCount += 1

        // Log every frame for debugging (not just saved ones)
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let ptsSeconds = CMTimeGetSeconds(pts)

        // Check if pixel buffer is valid and get info
        var pixelInfo = "no pixel buffer"
        var isBlack = false
        if let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
            let width = CVPixelBufferGetWidth(pixelBuffer)
            let height = CVPixelBufferGetHeight(pixelBuffer)
            let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
            let dataSize = CVPixelBufferGetDataSize(pixelBuffer)
            pixelInfo = "\(width)x\(height), bpr=\(bytesPerRow), size=\(dataSize)"

            // Sample center pixel to check if frame is black/empty
            CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
            if let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) {
                let pointer = baseAddress.assumingMemoryBound(to: UInt8.self)
                let centerOffset = (height / 2) * bytesPerRow + (width / 2) * 4
                let b = pointer[centerOffset]
                let g = pointer[centerOffset + 1]
                let r = pointer[centerOffset + 2]
                pixelInfo += ", center RGB=(\(r),\(g),\(b))"
                isBlack = (r < 10 && g < 10 && b < 10)
            }
            CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly)
        }

        // Log every 10th frame to avoid spam
        if frameDumpCount % 10 == 0 {
            fputs("[WindowCapture] Frame #\(frameDumpCount): PTS=\(String(format: "%.3f", ptsSeconds))s, \(pixelInfo), black=\(isBlack)\n", stderr)
        }

        // Only save every 5th frame to avoid too many files
        guard frameDumpCount % 5 == 0 else { return }

        // Convert to PNG and save
        if let pngData = convertToPNG(sampleBuffer) {
            let filename = String(format: "frame_%04d.png", frameDumpCount / 5)
            let path = "\(frameDumpDirectory)/\(filename)"

            do {
                try pngData.write(to: URL(fileURLWithPath: path))
            } catch {
                fputs("[WindowCapture] Failed to write frame: \(error)\n", stderr)
            }
        } else {
            fputs("[WindowCapture] Frame #\(frameDumpCount): convertToPNG FAILED\n", stderr)
        }
    }
}

// MARK: - SCStreamOutput
extension WindowCapture: SCStreamOutput {
    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen else {
            return
        }

        // Handle single-frame capture mode (screenshot)
        if isSingleFrameMode {
            isSingleFrameMode = false

            if let pngData = convertToPNG(sampleBuffer) {
                singleFrameCompletion?(.success(pngData))
            } else {
                singleFrameCompletion?(.failure(WindowCaptureError.cannotConvertToPNG))
            }

            stop()
            return
        }

        // Notify delegate that we've started (with dimensions)
        if !hasStarted {
            hasStarted = true
            if let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) {
                let dimensions = CMVideoFormatDescriptionGetDimensions(formatDescription)
                videoWidth = Int(dimensions.width)
                videoHeight = Int(dimensions.height)
            }
            delegate?.screenCapture(self, didStart: videoWidth, height: videoHeight)
        }

        // Check for frozen dark frames (screen off detection)
        checkForFrozenFrame(sampleBuffer)

        // Debug: dump frames if enabled
        maybeDumpFrame(sampleBuffer)

        delegate?.screenCapture(self, didOutputVideoFrame: sampleBuffer)
    }
}

// MARK: - SCStreamDelegate
extension WindowCapture: SCStreamDelegate {
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        delegate?.screenCapture(self, didReceiveError: error)
    }
}

// MARK: - Errors
enum WindowCaptureError: Error, LocalizedError {
    case windowNotFound(UInt32)
    case cannotConvertToPNG

    var errorDescription: String? {
        switch self {
        case .windowNotFound(let id):
            return "Window not found: \(id). Make sure iPhone Mirroring is open and visible."
        case .cannotConvertToPNG:
            return "Cannot convert frame to PNG"
        }
    }
}
