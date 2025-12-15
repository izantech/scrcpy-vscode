# Device Info Panel

## Feature Overview

The Device Info Panel displays comprehensive information about connected Android devices when hovering over device tabs. This helps users quickly identify devices and monitor their status without needing to run separate ADB commands.

## Information Displayed

When hovering over a device tab, a tooltip appears showing:

- **Device Model**: Manufacturer and model name (e.g., "Samsung Galaxy S23")
- **Android Version**: OS version and SDK level (e.g., "Android 14 (SDK 34)")
- **Battery Status**: Battery level percentage with charging indicator (🔋 85% or 🔌 85% when charging)
- **Storage**: Used and total storage in GB (e.g., "Storage: 45.2 GB / 128 GB")
- **Screen Resolution**: Device screen dimensions (e.g., "1080 × 2340")
- **IP Address**: Device IP address when connected over WiFi (e.g., "192.168.1.100")

## Usage Instructions

1. **Connect a device** to scrcpy-vscode (USB or WiFi)
2. **Hover over the device tab** at the top of the scrcpy view
3. **View the device info tooltip** that appears below the tab
4. The tooltip shows all available device information
5. Move your mouse away to hide the tooltip

### Notes

- Device info is **cached for 30 seconds** to minimize ADB queries
- The first hover may show "Loading device info..." briefly while data is fetched
- The cache is automatically refreshed every 30 seconds in the background
- Battery level updates are included in the automatic refresh

## Implementation Details

### Architecture

The device info feature uses a client-server architecture:

1. **Webview (client)**: Displays tooltip and manages cache
2. **Extension (server)**: Fetches device info via ADB and caches results

### ADB Commands Used

The following ADB commands are used to gather device information:

```bash
# Device model
adb -s SERIAL shell getprop ro.product.model

# Manufacturer
adb -s SERIAL shell getprop ro.product.manufacturer

# Android version
adb -s SERIAL shell getprop ro.build.version.release

# SDK level
adb -s SERIAL shell getprop ro.build.version.sdk

# Battery status
adb -s SERIAL shell dumpsys battery

# Storage (df reports in KB by default)
adb -s SERIAL shell df /data

# Screen resolution
adb -s SERIAL shell wm size

# IP address (WiFi)
adb -s SERIAL shell ip route | grep wlan
```

### Caching Strategy

- **Client-side cache**: Webview caches device info by serial number
- **Server-side cache**: DeviceManager maintains a cache with 30-second TTL
- **Automatic refresh**: Background interval refreshes all connected devices every 30 seconds
- **On-demand fetch**: First hover triggers an immediate fetch if not cached

### Data Flow

1. User hovers over tab → webview checks local cache
2. If not cached → webview sends `getDeviceInfo` message to extension
3. Extension checks server cache (30s TTL)
4. If expired → extension runs ADB commands in parallel
5. Extension sends `deviceInfo` message back to webview
6. Webview updates cache and displays tooltip

## Testing Notes

### Manual Testing

To test the device info panel:

1. Connect an Android device via USB or WiFi
2. Wait for the device to appear in scrcpy-vscode
3. Hover over the device tab
4. Verify that the tooltip appears with all information
5. Check that each field displays correctly:
   - Model name is readable (replaces underscores with spaces)
   - Android version shows both version and SDK
   - Battery shows correct percentage and charging icon
   - Storage is formatted in GB with one decimal place
   - Resolution uses × symbol (not x)
   - IP address shows for WiFi devices

### Edge Cases

- **Unknown values**: If a property cannot be fetched, it shows "Unknown" or is omitted
- **Zero values**: Battery level of 0 and storage of 0 are hidden from display
- **WiFi vs USB**: IP address only appears for WiFi-connected devices
- **Multiple devices**: Each device has its own cache entry
- **Tab switching**: Tooltip hides when switching tabs
- **Close button**: Hovering over the × close button doesn't trigger the tooltip

### Performance

- **Parallel ADB queries**: All device properties are fetched in parallel using `Promise.all()`
- **Timeout**: Each ADB command has a 5-second timeout
- **Cache TTL**: 30-second cache reduces ADB load
- **Background refresh**: Periodic refresh happens for all connected devices

## Known Limitations

1. **Information availability**: Some info may not be available on all devices or Android versions
2. **Root-only data**: Certain properties may require root access (though none currently used)
3. **WiFi detection**: IP address extraction works for `wlan` interfaces only (not Ethernet or VPN)
4. **Storage reporting**: Uses `/data` partition which may not represent total device storage
5. **ADB dependency**: Requires working ADB connection (obvious, but worth noting)
6. **Emulators**: Emulator information may be less detailed than physical devices

## Future Enhancements

Potential improvements for future versions:

- Add CPU/RAM usage statistics
- Show device orientation (portrait/landscape)
- Display running apps count
- Show last screenshot timestamp
- Add refresh button to tooltip
- Support custom info fields via settings
- Persist cache across VS Code sessions
- Add visual battery level indicator (progress bar)
