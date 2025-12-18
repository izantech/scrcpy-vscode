import AVFoundation
import CoreMedia
import CoreVideo
import CoreImage
import AppKit

/// Delegate protocol for receiving video frames
protocol ScreenCaptureDelegate: AnyObject {
    func screenCapture(_ capture: AnyObject, didOutputVideoFrame frame: CMSampleBuffer)
    func screenCapture(_ capture: AnyObject, didReceiveError error: Error)
    func screenCapture(_ capture: AnyObject, didStart width: Int, height: Int)
}

/// Manages screen capture from iOS devices via AVCaptureSession
class ScreenCapture: NSObject {

    weak var delegate: ScreenCaptureDelegate?

    private var captureSession: AVCaptureSession?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var device: AVCaptureDevice
    private let sessionQueue = DispatchQueue(label: "com.scrcpy.ios-helper.session")

    private var videoWidth: Int = 0
    private var videoHeight: Int = 0
    private var hasStarted = false

    // Single frame capture support
    private var singleFrameCompletion: ((Result<Data, Error>) -> Void)?
    private var isSingleFrameMode = false

    // Frozen dark frame detection for screen off state
    // When iOS screen is off, it sends the same dark gray frame repeatedly
    // We detect: frozen frames (identical content) + dark (low brightness)
    private var consecutiveFrozenDarkFrames = 0
    private var isScreenOff = false
    private let frozenDarkFrameThreshold = 30  // ~1 second at 30fps before considering screen off
    private let darkThreshold: UInt8 = 70  // Max RGB value to consider "dark"
    private var lastFrameSignature: (r: UInt8, g: UInt8, b: UInt8)? = nil

    // Debug frame dumping
    private var isFrameDumpEnabled = false
    private var frameDumpStartTime: Date?
    private var frameDumpCount = 0
    private let frameDumpDuration: TimeInterval = 10.0  // Dump frames for 10 seconds
    private let frameDumpDirectory = "/tmp/ios-screen-debug"

    init(device: AVCaptureDevice) {
        self.device = device
        super.init()
        fputs("[ScreenCapture] Initialized with device: \(device.localizedName) [\(device.uniqueID)]\n", stderr)
    }

