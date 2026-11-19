import AppKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let args = CommandLine.arguments
let preview = args.last == "--preview"
let options = preview ? Array(args.dropLast()) : args
let blackBackground = options.last == "--black-background"
let parameters = blackBackground ? Array(options.dropLast()) : options
guard parameters.count == 3 || parameters.count == 4,
      let app = Bundle(path: args[1]),
      app.bundleURL.pathExtension == "app",
      app.bundleIdentifier == "com.microsoft.VSCode" else {
    fail("Expected a macOS Visual Studio Code stable application bundle.")
}

let workspace = NSWorkspace.shared
if args[2] == "--restart" {
    let appPath = app.bundleURL.resolvingSymlinksInPath().path
    let running = NSRunningApplication.runningApplications(withBundleIdentifier: "com.microsoft.VSCode")
        .filter { $0.bundleURL?.resolvingSymlinksInPath().path == appPath }
    let processIDs = running.map(\.processIdentifier).filter { $0 > 0 }
    guard !processIDs.isEmpty else { fail("Could not find the running VS Code application.") }
    let label = "local.vscode-dock-colors.restart." + UUID().uuidString
    let launchctl = URL(fileURLWithPath: "/bin/launchctl")
    let launcher = Process()
    launcher.executableURL = launchctl
    launcher.arguments = [
        "submit", "-l", label,
        "--", "/bin/sh", "-c", """
        app=$1
        label=$2
        shift 2
        trap '/bin/launchctl remove "$label"' EXIT
        for attempt in $(/usr/bin/jot 300); do
            running=no
            for pid in "$@"; do
                if kill -0 "$pid" 2>/dev/null; then running=yes; fi
            done
            if [ "$running" = no ]; then
                /bin/sleep 1
                /usr/bin/open -n -a "$app"
                exit $?
            fi
            /bin/sleep 0.2
        done
        """, "dock-colors-restart", appPath, label
    ] + processIDs.map(String.init)
    launcher.standardOutput = FileHandle.nullDevice
    do {
        try launcher.run()
        launcher.waitUntilExit()
        guard launcher.terminationStatus == 0 else { fail("macOS could not schedule the VS Code restart.") }
        let starter = Process()
        starter.executableURL = launchctl
        starter.arguments = ["kickstart", "gui/\(getuid())/\(label)"]
        starter.standardOutput = FileHandle.nullDevice
        try starter.run()
        starter.waitUntilExit()
        guard starter.terminationStatus == 0 else { fail("macOS could not start the VS Code restart job.") }
        FileHandle.standardOutput.write(Data("ready\n".utf8))
        exit(0)
    } catch {
        fail(error.localizedDescription)
    }
}

if args[2] == "Default" && !preview && !blackBackground {
    guard workspace.setIcon(nil, forFile: app.bundlePath) else {
        fail("macOS could not restore the original icon. Check write access to the app.")
    }
    exit(0)
}

let colors: [String: [Int]] = [
    "Purple": [150, 89, 245],
    "Pink": [245, 85, 161],
    "Green": [35, 190, 112],
    "Orange": [255, 137, 38],
    "Red": [249, 64, 77],
    "Teal": [31, 211, 213],
    "Lavender": [195, 169, 255],
    "Mint": [126, 247, 180],
    "Gold": [255, 204, 62],
    "Coral": [255, 122, 100],
    "Indigo": [96, 102, 255],
    "Sky": [99, 193, 255]
]
let color = args[2]
let source: URL
if color == "Custom" {
    guard parameters.count == 4, parameters[3].hasPrefix("/") else {
        fail("Set Custom Icon Path to the absolute path of a PNG or ICNS file.")
    }
    source = URL(fileURLWithPath: parameters[3])
    guard ["png", "icns"].contains(source.pathExtension.lowercased()) else {
        fail("Custom icons must be PNG or ICNS files.")
    }
} else {
    guard color == "Default" || color == "Dark" || colors[color] != nil,
          let iconName = app.object(forInfoDictionaryKey: "CFBundleIconFile") as? String,
          let iconURL = app.url(forResource: iconName,
                                withExtension: iconName.hasSuffix(".icns") ? nil : "icns") else {
        fail("Could not locate the original VS Code icon.")
    }
    source = iconURL
}
guard let original = NSImage(contentsOf: source) else {
    fail("Could not read the selected icon.")
}

original.size = NSSize(width: 512, height: 512)
var rect = NSRect(origin: .zero, size: original.size)
guard let bitmap = original.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
    fail("Could not rasterize the original icon.")
}
let width = bitmap.width
let height = bitmap.height
guard let context = CGContext(data: nil, width: width, height: height,
                              bitsPerComponent: 8, bytesPerRow: width * 4,
                              space: CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
      let data = context.data else {
    fail("Could not allocate the icon bitmap.")
}

context.draw(bitmap, in: CGRect(x: 0, y: 0, width: width, height: height))
let pixels = data.assumingMemoryBound(to: UInt8.self)
if color == "Dark" || (color != "Custom" && blackBackground) {
    for offset in stride(from: 0, to: width * height * 4, by: 4) {
        let alpha = Double(pixels[offset + 3])
        guard alpha > 0 else { continue }
        let rgb = (0..<3).map { Double(pixels[offset + $0]) / alpha }
        let lightness = min(rgb[0], rgb[1], rgb[2])
        let chroma = max(rgb[0], rgb[1], rgb[2]) - lightness

        // Darken the light neutral plate while preserving the blue logo and alpha.
        let lightWeight = min(1, max(0, (lightness - 0.60) / 0.27))
        let neutralWeight = max(0, 1 - chroma / 0.25)
        let weight = lightWeight * neutralWeight
        let plate = blackBackground ? [0.05, 0.05, 0.06] : [0.12, 0.13, 0.16]
        let tint = colors[color]
        for channel in 0..<3 {
            let foreground = tint.map { lightness + chroma * Double($0[channel]) / 255 } ?? rgb[channel]
            let value = foreground * (1 - weight) + plate[channel] * weight
            pixels[offset + channel] = UInt8(min(alpha, (value * alpha).rounded()))
        }
    }
} else if let tint = colors[color] {
    for offset in stride(from: 0, to: width * height * 4, by: 4) {
        let red = Int(pixels[offset])
        let green = Int(pixels[offset + 1])
        let blue = Int(pixels[offset + 2])
        let low = min(red, green, blue)
        let chroma = max(red, green, blue) - low

        for channel in 0..<3 {
            pixels[offset + channel] = UInt8(low + chroma * tint[channel] / 255)
        }
    }
}
guard let rendered = context.makeImage() else {
    fail("Could not render the selected color.")
}
if preview {
    guard let png = NSBitmapImageRep(cgImage: rendered).representation(using: .png, properties: [:]) else {
        fail("Could not encode the preview.")
    }
    print(png.base64EncodedString())
    exit(0)
}
let image = NSImage(cgImage: rendered, size: original.size)
guard workspace.setIcon(image, forFile: app.bundlePath) else {
    fail("macOS could not set a custom icon. Check write access to the app.")
}
