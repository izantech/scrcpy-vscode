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
