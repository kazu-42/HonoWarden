import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func isConsoleSession(_ session: [String: Any]?) -> Bool {
    // The SDK constant's value differs from its symbol name.
    session?[kCGSessionOnConsoleKey as String] as? Bool ?? false
}

let pid = Int32(CommandLine.arguments[1])!
let session = CGSessionCopyCurrentDictionary() as? [String: Any]
let onConsole = isConsoleSession(session)
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
    // Only a boolean is retained from other windows in the disposable guest.
    "securityAgentVisible": windows.contains {
        ($0[kCGWindowOwnerName as String] as? String) == "SecurityAgent" &&
        ($0[kCGWindowLayer as String] as? Int) == 0
    },
]
let bytes = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
FileHandle.standardOutput.write(bytes)
