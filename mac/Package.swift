// swift-tools-version: 6.0
import PackageDescription

// Chompyy's Mac app: a thin SwiftUI shell over the `chompyy` CLI.
// Structure follows codeburn's mac/ (SwiftPM, no Xcode project). macOS 14 is the floor.
let package = Package(
    name: "Chompyy",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "Chompyy", targets: ["Chompyy"])],
    targets: [
        .executableTarget(
            name: "Chompyy",
            path: "Sources/Chompyy",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
