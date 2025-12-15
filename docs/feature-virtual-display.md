# Virtual Display Feature

## Overview

The Virtual Display feature allows you to create a separate virtual display on your Android device instead of mirroring the main screen. This enables you to run apps in an isolated display environment without affecting the device's main screen.

## Use Cases

- Run and test apps in a separate display without interfering with the main screen
- Create a dedicated display for development/testing while using the device normally
- Test apps with different screen dimensions and DPI settings
- Isolate app testing from device notifications and other screen activity

## Configuration

The virtual display feature is configured through VS Code settings under the `scrcpy` namespace.

### Settings Reference

#### `scrcpy.displayMode`

- **Type:** `string`
- **Default:** `"mirror"`
- **Options:**
  - `"mirror"` - Mirror the device's main screen (default behavior)
  - `"virtual"` - Create a separate virtual display on the device

**Description:** Choose whether to mirror the device's main screen or create a virtual display.

#### `scrcpy.virtualDisplayWidth`

- **Type:** `number`
- **Default:** `1080`

**Description:** Width of the virtual display in pixels. Only applies when `scrcpy.displayMode` is set to `"virtual"`.

**Example values:**

- `720` - Compact display
- `1080` - Full HD width (default)
- `1440` - QHD width

#### `scrcpy.virtualDisplayHeight`

- **Type:** `number`
- **Default:** `1920`

**Description:** Height of the virtual display in pixels. Only applies when `scrcpy.displayMode` is set to `"virtual"`.

**Example values:**

- `1280` - HD height
- `1920` - Full HD height (default)
- `2560` - QHD height

#### `scrcpy.virtualDisplayDpi`

- **Type:** `number`
- **Default:** `0`

**Description:** DPI (dots per inch) of the virtual display. Set to `0` for automatic DPI calculation based on dimensions. Only applies when `scrcpy.displayMode` is set to `"virtual"`.

**Example values:**

- `0` - Auto-calculate DPI (default)
- `160` - MDPI (medium density)
- `240` - HDPI (high density)
- `320` - XHDPI (extra-high density)
- `480` - XXHDPI (extra-extra-high density)

## Usage Instructions

### Enabling Virtual Display

1. Open VS Code Settings (Cmd+, on macOS, Ctrl+, on Windows/Linux)
2. Search for "scrcpy display"
3. Change `Scrcpy: Display Mode` to `Virtual`
4. Optionally, customize the virtual display dimensions and DPI:
   - Set `Scrcpy: Virtual Display Width` (default: 1080)
   - Set `Scrcpy: Virtual Display Height` (default: 1920)
   - Set `Scrcpy: Virtual Display Dpi` (default: 0 for auto)
5. The connection will automatically reconnect with the new settings

### Launching Apps in Virtual Display

Once a virtual display is active:

1. Apps launched from VS Code will appear in the virtual display
2. The device's main screen remains unaffected
3. You can use the device normally while the virtual display is active
4. Touch input and controls work the same as in mirror mode

### Switching Back to Mirror Mode

1. Open VS Code Settings
2. Change `Scrcpy: Display Mode` back to `Mirror`
3. The connection will reconnect and mirror the main screen

## Implementation Details

### Server Configuration

When virtual display mode is enabled, the extension passes the `new_display` parameter to the scrcpy server:

- Format with DPI: `new_display=WIDTHxHEIGHT/DPI`
- Format without DPI: `new_display=WIDTHxHEIGHT`

**Example:**

- `new_display=1080x1920` - Creates a 1080x1920 virtual display with auto DPI
- `new_display=1080x1920/320` - Creates a 1080x1920 virtual display with 320 DPI

### Architecture

The virtual display is created by the scrcpy server on the Android device using the Android Display Manager API. The display is independent of the device's physical screen and exists purely in software.

Key points:

- The virtual display is destroyed when the scrcpy connection ends
- Multiple virtual displays can be created with different scrcpy sessions
- The virtual display inherits touch input from the scrcpy client
- All control features (rotation, screenshots, etc.) work the same way

### Reconnection Behavior

Changing any of the following settings triggers an automatic reconnection:

- `scrcpy.displayMode`
- `scrcpy.virtualDisplayWidth`
- `scrcpy.virtualDisplayHeight`
- `scrcpy.virtualDisplayDpi`

This ensures the virtual display is recreated with the new configuration.

## Known Limitations

1. **Android Version:** Virtual displays require Android API level 21 (Android 5.0 Lollipop) or higher

2. **Display Persistence:** The virtual display is destroyed when the scrcpy connection ends. It does not persist across disconnections.

3. **Screen Off:** The `scrcpy.screenOff` setting does not affect the virtual display (as it doesn't have a physical screen to turn off)

4. **Orientation Lock:** Virtual displays respect the `scrcpy.lockVideoOrientation` setting, but do not respond to physical device rotation

5. **App Compatibility:** Some apps may not function correctly in a virtual display, particularly:
   - Apps that explicitly check for physical display properties
   - Apps that require specific hardware features (camera, GPS, etc.)
   - Apps with DRM restrictions

6. **Performance:** Running apps in a virtual display requires additional CPU/GPU resources on the device, which may impact performance on lower-end devices

## Testing Notes

### Verifying Virtual Display

To verify that a virtual display is active:

1. Check the extension output - it should show the virtual display dimensions
2. The device's main screen should remain unchanged when interacting with scrcpy
3. Apps launched from scrcpy appear in the virtual display, not the main screen

### Test Scenarios

1. **Basic Functionality:**
   - Create virtual display with default settings
   - Verify touch input works correctly
   - Test control buttons (Home, Back, etc.)
   - Verify screen rotation works

2. **Custom Dimensions:**
   - Test various width/height combinations
   - Test portrait (1080x1920) and landscape (1920x1080) orientations
   - Verify aspect ratio is maintained in the canvas

3. **DPI Settings:**
   - Test auto DPI (0)
   - Test explicit DPI values (160, 240, 320, 480)
   - Verify text and UI elements scale appropriately

4. **Mode Switching:**
   - Switch from mirror to virtual mode
   - Switch from virtual to mirror mode
   - Verify settings persist across switches

5. **Multi-Device:**
   - Connect multiple devices with different display modes
   - Verify each device maintains its own display configuration

## Troubleshooting

### Virtual display not appearing

- Ensure your device runs Android 5.0 (API 21) or higher
- Check that scrcpy version supports virtual displays (2.0+)
- Verify the `scrcpy.displayMode` setting is set to `"virtual"`

### Apps not launching in virtual display

- Some apps may require explicit intent flags to launch in a virtual display
- Try launching the app manually after the virtual display is created
- Check device logs: `adb logcat | grep scrcpy`

### Poor performance

- Reduce virtual display dimensions (e.g., 720x1280)
- Lower video quality settings (`scrcpy.maxSize`, `scrcpy.bitRate`)
- Close other apps running on the device

### Touch input not working

- Verify the virtual display is active and connected
- Check that the canvas is properly focused (click on it)
- Try reconnecting the device

## References

- [scrcpy GitHub Repository](https://github.com/Genymobile/scrcpy)
- [Android Virtual Display API](https://developer.android.com/reference/android/hardware/display/VirtualDisplay)
- [scrcpy Server Options.java](/Users/izan/Dev/Projects/scrcpy/server/src/main/java/com/genymobile/scrcpy/Options.java)
