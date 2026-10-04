import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let pid = Int32(CommandLine.arguments[1])!
let session = CGSessionCopyCurrentDictionary() as? [String: Any]
let onConsole = session?["kCGSessionOnConsoleKey"] as? Bool ?? false
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let appWindows = windows.filter {
    ($0[kCGWindowOwnerPID as String] as? Int32) == pid &&
    ($0[kCGWindowLayer as String] as? Int) == 0
}
// Permission probes never request a grant, change TCC, or capture a screen.
let result: [String: Any] = [
    "onConsole": onConsole,
    "appWindowCount": appWindows.count,
    "accessibilityGranted": AXIsProcessTrusted(),
    "screenCaptureGranted": CGPreflightScreenCaptureAccess(),
]
let bytes = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
FileHandle.standardOutput.write(bytes)
