# Troubleshooting

## "No Android devices found"

- Ensure device is connected via USB
- Check `adb devices` shows your device as "device" (not "unauthorized")
- Accept the USB debugging prompt on your device

## "Failed to get scrcpy version"

- Ensure scrcpy is installed: `scrcpy --version`
- Ensure scrcpy is in your PATH, or set `scrcpy.path` in settings

## "Disconnected from device"

- This can happen if Android Studio or another tool restarts ADB
- The extension will automatically attempt to reconnect
- If auto-reconnect fails, click the **Reconnect** button

## Video not displaying

- Open DevTools in the Extension Development Host (Help > Toggle Developer Tools)
- Check console for WebCodecs errors

## Audio not working

- Ensure `scrcpy.audio` is enabled in settings
- Audio requires scrcpy 2.0 or higher
- Check that your device supports audio forwarding (Android 11+)

## WiFi connection fails

- Ensure device and computer are on the same network
- For Android 11+, make sure Wireless debugging is enabled (not just USB debugging)
- Try disabling VPN or firewall temporarily
- The pairing address and connection address are different - use the correct one for each step

## High latency or lag

- Try lowering `scrcpy.maxSize` (e.g., 1080 instead of 1920)
- Reduce `scrcpy.bitRate` (e.g., 4 Mbps instead of 8)
- Use USB connection instead of WiFi for better performance
- Close other applications using the camera or screen recording

## Device not authorized

- Disconnect and reconnect the USB cable
- Check for the authorization dialog on your device
- Revoke USB debugging authorizations and re-authorize: Settings > Developer Options > Revoke USB debugging authorizations
