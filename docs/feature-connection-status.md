# Connection Status in Tabs

## Feature Overview

The connection status feature provides visual feedback about the connection state of each device directly in the tab bar. Each device tab displays a colored indicator that shows the current connection state.

## Visual States

### 1. Connecting (Blue - Pulsing)

- **Color**: Blue (#0078d4)
- **Animation**: Pulsing dot that scales and fades
- **When shown**: When initially connecting to a device or when the connection process is in progress
- **Description**: Indicates that the extension is attempting to establish a connection to the device

### 2. Connected (Green - Solid)

- **Color**: Green (#4ec9b0)
- **Animation**: None (solid)
- **When shown**: When successfully connected and streaming video from the device
- **Description**: Indicates a healthy, active connection with video/audio streaming

### 3. Disconnected (Gray - Solid)

- **Color**: Gray (#808080)
- **Animation**: None (solid)
- **When shown**: When connection fails or is manually closed
- **Description**: Indicates no active connection to the device

### 4. Reconnecting (Orange - Pulsing)

- **Color**: Orange (#ce9178)
- **Animation**: Pulsing dot that scales and fades
- **When shown**: When the connection was lost and auto-reconnect is attempting to restore it
- **Description**: Indicates that the extension is attempting to automatically reconnect after an unexpected disconnect

## Implementation Details

### Architecture

The connection status feature is implemented across three main layers:

1. **Backend (DeviceManager.ts)**
   - Tracks connection state for each device session
   - Notifies the frontend when state changes occur
   - Connection states: `connecting`, `connected`, `disconnected`, `reconnecting`

2. **Bridge (ScrcpyViewProvider.ts)**
   - Receives connection state callbacks from DeviceManager
   - Sends `connectionStateChanged` messages to the webview

3. **Frontend (main.ts + WebviewTemplate.ts)**
   - Receives state change messages
   - Updates tab UI with appropriate visual indicators
   - Applies CSS classes to show colors and animations

### State Transitions

```
[Initial] -> connecting
  ↓
  ├─> connected (on successful connection)
  │   ↓
  │   ├─> reconnecting (on unexpected disconnect with auto-reconnect enabled)
  │   │   ↓
  │   │   ├─> connected (reconnect successful)
  │   │   └─> disconnected (all retries exhausted)
  │   └─> disconnected (on manual disconnect or connection loss without auto-reconnect)
  └─> disconnected (on connection failure)
```

### Code Components

#### DeviceSession (DeviceManager.ts)

```typescript
class DeviceSession {
  public connectionState: ConnectionState = 'connecting';

  async connect(): Promise<void> {
    this.connectionState = 'connecting';
    this.connectionStateCallback(this.deviceId, 'connecting');

    try {
      // ... connection logic ...
      this.connectionState = 'connected';
      this.connectionStateCallback(this.deviceId, 'connected');
    } catch (error) {
      this.connectionState = 'disconnected';
      this.connectionStateCallback(this.deviceId, 'disconnected');
      throw error;
    }
  }

  private async handleDisconnect(error: string): Promise<void> {
    // Retry loop for auto-reconnect
    while (this.retryCount < maxRetries && !this.isDisposed) {
      this.connectionState = 'reconnecting';
      this.connectionStateCallback(this.deviceId, 'reconnecting');

      // ... reconnect logic ...
    }

    // All retries exhausted
    this.connectionState = 'disconnected';
    this.connectionStateCallback(this.deviceId, 'disconnected');
  }
}
```

#### Tab HTML Structure (main.ts)

```html
<div class="tab">
  <div class="tab-status tab-status-connecting">
    <div class="tab-status-dot"></div>
  </div>
  <svg class="tab-icon">...</svg>
  <span class="tab-label">Device Name</span>
  <span class="tab-close">×</span>
</div>
```

#### CSS Styling (WebviewTemplate.ts)

```css
.tab-status-connecting .tab-status-dot {
  background-color: #0078d4;
  animation: pulse 1.5s ease-in-out infinite;
}

.tab-status-connected .tab-status-dot {
  background-color: #4ec9b0;
}

.tab-status-disconnected .tab-status-dot {
  background-color: #808080;
}

.tab-status-reconnecting .tab-status-dot {
  background-color: #ce9178;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.8);
  }
}
```

### Message Protocol

The extension communicates connection state changes via the following message:

```typescript
{
  type: 'connectionStateChanged',
  deviceId: string,
  state: 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
}
```

The webview also receives the connection state in the `sessionList` message:

```typescript
{
  type: 'sessionList',
  sessions: [{
    deviceId: string,
    deviceInfo: { serial: string, name: string },
    isActive: boolean,
    connectionState: 'connecting' | 'connected' | 'disconnected' | 'reconnecting'
  }]
}
```

## User Experience

### Normal Connection Flow

1. User connects a device or starts the extension
2. Tab appears with **blue pulsing** indicator (connecting)
3. After 1-3 seconds, indicator turns **solid green** (connected)
4. Video starts streaming, device is ready for interaction

### Auto-Reconnect Flow

1. Connection is lost unexpectedly (e.g., ADB restart)
2. Indicator changes to **orange pulsing** (reconnecting)
3. Status message shows "Reconnecting (attempt 1/2)..."
4. Either:
   - Reconnect succeeds → indicator turns **solid green** (connected)
   - All retries fail → indicator turns **solid gray** (disconnected), error shown

### Manual Disconnect

1. User clicks the × button on a tab
2. Indicator briefly shows **gray** (disconnected) before tab is removed
3. Tab disappears from the tab bar

## Design Decisions

### Color Choices

- **Blue**: Standard VS Code accent color, indicates activity/progress
- **Green**: Success/healthy state, commonly understood
- **Gray**: Inactive/neutral state, low emphasis
- **Orange**: Warning/retry state, between success and error

### Animation

- Pulsing animation draws attention to transient states (connecting/reconnecting)
- Solid colors for stable states (connected/disconnected)
- 1.5-second pulse cycle provides smooth, non-distracting movement
- Scale change (1.0 → 0.8) combined with opacity (1.0 → 0.5) creates clear pulse effect

### Placement

- Status indicator is placed at the start of the tab (before icon)
- Small size (8px dot in 12px container) keeps it unobtrusive
- Consistent positioning across all tabs for easy scanning

## Testing

To test the connection status feature:

1. **Normal connection**: Connect a device and observe blue → green transition
2. **Connection failure**: Try to connect with device unplugged, observe blue → gray
3. **Auto-reconnect**:
   - Connect a device (green indicator)
   - Restart ADB server (`adb kill-server`)
   - Observe green → orange → green transition
4. **Reconnect failure**:
   - Connect a device (green indicator)
   - Unplug the device
   - Observe green → orange → gray transition (after retries exhausted)
5. **Multiple devices**: Connect multiple devices, verify each tab shows independent status
6. **Tab switching**: Switch between tabs, verify status indicators remain accurate

## Future Enhancements

Potential improvements for future versions:

1. **Tooltip on hover**: Show detailed state information when hovering over the status dot
2. **Error details**: Include error reason in disconnected state (e.g., "USB disconnected", "ADB error")
3. **Connection quality**: Add intermediate states like "connected (unstable)" with yellow color
4. **Manual reconnect**: Add reconnect button on hover when in disconnected state
5. **Connection history**: Track connection/disconnection events for debugging
6. **Customizable colors**: Allow users to configure state colors via settings
