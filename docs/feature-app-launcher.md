# App Launcher Feature

## Overview

The App Launcher feature allows you to launch installed applications on your Android device directly from VS Code. It provides a searchable list of all installed apps with their labels and package names.

## Features

- Browse all installed apps on the connected device
- Search apps by name or package name
- Launch apps with a single click
- Support for both system and third-party apps

## Usage

### Launching an App

1. Connect your Android device to VS Code using scrcpy
2. Click the rocket icon (🚀) in the scrcpy view title bar, or run the command "Scrcpy: Launch App on Device"
3. Wait for the extension to load the list of installed apps (this may take a few seconds)
4. Search for the app you want to launch by typing in the quick pick
   - You can search by app label (e.g., "Chrome", "Settings")
   - You can also search by package name (e.g., "com.android.chrome")
5. Select the app from the list
6. The app will launch on your device

### Command Reference

- **Command ID**: `scrcpy.launchApp`
- **Command Title**: "Launch App on Device"
- **Toolbar Icon**: Rocket (🚀)
- **Keyboard Shortcut**: None (can be customized in VS Code keyboard shortcuts)

## Implementation Details

### Architecture

The app launcher feature is implemented across several components:

1. **ScrcpyConnection.ts**: Low-level communication with the device
   - `getInstalledApps(thirdPartyOnly: boolean)`: Fetches the list of installed apps via ADB
   - `startApp(packageName: string)`: Sends the START_APP control message to the scrcpy server

2. **DeviceManager.ts**: Device session management
   - `getInstalledApps(thirdPartyOnly: boolean)`: Delegates to the active device's connection
   - `launchApp(packageName: string)`: Delegates to the active device's connection

3. **ScrcpyViewProvider.ts**: UI and command handling
   - `launchApp()`: Shows the app picker and handles user selection

4. **extension.ts**: Command registration
   - Registers the `scrcpy.launchApp` command

### Control Message Format

The START_APP control message follows the scrcpy protocol (from `ControlMessageReader.java`):

```
Offset  Size  Field
0       1     Type (16 = TYPE_START_APP)
1       1     Name length (8-bit integer, max 255)
2       n     Package name (UTF-8 string)
```

Example for launching "com.android.settings":

- Byte 0: 0x10 (16 = TYPE_START_APP)
- Byte 1: 0x14 (length = 20)
- Bytes 2-21: "com.android.settings" (UTF-8)

Total message size: 1 + 1 + 20 = 22 bytes

**Note**: Unlike other string messages in the scrcpy protocol (like `INJECT_TEXT` and `SET_CLIPBOARD` which use 4-byte length prefixes), `START_APP` uses a 1-byte length prefix as defined in `ControlMessageReader.parseStartApp()` which calls `parseString(1)`.

### ADB Commands Used

The feature uses the following ADB command:

- **List packages**: `adb shell pm list packages [-3]`
  - Lists all packages (or only third-party apps with `-3` flag)
  - Output format: `package:com.example.app`

### Files Modified

- `/Users/izan/Dev/Projects/scrcpy-vscode-app-launcher/src/ScrcpyProtocol.ts`
  - Already had `START_APP = 16` constant defined

- `/Users/izan/Dev/Projects/scrcpy-vscode-app-launcher/src/ScrcpyConnection.ts`
  - Added `startApp(packageName: string)` method (lines 1110-1132)
  - Added `getInstalledApps(thirdPartyOnly: boolean)` method (lines 1139-1181)

- `/Users/izan/Dev/Projects/scrcpy-vscode-app-launcher/src/DeviceManager.ts`
  - Added `launchApp(packageName: string)` method (lines 757-763)
  - Added `getInstalledApps(thirdPartyOnly: boolean)` method (lines 768-776)

- `/Users/izan/Dev/Projects/scrcpy-vscode-app-launcher/src/ScrcpyViewProvider.ts`
  - Added `launchApp()` method (lines 753-810)

- `/Users/izan/Dev/Projects/scrcpy-vscode-app-launcher/src/extension.ts`
  - Registered `scrcpy.launchApp` command (lines 45-48, 61)

- `/Users/izan/Dev/Projects/scrcpy-vscode-app-launcher/package.json`
  - Added command definition (lines 257-261)
  - Added view title button (lines 280-284)

- `/Users/izan/Dev/Projects/scrcpy-vscode-app-launcher/l10n/bundle.l10n.json`
  - Added localization strings for the feature

## Performance Considerations

### App List Caching

The current implementation does NOT cache the app list. Each time you open the app launcher, it fetches the list from the device via ADB. This ensures the list is always up-to-date but may take a few seconds on devices with many apps.

**Future Enhancement**: Consider implementing an in-memory cache per device that:

- Caches the app list after the first fetch
- Provides a "Refresh" button to reload the list
- Automatically invalidates the cache when an APK is installed via the extension

### Label Resolution

The current implementation displays package names directly without attempting to resolve human-readable app labels. This approach is faster and more reliable than attempting label extraction via ADB commands.

## Known Limitations

