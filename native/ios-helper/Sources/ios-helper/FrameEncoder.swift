import AVFoundation
import CoreMedia
import CoreVideo
import VideoToolbox

/// Encodes raw video frames to H.264 and outputs in Annex B format
class FrameEncoder {

    /// Callback for encoded frames
    var onEncodedFrame: ((Data, Bool, Bool, Int, Int) -> Void)?  // (data, isConfig, isKeyFrame, width, height)

    private var compressionSession: VTCompressionSession?
    private var width: Int = 0
    private var height: Int = 0
    private var hasOutputSPS = false

    /// Initialize encoder with dimensions
    func initialize(width: Int, height: Int) throws {
        self.width = width
        self.height = height

        // Create compression session
        var session: VTCompressionSession?

        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: Int32(width),
            height: Int32(height),
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: nil,
            refcon: nil,
            compressionSessionOut: &session
        )

        guard status == noErr, let session = session else {
            throw FrameEncoderError.failedToCreateSession
        }

        self.compressionSession = session

        // Configure encoder
        try configureSession(session)
    }

    /// Configure encoder session for real-time streaming
    private func configureSession(_ session: VTCompressionSession) throws {
        // Real-time encoding
        var status = VTSessionSetProperty(
            session,
            key: kVTCompressionPropertyKey_RealTime,
            value: kCFBooleanTrue
        )
        guard status == noErr else {
            throw FrameEncoderError.failedToConfigureSession
        }

        // Profile: Baseline for compatibility (matches scrcpy/webview expectations)
        status = VTSessionSetProperty(
            session,
            key: kVTCompressionPropertyKey_ProfileLevel,
            value: kVTProfileLevel_H264_Baseline_AutoLevel
        )

        // Allow frame reordering (B-frames)
        status = VTSessionSetProperty(
            session,
            key: kVTCompressionPropertyKey_AllowFrameReordering,
            value: kCFBooleanFalse
        )

        // Average bitrate (8 Mbps)
        let bitrate = 8_000_000
        status = VTSessionSetProperty(
            session,
            key: kVTCompressionPropertyKey_AverageBitRate,
            value: bitrate as CFNumber
        )

        // Max keyframe interval (every 2 seconds at 60fps = 120 frames)
        let keyframeInterval = 120
        status = VTSessionSetProperty(
            session,
            key: kVTCompressionPropertyKey_MaxKeyFrameInterval,
            value: keyframeInterval as CFNumber
        )

        // Prepare to encode
        VTCompressionSessionPrepareToEncodeFrames(session)
    }

    /// Encode a sample buffer containing a raw video frame
    func encode(_ sampleBuffer: CMSampleBuffer) {
        guard let compressionSession = compressionSession,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }

        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let duration = CMSampleBufferGetDuration(sampleBuffer)

        // Request keyframe for first frame
        var properties: [String: Any]? = nil
        if !hasOutputSPS {
            properties = [
                kVTEncodeFrameOptionKey_ForceKeyFrame as String: true
            ]
        }

        var flags: VTEncodeInfoFlags = []

        let status = VTCompressionSessionEncodeFrame(
            compressionSession,
            imageBuffer: pixelBuffer,
            presentationTimeStamp: presentationTime,
            duration: duration,
            frameProperties: properties as CFDictionary?,
            infoFlagsOut: &flags
        ) { [weak self] status, flags, sampleBuffer in
            guard status == noErr, let sampleBuffer = sampleBuffer else {
                return
            }
            self?.handleEncodedFrame(sampleBuffer)
        }

        if status != noErr {
            // Encoding failed
        }
    }

    /// Handle an encoded frame from VideoToolbox
    private func handleEncodedFrame(_ sampleBuffer: CMSampleBuffer) {
        guard let dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else {
            return
        }

        // Check if this is a keyframe
        var isKeyFrame = false
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[CFString: Any]],
           let firstAttachment = attachments.first {
            isKeyFrame = !(firstAttachment[kCMSampleAttachmentKey_NotSync] as? Bool ?? false)
        }

        // Extract SPS/PPS on first keyframe
        if isKeyFrame && !hasOutputSPS {
            if let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) {
                if let spsData = extractSPSPPS(from: formatDescription) {
                    onEncodedFrame?(spsData, true, false, width, height)
                    hasOutputSPS = true
                }
            }
        }

        // Convert AVCC to Annex B format
        if let annexBData = convertToAnnexB(dataBuffer: dataBuffer) {
            onEncodedFrame?(annexBData, false, isKeyFrame, width, height)
        }
    }

    /// Extract SPS and PPS from format description and return in Annex B format
    private func extractSPSPPS(from formatDescription: CMFormatDescription) -> Data? {
        var sparameterSetCount: Int = 0
        var status = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            formatDescription,
            parameterSetIndex: 0,
            parameterSetPointerOut: nil,
            parameterSetSizeOut: nil,
            parameterSetCountOut: &sparameterSetCount,
            nalUnitHeaderLengthOut: nil
        )

        guard status == noErr, sparameterSetCount >= 2 else {
            return nil
        }

        var result = Data()
        let startCode: [UInt8] = [0x00, 0x00, 0x00, 0x01]

        // Extract SPS
        var spsPointer: UnsafePointer<UInt8>?
        var spsSize: Int = 0
        status = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            formatDescription,
            parameterSetIndex: 0,
            parameterSetPointerOut: &spsPointer,
            parameterSetSizeOut: &spsSize,
            parameterSetCountOut: nil,
            nalUnitHeaderLengthOut: nil
        )

        if status == noErr, let spsPointer = spsPointer {
            result.append(contentsOf: startCode)
            result.append(Data(bytes: spsPointer, count: spsSize))
        }

        // Extract PPS
        var ppsPointer: UnsafePointer<UInt8>?
        var ppsSize: Int = 0
        status = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            formatDescription,
            parameterSetIndex: 1,
            parameterSetPointerOut: &ppsPointer,
            parameterSetSizeOut: &ppsSize,
            parameterSetCountOut: nil,
            nalUnitHeaderLengthOut: nil
        )

        if status == noErr, let ppsPointer = ppsPointer {
            result.append(contentsOf: startCode)
            result.append(Data(bytes: ppsPointer, count: ppsSize))
        }

        return result.isEmpty ? nil : result
    }

    /// Convert AVCC format NAL units to Annex B format
    private func convertToAnnexB(dataBuffer: CMBlockBuffer) -> Data? {
        var length: Int = 0
        var dataPointer: UnsafeMutablePointer<Int8>?

        let status = CMBlockBufferGetDataPointer(
            dataBuffer,
            atOffset: 0,
            lengthAtOffsetOut: nil,
            totalLengthOut: &length,
            dataPointerOut: &dataPointer
        )

        guard status == noErr, let dataPointer = dataPointer else {
            return nil
        }

        var result = Data()
        let startCode: [UInt8] = [0x00, 0x00, 0x00, 0x01]
        var offset = 0

        // AVCC format: each NAL unit is prefixed with its length (4 bytes big-endian)
        while offset < length - 4 {
            // Read NAL unit length (4 bytes big-endian)
            // CMBlockBufferGetDataPointer returns an Int8 pointer, so we must use the bitPattern
            // conversion to avoid traps on bytes >= 0x80.
            let b0 = UInt32(UInt8(bitPattern: dataPointer[offset]))
            let b1 = UInt32(UInt8(bitPattern: dataPointer[offset + 1]))
            let b2 = UInt32(UInt8(bitPattern: dataPointer[offset + 2]))
            let b3 = UInt32(UInt8(bitPattern: dataPointer[offset + 3]))
            let nalLength = Int((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)

            offset += 4

            guard nalLength > 0 && offset + nalLength <= length else {
                break
            }

            // Append start code and NAL unit data
            result.append(contentsOf: startCode)
            result.append(Data(bytes: dataPointer + offset, count: nalLength))

            offset += nalLength
        }

        return result.isEmpty ? nil : result
    }

    /// Stop encoding and release resources
    func stop() {
        if let session = compressionSession {
            VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
            VTCompressionSessionInvalidate(session)
            compressionSession = nil
        }
    }

    deinit {
        stop()
    }
}

// MARK: - Errors
enum FrameEncoderError: Error, LocalizedError {
    case failedToCreateSession
    case failedToConfigureSession

    var errorDescription: String? {
        switch self {
        case .failedToCreateSession:
            return "Failed to create H.264 compression session"
        case .failedToConfigureSession:
            return "Failed to configure H.264 encoder"
        }
    }
}
