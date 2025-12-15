# Screenshot Preview Feature

## Overview

The Screenshot Preview feature enhances the screenshot functionality by displaying a preview overlay after capturing a screenshot, allowing users to review the image and choose an action before saving.

## How to Use

1. **Take a Screenshot**
   - Click the screenshot button (camera icon) in the control toolbar
   - The screenshot will be captured from the device at its original resolution

2. **Preview Overlay**
   - A preview overlay appears showing the captured screenshot
   - The overlay displays a centered modal with:
     - Header: "Screenshot Preview" title (centered) with close button (×) in top-right corner
     - Image preview (scaled to fit viewport: max 85vw × 75vh)
     - Two action buttons with icons

3. **Available Actions**
   - **Save** (download icon): Save the screenshot to disk and open it in the editor
     - Uses the configured save path (`scrcpy.screenshotSavePath`) or Downloads folder
     - Respects the `scrcpy.screenshotShowSaveDialog` setting
     - Opens the saved image in VS Code editor

   - **Copy** (clipboard icon): Copy the screenshot image to the system clipboard
     - Uses the Clipboard API to copy the PNG image
     - Allows pasting the image directly into other applications
     - Automatically dismisses the preview after copying

   - **Close** (× button): Close the preview without saving
     - Located in top-right corner of the modal
     - Discards the screenshot
     - Returns to the normal device view

4. **Additional Features**
   - Click outside the preview modal to dismiss
   - Preview shows the full-resolution screenshot (scaled to fit viewport)
   - Consistent 12px spacing throughout the modal

## Configuration

### Settings

**`scrcpy.screenshotPreview`** (boolean, default: `true`)

- Show a preview overlay with save/copy options after taking a screenshot
- If disabled, screenshots are saved immediately without preview (legacy behavior)
- Can be toggled in VS Code settings: Settings > Extensions > Scrcpy for VS Code > Screenshots

### Related Settings

- **`scrcpy.screenshotSavePath`**: Custom directory for saving screenshots (default: Downloads folder)
- **`scrcpy.screenshotShowSaveDialog`**: Show file picker dialog when saving (default: false)

## Implementation Details

### Architecture

The feature is implemented across three main components:

1. **WebviewTemplate.ts** (UI)
   - Adds preview overlay HTML structure
   - Defines CSS styles for modal, backdrop, and buttons
   - Localizes button labels

2. **main.ts** (Webview Logic)
   - Handles `screenshotPreview` message from extension
   - Displays preview overlay with base64 image data
   - Implements action button handlers:
     - `saveScreenshot()`: Sends save request to extension
     - `copyScreenshotToClipboard()`: Converts base64 to blob and uses Clipboard API
     - `dismissScreenshotPreview()`: Hides overlay and clears data

3. **ScrcpyViewProvider.ts** (Extension)
   - Modified `_takeAndSaveScreenshot()` to check `screenshotPreview` setting
   - If enabled: Converts PNG buffer to base64 and sends to webview
   - If disabled: Saves immediately (legacy behavior)
   - Handles `saveScreenshot` message from webview
   - Implements `_saveScreenshotFromBase64()` to convert and save

### Message Flow

1. User clicks screenshot button → `screenshot` message sent to extension
2. Extension captures screenshot via `adb screencap`
3. Extension checks `scrcpy.screenshotPreview` setting:
   - **If enabled**: Converts buffer to base64 → sends `screenshotPreview` message to webview
   - **If disabled**: Saves immediately and opens in editor
4. Webview displays preview overlay with base64 image
5. User chooses action:
   - **Save**: Webview sends `saveScreenshot` message with base64 data → extension saves to disk
   - **Copy**: Webview converts base64 to blob → copies to clipboard via Clipboard API
   - **Dismiss**: Webview hides overlay and clears data

### Data Format

- Screenshots are captured as PNG buffers from `adb screencap -p`
- For preview: PNG buffer → base64 string (for embedding in `<img>` element)
- For clipboard: base64 → Uint8Array → Blob → ClipboardItem

### UI Design

- **Overlay**: Full-screen backdrop with blur effect (z-index: 100)
- **Modal**: Centered container with VS Code theme colors, 12px padding and gaps
- **Header**: Centered title with close button (×) absolutely positioned in top-right corner
- **Image**: Constrained to viewport units (max 85vw × 75vh), maintains aspect ratio with `object-fit: contain`
- **Buttons**: Both Save and Copy use primary button style with icons (download and clipboard)
- **Icons**: Material Design Icons (MDI) for buttons - download arrow for Save, clipboard for Copy
- **Spacing**: Consistent 12px spacing throughout (padding, gaps, button positioning)

## Testing

### Manual Testing Steps

1. **Basic Preview Flow**
   - Enable `scrcpy.screenshotPreview` setting (default)
   - Connect to a device
   - Click screenshot button
   - Verify preview overlay appears with correct image
   - Test all three buttons work correctly

2. **Save Action**
   - Click "Save" button in preview
   - Verify screenshot saves to configured path
   - Verify image opens in VS Code editor
   - Check image is original resolution (not scaled)

3. **Copy to Clipboard Action**
   - Click "Copy to Clipboard" button
   - Open an image editor or document
   - Paste (Ctrl+V / Cmd+V)
   - Verify image is pasted correctly

4. **Close Action**
   - Take a screenshot
   - Click the × button in the top-right corner
   - Verify overlay closes without saving
   - Take another screenshot to verify state is clean

5. **Click Outside to Dismiss**
   - Take a screenshot
   - Click on the dark backdrop area (outside the modal)
   - Verify overlay closes

6. **Legacy Mode**
   - Disable `scrcpy.screenshotPreview` setting
   - Take a screenshot
   - Verify it saves immediately without showing preview
   - Verify it opens in editor automatically

7. **Edge Cases**
   - Test with different device orientations (portrait/landscape)
   - Test with different screen resolutions
   - Test rapid screenshot button clicks
   - Test disconnecting device during preview

## Limitations

- Clipboard API requires secure context (works in VS Code webviews)
- Base64 conversion doubles memory usage temporarily (negligible for typical screenshots)
- Preview shows scaled version for large screenshots (original resolution maintained on save)

## Future Enhancements

Potential improvements for future versions:

- Auto-dismiss timer option (configurable timeout)
- Quick actions (e.g., share, annotate)
- Screenshot history/gallery
- Thumbnail cache for faster previews
- Keyboard shortcuts (Enter to save, Esc to dismiss)
- Zoom/pan controls for large screenshots
