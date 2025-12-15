# Enhanced Stats Feature

## Overview

The Enhanced Stats feature provides detailed real-time performance metrics for the scrcpy video stream, displaying FPS (Frames Per Second), bitrate, and dropped frame counts directly on the device view.

## What Each Metric Means

### FPS (Frames Per Second)

The number of video frames being decoded and rendered per second. This indicates how smoothly the video is playing:

- 60 FPS: Optimal performance (matches typical device refresh rate)
- 30 FPS: Acceptable for most use cases
- Below 30 FPS: May indicate performance issues or network constraints

### Bitrate

The amount of video data being transmitted per second, displayed in Kbps (kilobits per second) or Mbps (megabits per second):

- Higher bitrate = better video quality but more bandwidth usage
- Typical values: 2-8 Mbps for 1080p streaming
- The bitrate is calculated from actual received data, updated every second

### Dropped Frames

The number of frames that were dropped due to decoder queue overflow:

- 0 dropped frames: Ideal - decoder is keeping up with the stream
- Small number (1-5): Occasional drops, usually not noticeable
- High number: Indicates decoder cannot keep up - consider lowering video quality settings

## How to Enable

### Basic Stats (FPS only)

1. Open VS Code Settings (Cmd+, on macOS, Ctrl+, on Windows/Linux)
2. Search for "scrcpy stats"
3. Enable the **"Scrcpy: Show Stats"** checkbox

This displays basic FPS and frame count in the bottom-right corner of the device view.

### Extended Stats (FPS + Bitrate + Dropped Frames)

1. First, enable **"Scrcpy: Show Stats"** (see above)
2. Then enable **"Scrcpy: Show Extended Stats"**

This replaces the basic display with extended metrics:

```
FPS: 60 | Bitrate: 4.2 Mbps | Dropped: 0 frames
```

Note: Extended stats requires basic stats to be enabled. If you disable "Show Stats", the display will be hidden regardless of the extended stats setting.

## Implementation Details

### VideoRenderer Tracking

The `VideoRenderer` class tracks the following metrics:

#### Bytes Received

- Accumulates the size of all video frame data received
- Resets every second to calculate current bitrate
- Includes both config packets (SPS/PPS) and frame data

#### Frame Drops Detection

- Monitors the WebCodecs `VideoDecoder.decodeQueueSize` property
- Increments drop counter when queue size exceeds 10 frames
- This threshold indicates the decoder is falling behind the stream

#### Bitrate Calculation

```typescript
bitrate = (bytesReceivedInInterval * 8) / timeElapsed;
```

- Measured over 1-second intervals
- Converts bytes to bits (multiply by 8)
- Returns bits per second (bps)

### Display Formatting

#### Bitrate Display

- Values under 1000 Kbps: Displayed as "XXX Kbps" (e.g., "850 Kbps")
- Values 1000 Kbps and above: Displayed as "X.X Mbps" (e.g., "4.2 Mbps")

#### Stats Update Frequency

- Stats are recalculated every second (aligned with FPS calculation)
- Display updates immediately when metrics change
- Minimal performance impact due to efficient tracking

### Settings Integration

The feature integrates with VS Code's configuration system:

**Setting ID**: `scrcpy.showExtendedStats`

- Type: `boolean`
- Default: `false`
- Category: Display
- Order: Appears after "Show Stats" setting

Changes to this setting take effect immediately without requiring a reconnection to the device.

## Use Cases

### Performance Monitoring

Track FPS and dropped frames to identify performance bottlenecks:

- USB connection vs WiFi comparison
- Different device models
- Impact of video quality settings

### Network Analysis

Monitor bitrate to understand bandwidth usage:

- WiFi network quality assessment
- Compare different max size settings (720p, 1080p, 1440p, 1920p)
- Verify configured bitrate limits are being respected

### Debugging

Diagnose streaming issues:

- High dropped frames → decoder struggling (lower quality or FPS)
- Low bitrate with good network → possible encoder constraints
- Fluctuating FPS → network instability or device load

## Technical Notes

### Performance Impact

The stats tracking adds minimal overhead:

- Simple counter increments per frame
- Bitrate calculation once per second
- No additional memory allocations during streaming

### Accuracy

- FPS: Highly accurate, based on actual decoded frames
- Bitrate: Accurate representation of data received by the client
- Dropped frames: Conservative estimate based on decoder queue size

### Limitations

- Stats only appear when video is actively streaming
- Dropped frame detection is based on queue threshold (may not catch all drops)
- Bitrate reflects encoded stream size, not raw pixel data
- Stats are reset when switching between device tabs
