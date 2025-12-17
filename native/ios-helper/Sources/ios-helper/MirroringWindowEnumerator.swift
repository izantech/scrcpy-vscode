import CoreGraphics
import Foundation
import ScreenCaptureKit

/// Enumerates iOS display windows via ScreenCaptureKit.
///
/// On some macOS 26 / iOS 26 systems, the CoreMediaIO iPhone screen capture device may not surface reliably.
/// As a fallback, we capture a system window that renders the iPhone screen (e.g. iPhone Mirroring or AirPlay).
class MirroringWindowEnumerator {

    private static let mirroringBundleID = "com.apple.ScreenContinuity"
    private static let airPlayBundleID = "com.apple.AirPlayUIAgent"

    static func getMirroringWindows() -> [IOSDeviceInfo] {
        if !CGPreflightScreenCaptureAccess() {
            fputs(
                "[MirroringWindowEnumerator] Screen Recording permission is not granted for this process.\n",
                stderr
            )
            return []
        }

        let semaphore = DispatchSemaphore(value: 0)
        var result: [IOSDeviceInfo] = []

        Task.detached {
            defer { semaphore.signal() }

            do {
                let content = try await SCShareableContent.excludingDesktopWindows(
                    false,
                    onScreenWindowsOnly: false
                )

                let windows = content.windows.filter { window in
                    guard let owningApp = window.owningApplication else { return false }

                    let bundleID = owningApp.bundleIdentifier.lowercased()
                    let appName = owningApp.applicationName.lowercased()
                    let title = (window.title ?? "").lowercased()
                    let isAppleApp = bundleID.hasPrefix("com.apple.")

                    if bundleID == mirroringBundleID.lowercased() || bundleID == airPlayBundleID.lowercased() {
                        return true
                    }

                    // Fallback if Apple changes the bundle identifier.
                    if appName.contains("iphone mirroring") || appName.contains("mirroring") {
                        return true
                    }

                    // AirPlay receiver windows are typically owned by a system agent.
                    if appName.contains("airplay") || appName.contains("receiver") {
                        return true
                    }

                    // Best-effort heuristic: only include Apple-owned apps whose window title suggests an iOS device.
                    if isAppleApp && (title.contains("iphone") || title.contains("ipad")) {
                        return true
                    }

                    return false
                }

                fputs(
                    "[MirroringWindowEnumerator] iOS display windows found: \(windows.count)\n",
                    stderr
                )

                for window in windows {
                    let title = (window.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    let rawAppName = window.owningApplication?.applicationName ?? "iPhone Mirroring"

                    // Skip non-device utility windows (menu bar, hidden helper windows, etc.).
                    if title.lowercased() == "menubar" {
                        continue
                    }
                    if window.frame.width < 200 || window.frame.height < 200 {
                        continue
                    }

                    let udid = "window:\(window.windowID)"
                    let displayName = !title.isEmpty ? title : "\(rawAppName) (\(window.windowID))"
                    let model = determineModel(from: displayName) ?? "iOS Device"
                    fputs(
                        "[MirroringWindowEnumerator]  - \(displayName) [\(udid)] frame=\(window.frame)\n",
                        stderr
                    )
                    result.append(IOSDeviceInfo(udid: udid, name: displayName, model: model))
                }
            } catch {
                fputs(
                    "[MirroringWindowEnumerator] Failed to enumerate shareable windows: \(error)\n",
                    stderr
                )
            }
        }

        semaphore.wait()
        result.sort { $0.name < $1.name }
        return result
    }

    private static func determineModel(from name: String) -> String? {
        let lowerName = name.lowercased()
        if lowerName.contains("iphone") {
            return "iPhone"
        } else if lowerName.contains("ipad") {
            return "iPad"
        } else if lowerName.contains("ipod") {
            return "iPod"
        }
        return "iOS Device"
    }
}
