import Foundation
import Vision
import AppKit

// Read the actual simulator's rendered result. This keeps the smoke independent
// of Capacitor's logging configuration and exercises the WKWebView/native bridge.
guard CommandLine.arguments.count == 2,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
try VNImageRequestHandler(cgImage: cgImage).perform([request])
let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined()
    .filter { !$0.isWhitespace }.uppercased()
if text.contains("ULTRANATIVEKEYCHAINPASS") { print("iOS native Keychain/session smoke passed"); exit(0) }
// The fixture renders only a command number/name and a sanitized error code.
if text.contains("ULTRANATIVEKEYCHAINFAILED") { print("iOS native session smoke reported failure: \(text)"); exit(2) }
exit(1)