    /// Start capturing video from the device
    func start() throws {
        let session = AVCaptureSession()
        self.captureSession = session

        // Add observers for session state
        NotificationCenter.default.addObserver(self, selector: #selector(sessionDidStartRunning), name: .AVCaptureSessionDidStartRunning, object: session)
        NotificationCenter.default.addObserver(self, selector: #selector(sessionDidStopRunning), name: .AVCaptureSessionDidStopRunning, object: session)
        NotificationCenter.default.addObserver(self, selector: #selector(sessionWasInterrupted), name: .AVCaptureSessionWasInterrupted, object: session)
        NotificationCenter.default.addObserver(self, selector: #selector(sessionInterruptionEnded), name: .AVCaptureSessionInterruptionEnded, object: session)
        NotificationCenter.default.addObserver(self, selector: #selector(sessionRuntimeError), name: .AVCaptureSessionRuntimeError, object: session)

        // Configure session for high quality
        session.beginConfiguration()

        // Add video input
        let videoInput = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(videoInput) else {
            throw ScreenCaptureError.cannotAddInput
        }
        session.addInput(videoInput)

        // Add video output
        let videoOutput = AVCaptureVideoDataOutput()
        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: sessionQueue)

        guard session.canAddOutput(videoOutput) else {
            throw ScreenCaptureError.cannotAddOutput
        }
        session.addOutput(videoOutput)
        self.videoOutput = videoOutput

        // Configure format to get highest resolution (best-effort)
        // configureFormat() -- forcing format can cause issues on some devices/macOS versions

        session.commitConfiguration()

        // Start the session
        sessionQueue.async {
            session.startRunning()
        }
    }

    @objc private func sessionDidStartRunning(notification: NSNotification) {
        fputs("[ScreenCapture] AVCaptureSession started running\n", stderr)
    }

    @objc private func sessionDidStopRunning(notification: NSNotification) {
        fputs("[ScreenCapture] AVCaptureSession stopped running\n", stderr)
    }

    @objc private func sessionWasInterrupted(notification: NSNotification) {
        // Detailed interruption reasons are not available on macOS via AVCaptureSessionInterruptionReasonKey
        // Note: Don't send SCREEN_OFF here - interruptions can happen during normal startup
        // Lock detection is handled via ideviceinfo polling in TypeScript
        fputs("[ScreenCapture] AVCaptureSession interrupted\n", stderr)
    }

    @objc private func sessionInterruptionEnded(notification: NSNotification) {
        fputs("[ScreenCapture] AVCaptureSession interruption ended\n", stderr)
    }

    @objc private func sessionRuntimeError(notification: NSNotification) {
        if let error = notification.userInfo?[AVCaptureSessionErrorKey] as? Error {
            fputs("[ScreenCapture] AVCaptureSession runtime error: \(error.localizedDescription)\n", stderr)
        }
    }

    /// Stop capturing
    func stop() {
        sessionQueue.async { [weak self] in
            self?.captureSession?.stopRunning()
            self?.captureSession = nil
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

    /// Configure the capture format for best quality
    private func configureFormat() {
        // Find the best format (highest resolution)
        var bestFormat: AVCaptureDevice.Format?
        var bestWidth: Int32 = 0

        if device.formats.isEmpty {
            fputs(
                "[ScreenCapture] Device reports no formats. Using default capture configuration.\n",
                stderr
            )
            return
        }

        for format in device.formats {
            let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            if dimensions.width > bestWidth {
                bestWidth = dimensions.width
                bestFormat = format
            }
        }

        guard let format = bestFormat else {
            fputs("[ScreenCapture] No suitable format found. Using default capture configuration.\n", stderr)
            return
        }

        do {
            try device.lockForConfiguration()
            device.activeFormat = format
            device.unlockForConfiguration()
        } catch {
            fputs(
                "[ScreenCapture] Failed to lock device for configuration (\(error)). Using default capture configuration.\n",
                stderr
            )
            return
        }

        let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
        self.videoWidth = Int(dimensions.width)
        self.videoHeight = Int(dimensions.height)
    }

    /// Get a signature from the frame by sampling multiple points
    /// Returns RGB values from center and corner points to detect content changes
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

        // Average the samples
        return (
            r: UInt8(totalR / 3),
            g: UInt8(totalG / 3),
            b: UInt8(totalB / 3)
        )
    }

    /// Check if frame is frozen AND dark (screen off detection)
    /// Only triggers when frames are both identical AND dark - avoids false positives on static bright screens
    private func checkForFrozenFrame(_ sampleBuffer: CMSampleBuffer) {
        guard let currentSignature = getFrameSignature(sampleBuffer) else {
            fputs("[ScreenCapture] checkForFrozenFrame: failed to get signature\n", stderr)
            return
        }

        // Check if frame is dark (all RGB values below threshold)
        let isDark = currentSignature.r < darkThreshold &&
                     currentSignature.g < darkThreshold &&
                     currentSignature.b < darkThreshold

        if let lastSig = lastFrameSignature {
            // Check if signature matches (allowing small variance for compression artifacts)
            let rDiff = abs(Int(currentSignature.r) - Int(lastSig.r))
            let gDiff = abs(Int(currentSignature.g) - Int(lastSig.g))
            let bDiff = abs(Int(currentSignature.b) - Int(lastSig.b))

            let isFrozen = rDiff <= 2 && gDiff <= 2 && bDiff <= 2

            // Log every 30 frames to track detection state
            if consecutiveFrozenDarkFrames % 30 == 0 || consecutiveFrozenDarkFrames < 5 {
                fputs("[ScreenCapture] Frame check: RGB=(\(currentSignature.r),\(currentSignature.g),\(currentSignature.b)), isDark=\(isDark), isFrozen=\(isFrozen), count=\(consecutiveFrozenDarkFrames)\n", stderr)
            }

            if isFrozen && isDark {
                // Frame is both frozen AND dark - likely screen off
                consecutiveFrozenDarkFrames += 1

                if consecutiveFrozenDarkFrames >= frozenDarkFrameThreshold && !isScreenOff {
                    isScreenOff = true
                    fputs("[ScreenCapture] Frozen dark frames detected (\(consecutiveFrozenDarkFrames) identical, RGB=\(currentSignature.r),\(currentSignature.g),\(currentSignature.b)) - screen appears to be off\n", stderr)
                    MessageWriter.writeStatus("SCREEN_OFF")
                }
            } else {
                // Frame changed OR is not dark - screen is on
                if isScreenOff {
                    isScreenOff = false
                    fputs("[ScreenCapture] Frame changed or not dark - screen is on\n", stderr)
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
        fputs("[ScreenCapture] Started frame dump to \(frameDumpDirectory)\n", stderr)
        MessageWriter.writeStatus("DEBUG: Frame dump started - saving to \(frameDumpDirectory)")
    }

    /// Save a frame to disk if dumping is enabled
    private func maybeDumpFrame(_ sampleBuffer: CMSampleBuffer) {
        guard isFrameDumpEnabled, let startTime = frameDumpStartTime else { return }

        // Check if we've exceeded the dump duration
        if Date().timeIntervalSince(startTime) >= frameDumpDuration {
            isFrameDumpEnabled = false
            fputs("[ScreenCapture] Frame dump complete - saved \(frameDumpCount) frames\n", stderr)
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
            fputs("[ScreenCapture] Frame #\(frameDumpCount): PTS=\(String(format: "%.3f", ptsSeconds))s, \(pixelInfo), black=\(isBlack)\n", stderr)
        }

        // Only save every 5th frame to avoid too many files (at 30fps = ~6 frames/sec)
        guard frameDumpCount % 5 == 0 else { return }

        // Convert to PNG and save
        if let pngData = convertToPNG(sampleBuffer) {
            let filename = String(format: "frame_%04d.png", frameDumpCount / 5)
            let path = "\(frameDumpDirectory)/\(filename)"

            do {
                try pngData.write(to: URL(fileURLWithPath: path))
            } catch {
                fputs("[ScreenCapture] Failed to write frame: \(error)\n", stderr)
            }
        } else {
            fputs("[ScreenCapture] Frame #\(frameDumpCount): convertToPNG FAILED\n", stderr)
        }
    }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate
extension ScreenCapture: AVCaptureVideoDataOutputSampleBufferDelegate {

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        // Handle single-frame capture mode (screenshot)
        if isSingleFrameMode {
            isSingleFrameMode = false  // Prevent processing more frames

            if let pngData = convertToPNG(sampleBuffer) {
                singleFrameCompletion?(.success(pngData))
            } else {
                singleFrameCompletion?(.failure(ScreenCaptureError.cannotConvertToPNG))
            }

            // Stop the session
            captureSession?.stopRunning()
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

        // Check for frozen frames (screen off detection)
        checkForFrozenFrame(sampleBuffer)

        // Debug: dump frames if enabled
        maybeDumpFrame(sampleBuffer)

        // Forward the sample buffer to delegate
        delegate?.screenCapture(self, didOutputVideoFrame: sampleBuffer)
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didDrop sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        // Frame dropped - log reason
        if let reasonAttachment = CMGetAttachment(sampleBuffer, key: kCMSampleBufferAttachmentKey_DroppedFrameReason, attachmentModeOut: nil) {
            fputs("[ScreenCapture] Frame dropped. Reason: \(reasonAttachment)\n", stderr)
        } else {
            fputs("[ScreenCapture] Frame dropped (unknown reason)\n", stderr)
        }
    }
}

// MARK: - Errors
enum ScreenCaptureError: Error, LocalizedError {
    case cannotAddInput
    case cannotAddOutput
    case cannotConvertToPNG

    var errorDescription: String? {
        switch self {
        case .cannotAddInput:
            return "Cannot add video input to capture session"
        case .cannotAddOutput:
            return "Cannot add video output to capture session"
        case .cannotConvertToPNG:
            return "Cannot convert frame to PNG"
        }
    }
}
