// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ios-helper",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "ios-helper", targets: ["ios-helper"]),
        .executable(name: "ios-preview", targets: ["ios-preview"])
    ],
    targets: [
        .executableTarget(
            name: "ios-helper",
            dependencies: [],
            linkerSettings: [
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreMediaIO"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("ScreenCaptureKit")
            ]
        ),
        .executableTarget(
            name: "ios-preview",
            dependencies: [],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("CoreMediaIO"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreVideo")
            ]
        )
    ]
)
