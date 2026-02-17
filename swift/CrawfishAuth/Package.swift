// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CrawfishAuth",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CrawfishAuth", targets: ["CrawfishAuth"]),
        .library(name: "CrawfishAuthUI", targets: ["CrawfishAuthUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", from: "10.0.0"),
        .package(url: "https://github.com/google/GoogleSignIn-iOS.git", from: "7.0.0"),
    ],
    targets: [
        .target(
            name: "CrawfishAuth",
            dependencies: [
                .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
                .product(name: "FirebaseFirestore", package: "firebase-ios-sdk"),
                .product(name: "GoogleSignIn", package: "GoogleSignIn-iOS"),
            ],
            path: "Sources/CrawfishAuth"
        ),
        .target(
            name: "CrawfishAuthUI",
            dependencies: ["CrawfishAuth"],
            path: "Sources/CrawfishAuthUI"
        ),
    ]
)
