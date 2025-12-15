# Screen Recording Feature

## Overview

The screen recording feature allows you to capture the device screen as a video file directly from VS Code. The recording captures the canvas output at 60fps and saves it in WebM or MP4 format.

## Features

- **High-quality recording**: Captures at 60fps with 2.5 Mbps bitrate
- **Multiple formats**: Supports WebM (recommended) and MP4
- **Real-time feedback**: Shows recording duration with a visual indicator
- **Flexible saving**: Choose to show save dialog or use default path
- **Automatic timestamping**: Files are automatically named with timestamps

## Usage

### Starting a Recording

1. Connect to a device and ensure video is displayed
2. Click the record button (⏺) in the control toolbar, OR
3. Use the command palette: `Scrcpy: Toggle Screen Recording`

The record button will turn red and a recording indicator will appear showing elapsed time.

### Stopping a Recording

1. Click the record button again (now showing ⏹), OR
2. Use the command palette: `Scrcpy: Toggle Screen Recording`

A save dialog will appear (if enabled) or the file will be saved to the default location.

## Settings

### scrcpy.recordingFormat

**Type**: `string`
**Default**: `"webm"`
**Options**: `"webm"`, `"mp4"`

The output format for recordings.

- **WebM**: Recommended. Uses VP8 codec, widely supported in browsers and media players.
- **MP4**: May not work in all browsers due to codec limitations in the MediaRecorder API.

### scrcpy.recordingSavePath

**Type**: `string`
**Default**: `""` (Downloads folder)

The default directory where recordings are saved. Leave empty to use the Downloads folder.

### scrcpy.recordingShowSaveDialog

**Type**: `boolean`
**Default**: `true`

Whether to show a save dialog when stopping a recording. If `false`, recordings are automatically saved to `recordingSavePath`.

## Implementation Details

### Architecture

The screen recording feature is implemented using the MediaRecorder API, which captures the canvas output directly. This approach is simpler than re-encoding the raw H.264 stream and provides good quality.

**Key components:**

1. **RecordingManager.ts** (`src/webview/RecordingManager.ts`)
   - Manages the MediaRecorder lifecycle
   - Captures canvas stream using `canvas.captureStream(60)`
   - Collects recorded chunks into a Blob
   - Provides callbacks for state changes and completion

2. **WebView Integration** (`src/webview/main.ts`)
   - Creates RecordingManager instance per device session
   - Handles recording button clicks
   - Updates UI (button state, recording indicator, timer)
   - Sends recorded blob to extension for saving

3. **Extension Handler** (`src/ScrcpyViewProvider.ts`)
   - Receives recording data from webview
   - Shows save dialog or saves to default path
   - Generates timestamped filenames
   - Shows success notification with duration

4. **UI Components** (`src/webview/WebviewTemplate.ts`)
   - Record button with visual state (gray → red)
   - Recording indicator with red pulsing dot
   - Timer showing elapsed time (MM:SS format)

### Files Modified

- `package.json`: Added settings and command
- `l10n/bundle.l10n.json`: Added localization strings
- `src/extension.ts`: Registered toggleRecording command
- `src/ScrcpyViewProvider.ts`: Added recording message handlers and save logic
- `src/webview/RecordingManager.ts`: **NEW** - Core recording functionality
- `src/webview/main.ts`: Added recording integration and UI updates
- `src/webview/WebviewTemplate.ts`: Added recording button and indicator

### Data Flow

```
User clicks record button
  ↓
WebView: toggleRecording() → requests settings
  ↓
Extension: sends recordingSettings (format, isRecording)
  ↓
WebView: startRecordingWithSettings(format)
  ↓
RecordingManager: starts MediaRecorder
  ↓
Canvas frames captured at 60fps
  ↓
User clicks stop button
  ↓
WebView: stopRecording()
  ↓
RecordingManager: stops, creates Blob
  ↓
WebView: sends blob to extension via postMessage
  ↓
Extension: saves to file, shows notification
```

### Technical Approach

The implementation uses `canvas.captureStream()` to obtain a MediaStream from the canvas element. This stream is then passed to a MediaRecorder instance, which encodes the video in real-time.

**Why not re-encode H.264?**

- The H.264 stream from scrcpy is already compressed
- Re-encoding would require decoding and encoding again (CPU intensive)
- Canvas capture is simpler and provides good quality
- MediaRecorder API handles encoding efficiently

**Codec Selection:**

- WebM uses VP8 codec (highly compatible)
- MP4 support depends on browser/platform codec availability
- Falls back to WebM if MP4 is not supported

## Known Limitations

1. **MP4 Codec Support**: MP4 recording may not work in all browsers because MediaRecorder's codec support varies by platform. WebM is more universally supported.

2. **Audio Recording**: The current implementation records only video. Audio from the device is not included in recordings (audio is played in real-time but not captured).

3. **Quality vs File Size**: The bitrate is set to 2.5 Mbps for good quality. Higher bitrates can be configured in RecordingManager.ts if needed.

4. **Browser Limitations**: Recording depends on browser APIs (MediaRecorder, canvas.captureStream). These may have limitations in VS Code's embedded browser.

5. **Performance**: Recording at 60fps may impact performance on slower machines. The frame rate can be adjusted in RecordingManager.ts if needed.

## Future Enhancements

Potential improvements for future versions:

- **Audio capture**: Include device audio in recordings
- **Quality presets**: Add settings for bitrate/quality presets
- **Pause/resume**: Support pausing and resuming recordings
- **Custom frame rate**: Allow users to configure recording frame rate
- **Format auto-detection**: Detect best available format automatically
- **Recording shortcuts**: Add keyboard shortcuts for quick start/stop

## Testing

To test the screen recording feature:

1. **Basic Recording**
   - Start a device connection
   - Click the record button
   - Interact with the device
   - Stop recording after a few seconds
   - Verify the file is saved and playable

2. **Format Testing**
   - Change `scrcpy.recordingFormat` to "mp4"
   - Reconnect if needed
   - Test recording with MP4 format
   - Verify file is playable (or falls back to WebM if unsupported)

3. **Save Dialog**
   - Set `scrcpy.recordingShowSaveDialog` to `true`
   - Stop a recording
   - Verify save dialog appears
   - Choose a custom location and filename

4. **Default Path**
   - Set `scrcpy.recordingShowSaveDialog` to `false`
   - Set `scrcpy.recordingSavePath` to a custom directory
   - Stop a recording
   - Verify file is saved to the specified directory

5. **UI State**
   - Verify record button changes color (gray → red)
   - Verify recording indicator appears with pulsing dot
   - Verify timer counts up correctly
   - Verify button changes to stop icon during recording

6. **Edge Cases**
   - Try recording when no device is connected
   - Try recording when canvas has no content
   - Switch device tabs during recording
   - Disconnect device during recording
