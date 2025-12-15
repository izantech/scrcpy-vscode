# Microphone Capture Feature

## Overview

The microphone capture feature allows you to choose the audio source for streaming from your Android device. You can switch between capturing device playback audio (the default behavior) or capturing audio from the device's microphone.

## Use Cases

This feature is particularly useful for:

- **Voice Recording Applications**: Test voice recorder apps and monitor the microphone input in real-time
- **Video Calls and VoIP**: Test video calling apps like WhatsApp, Zoom, or Google Meet and hear the microphone input
- **Voice Commands**: Test voice assistant apps or speech recognition features
- **Audio Input Testing**: Verify microphone quality and behavior in different apps
- **Game Streaming**: Capture in-game voice chat or commentary from the device's microphone
- **Podcasting Apps**: Monitor podcast recording apps that use the device's microphone

## Configuration

The audio source is configured through the `scrcpy.audioSource` setting in VS Code settings.

### Available Options

- **output** (default): Captures device playback audio - everything the device is playing through speakers or headphones
- **mic**: Captures audio from the device's microphone

### How to Configure

1. Open VS Code Settings (File > Preferences > Settings or Cmd+,)
2. Search for "scrcpy audio"
3. Find the "Audio Source" setting
4. Select either:
   - "output" - Device playback audio (default)
   - "mic" - Device microphone

Alternatively, you can edit your `settings.json` directly:

```json
{
  "scrcpy.audioSource": "mic"
}
```

### Important Notes

- The `scrcpy.audio` setting must be enabled for audio source selection to work
- Changing the audio source requires reconnecting to the device (automatic when changed)
- Audio streaming requires scrcpy 2.0 or later

## Known Limitations

- **Device Compatibility**: Microphone capture may not work on all Android devices. Some manufacturers restrict microphone access in certain scenarios.
- **Audio Quality**: Microphone audio quality depends on the device's hardware and Android version.
- **Privacy Indicator**: On Android 12+, you may see a privacy indicator when the microphone is being captured.
- **Background Apps**: Some apps may restrict microphone access when running in the background.
- **Multiple Sources**: You can only capture one audio source at a time (either playback or microphone, not both).

## Implementation Details

### Server Parameter

The feature uses the scrcpy server's `audio_source` parameter:

- When `audioSource` is set to "mic", the server arg `audio_source=mic` is passed
- When `audioSource` is set to "output" (default), no explicit audio_source parameter is sent (server defaults to "output")

### Code Changes

The implementation adds the `audioSource` configuration option to:

1. **package.json**: Defines the setting with enum values "output" and "mic"
2. **package.nls.json**: Provides localized descriptions for the setting
3. **ScrcpyConfig interface** (ScrcpyConnection.ts): Adds `audioSource: 'output' | 'mic'` property
4. **Server arguments** (ScrcpyConnection.ts): Conditionally includes `audio_source=mic` when microphone is selected
5. **Configuration reader** (ScrcpyViewProvider.ts): Reads the `audioSource` setting from workspace configuration
6. **Configuration change listener** (ScrcpyViewProvider.ts): Triggers reconnection when audio source changes

### Audio Stream Protocol

The audio stream protocol remains unchanged regardless of audio source:

- Same Opus codec for both playback and microphone audio
- Same WebCodecs/Web Audio API playback pipeline
- Same packet structure and timing

The only difference is the source of the audio data on the device side.

## Troubleshooting

### Microphone not working

If microphone capture is not working:

1. **Check Android version**: Ensure your device is running Android 11 or later for best compatibility
2. **Check permissions**: Some devices may require granting microphone permission to the shell/system
3. **Try restarting ADB**: Sometimes `adb kill-server && adb start-server` helps
4. **Check device logs**: Run `adb logcat | grep scrcpy` to see server-side errors
5. **Try a different device**: Some manufacturers have restrictions on microphone capture

### No audio at all

If you're not hearing any audio:

1. Verify `scrcpy.audio` is enabled in settings
2. Check that the audio mute button is not active in the toolbar
3. Ensure your PC speakers/headphones are working and not muted
4. Try switching back to "output" mode to verify the audio pipeline is working

### Audio quality issues

If microphone audio quality is poor:

1. Check the device's microphone quality by recording directly on the device
2. Reduce the `scrcpy.maxFps` setting to lower bandwidth usage
3. Increase the `scrcpy.bitRate` setting (note: video bitrate only, audio uses fixed Opus encoding)
4. Ensure a stable USB connection or WiFi network

## Testing

To test the microphone capture feature:

1. Enable audio in settings: `"scrcpy.audio": true`
2. Set audio source to microphone: `"scrcpy.audioSource": "mic"`
3. Connect to your Android device
4. Speak into the device's microphone
5. Verify you can hear your voice through your PC speakers/headphones
6. Try switching back to "output" mode and play music on the device to verify both modes work

## References

- scrcpy audio source documentation: https://github.com/Genymobile/scrcpy/blob/master/doc/audio.md
- scrcpy server Options.java: Contains all available server parameters including `audio_source`
