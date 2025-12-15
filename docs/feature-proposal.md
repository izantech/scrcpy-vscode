# Feature Proposal

This document contains proposed new features for the scrcpy-vscode extension, organized by category and prioritized by impact.

## Video & Streaming

| Feature                      | Description                                                 | Impact |
| ---------------------------- | ----------------------------------------------------------- | ------ |
| **Camera Mirroring**         | Mirror device front/back camera instead of screen display   | High   |
| **Screen Recording**         | Record device screen to video file (MP4/WebM)               | High   |
| **Virtual Display**          | Create a separate virtual display instead of mirroring main | Medium |
| **Multiple Display Support** | Select which physical display to mirror (external monitors) | Medium |
| **H.265/AV1 Codec**          | Support newer video codecs for better quality/compression   | Low    |

## Input & Control

| Feature                | Description                                                    | Impact |
| ---------------------- | -------------------------------------------------------------- | ------ |
| **App Launcher**       | Launch apps by package name from a searchable list             | High   |
| **Quick Panel Access** | Buttons to open notification/settings panels                   | Medium |
| **Gesture Support**    | Two-finger pinch-to-zoom on canvas                             | Medium |
| **UHID Keyboard**      | Hardware keyboard simulation for better game/app compatibility | Low    |

## Audio

| Feature                    | Description                                        | Impact |
| -------------------------- | -------------------------------------------------- | ------ |
| **Microphone Capture**     | Record device microphone instead of playback audio | Medium |
| **Audio Source Selection** | Choose between playback, mic, voice calls, etc.    | Low    |

## Information & Status

| Feature                       | Description                                                         | Impact |
| ----------------------------- | ------------------------------------------------------------------- | ------ |
| **Device Info Panel**         | Show model, Android version, battery, storage on hover/click        | High   |
| **Enhanced Stats**            | Display bitrate, latency, frame drops alongside FPS                 | Medium |
| **Connection Status in Tabs** | Visual indicator of connecting/connected/disconnected state per tab | Medium |

## Quality of Life

| Feature                         | Description                                          | Impact |
| ------------------------------- | ---------------------------------------------------- | ------ |
| **Drag & Drop File Upload**     | Drag files from VS Code explorer to canvas to upload | High   |
| **Screenshot Preview**          | Show thumbnail preview after taking screenshot       | Medium |
| **Keyboard Shortcuts for Tabs** | Alt+1, Alt+2, etc. to switch between device tabs     | Medium |
| **Crop Region**                 | Mirror only a specific portion of the screen         | Low    |

## Top 5 Recommendations

1. **Camera Mirroring** - Unique capability, useful for debugging camera apps
2. **Screen Recording** - Highly requested feature, natural extension of streaming
3. **App Launcher** - Scrcpy already supports it (TYPE_START_APP), easy to implement
4. **Device Info Panel** - Low effort, high value for multi-device workflows
5. **Drag & Drop File Upload** - Great UX improvement for developer workflows