1. **No Human-Readable Labels**: Apps are displayed by package name only (e.g., `com.android.chrome` instead of "Chrome"). This is a deliberate simplification for reliability.

2. **No App Icons**: The current implementation does not show app icons in the quick pick. Only labels and package names are displayed.

3. **No Filtering Options**: All apps (system and third-party) are shown by default. There is no UI toggle to filter only third-party apps, though the backend supports it via the `thirdPartyOnly` parameter.

4. **No Recent Apps**: The app list is sorted alphabetically, not by recent usage or frequency.

5. **Launch Confirmation**: The scrcpy server attempts to launch the app, but there is no confirmation from the server whether the launch was successful. The app opening on the device serves as visual confirmation.

## Testing

### Manual Testing Steps

1. **List apps and verify common apps appear**:
   - Connect an Android device
   - Click the rocket icon
   - Verify that common apps like Settings, Chrome, and other installed apps appear in the list

2. **Launch Settings app**:
   - Search for "Settings" in the quick pick
   - Select "Settings" (com.android.settings)
   - Verify that the Settings app opens on the device

3. **Launch Chrome**:
   - Search for "Chrome"
   - Select "Chrome" (com.android.chrome)
   - Verify that Chrome opens on the device

4. **Test with device that has many apps**:
   - Connect a device with 50+ apps installed
   - Verify that the app list loads within a reasonable time (< 10 seconds)
   - Verify that all apps are listed

5. **Test search filtering**:
   - Open the app launcher
   - Type "chrom" in the search box
   - Verify that Chrome appears in the filtered results
   - Type "com.android" in the search box
   - Verify that system apps with package names starting with "com.android" appear

6. **Test error handling**:
   - Disconnect the device
   - Try to launch an app
   - Verify that an error message appears: "No device connected"

## Scrcpy Server Reference

The feature uses the scrcpy server's built-in app launching capability. The server-side implementation can be found in:

- `/Users/izan/Dev/Projects/scrcpy/server/src/main/java/com/genymobile/scrcpy/control/ControlMessage.java`
  - Line 26: `public static final int TYPE_START_APP = 16;`
  - Lines 162-167: `createStartApp(String name)` factory method

- `/Users/izan/Dev/Projects/scrcpy/server/src/main/java/com/genymobile/scrcpy/control/Controller.java`
  - Lines 328-330: Message handling for TYPE_START_APP
  - Lines 644-694: `startApp(String name)` implementation
  - Lines 696-714: `getStartAppDisplayId()` helper method

The server supports:

- Launching apps by package name (e.g., "com.android.settings")
- Launching apps by search name using "?name" syntax (e.g., "?Chrome")
- Force-stopping before launch using "+package" syntax (e.g., "+com.android.chrome")

**Note**: The current VS Code extension implementation only supports launching by package name. The search name and force-stop features are available in the scrcpy server but not exposed in the UI.

## Future Enhancements

Potential improvements for the app launcher feature:

1. **App Icon Support**: Display app icons in the quick pick for better visual identification
2. **Recent Apps**: Show recently launched apps at the top of the list
3. **Favorites**: Allow users to mark favorite apps for quick access
4. **App Categories**: Group apps by category (system, third-party, games, etc.)
5. **App Info**: Show additional app information (version, install date, size)
6. **Launch Options**: Support force-stop before launch using the "+package" syntax
7. **Search by Name**: Support the "?name" syntax for searching by app label
8. **Multiple Devices**: Support launching apps on specific devices in multi-device sessions
9. **Keyboard Shortcut**: Add a default keyboard shortcut for quick app launching
10. **Cache Management**: Implement smart caching with automatic invalidation

## Troubleshooting

### App list is empty or incomplete

**Possible causes**:

- Device is not connected
- ADB is not working properly
- Permissions issue on the device

**Solutions**:

- Verify device is connected: `adb devices`
- Check ADB version: `adb version`
- Restart ADB server: `adb kill-server && adb start-server`
- Enable USB debugging on the device

### App doesn't launch after selection

**Possible causes**:

- App is not installed
- Package name is incorrect
- Device is locked or screen is off

**Solutions**:

- Verify the app is installed: `adb shell pm list packages | grep <package>`
- Check device is unlocked
- Try launching the app manually via ADB: `adb shell am start <package>/.MainActivity`

### "Loading installed apps..." takes too long

**Possible causes**:

- Device has many apps (100+)
- Slow USB connection
- Device is busy

**Solutions**:

- Wait for the operation to complete (may take up to 30 seconds for 200+ apps)
- Use a faster USB connection (USB 3.0 instead of USB 2.0)
- Close unnecessary apps on the device to free up resources

## See Also

- [AGENTS.md](/Users/izan/Dev/Projects/scrcpy-vscode-app-launcher/AGENTS.md) - Development commands and guidelines
- [docs/internals.md](/Users/izan/Dev/Projects/scrcpy-vscode-app-launcher/docs/internals.md) - Technical implementation details
- [Scrcpy GitHub](https://github.com/Genymobile/scrcpy) - Upstream scrcpy project
