# Dock Colors

Choose a custom app icon color for Visual Studio Code Stable on macOS.

1. Build the helper from the project folder with `swiftc set-icon.swift -o set-icon` (requires Apple's command-line developer tools).
2. Open the project folder in VS Code and press F5 to run the extension.
3. In the Extension Development Host, open User Settings and search for `App Icon Color`.
4. Choose one of the built-in colors, including Dark. If the Dock still shows the previous icon, fully quit and reopen VS Code.

The setting applies to the VS Code app bundle used by the development host. The helper uses the same macOS custom icon mechanism as Finder. It requires write access to that copy of VS Code. Choose Default before removing the extension to clear its custom icon.

To compare the icons visually, open the Command Palette (Shift+Command+P) and run **Dock Colors: Preview App Icons**. Selecting an icon updates the same setting used by the Settings dropdown. The preview updates immediately. macOS manages when the Dock refreshes its cached icon.

In User Settings, the **App Icon Color** description has a clickable **Preview App Icons** action that opens the editor tab with the actual icon images.

To use a shared icon, set **Custom Icon Path** to the absolute path of a local PNG or ICNS file, then choose **Custom** under **App Icon Color**. The same image appears in the preview.

Use **Restart VS Code** in the App Icon Color setting after applying an icon. The extension asks VS Code to quit normally, then the helper waits for the application to exit and reopens it. If you cancel quitting, the helper stops waiting after one minute.
The preview shows each built-in color and its black-background version side by side. Click the image you want to apply. Custom files use the background in the supplied image.

## Distribution

Build a Universal Binary with Xcode Command Line Tools:

```sh
build_dir=$(mktemp -d)
swiftc -target arm64-apple-macos11.0 set-icon.swift -o "$build_dir/arm64"
swiftc -target x86_64-apple-macos11.0 set-icon.swift -o "$build_dir/x86_64"
lipo -create "$build_dir/arm64" "$build_dir/x86_64" -output set-icon
lipo -archs set-icon
```

Package from a clean staging directory containing only `package.json`,
`extension.js`, `set-icon`, `icon.png`, and `README.md`. Use
`npx @vscode/vsce package --target darwin-arm64` for Apple Silicon and
`npx @vscode/vsce package --target darwin-x64` for Intel. The same universal
helper can be used in both packages. The VSIX files can be attached to a
GitHub Release or uploaded to Visual Studio Marketplace under your publisher ID.
