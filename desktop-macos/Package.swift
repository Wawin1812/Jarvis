// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "JarvisDesktop",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "JarvisDesktop", targets: ["JarvisDesktop"])],
    targets: [.executableTarget(name: "JarvisDesktop", path: "Sources/JarvisDesktop")]
)
