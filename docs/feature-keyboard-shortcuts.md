# Keyboard Shortcuts for Tab Switching

## Overview

The scrcpy-vscode extension supports keyboard shortcuts for quickly switching between device tabs using `Alt+1` through `Alt+9` (and `Alt+0`). This feature allows you to rapidly navigate between multiple connected devices without using the mouse.

## Available Shortcuts

| Shortcut | Action                                                       |
| -------- | ------------------------------------------------------------ |
| `Alt+1`  | Switch to the 1st device tab                                 |
| `Alt+2`  | Switch to the 2nd device tab                                 |
| `Alt+3`  | Switch to the 3rd device tab                                 |
| `Alt+4`  | Switch to the 4th device tab                                 |
| `Alt+5`  | Switch to the 5th device tab                                 |
| `Alt+6`  | Switch to the 6th device tab                                 |
| `Alt+7`  | Switch to the 7th device tab                                 |
| `Alt+8`  | Switch to the 8th device tab                                 |
| `Alt+9`  | Switch to the 9th device tab                                 |
| `Alt+0`  | Switch to the 10th device tab (or last tab if fewer than 10) |

## Usage

### In the Webview

When the scrcpy view is focused (either in the primary or secondary sidebar), simply press `Alt` + the number key corresponding to the tab you want to switch to. The shortcuts work regardless of whether you're currently interacting with the device canvas or not.

**Example:**

- You have 3 devices connected
- Press `Alt+1` to switch to the first device
- Press `Alt+2` to switch to the second device
- Press `Alt+3` to switch to the third device
- Pressing `Alt+4` or higher will do nothing (no 4th tab exists)

### Via Command Palette

You can also access tab switching through the VS Code command palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux):

1. Open command palette
2. Type "Scrcpy: Switch to Tab"
3. Select the desired tab number (1-9)

## How It Works

The keyboard shortcuts are implemented at two levels:

### 1. Webview Level (Primary)

The main implementation is in the webview itself (`src/webview/main.ts`), which listens for `keydown` events:

- When `Alt+[1-9]` is pressed, the event is captured and prevented from bubbling
- The tab index is calculated (converting from 1-indexed to 0-indexed)
- A message is sent to the extension to switch to the specified tab
- The extension updates the active device, which pauses the current tab and resumes the target tab

This approach ensures the shortcuts work whenever the webview has focus.

### 2. VS Code Command Level (Secondary)

For additional flexibility, VS Code commands are also registered (`scrcpy.switchToTab1` through `scrcpy.switchToTab9`):

- These commands are registered in `package.json` with default keybindings
- The keybindings are contextual - they only activate when the scrcpy view is active
- Users can customize these keybindings in VS Code's Keyboard Shortcuts settings

## Customizing Keybindings

You can customize the keyboard shortcuts in VS Code settings:

1. Open **Keyboard Shortcuts** (`Cmd+K Cmd+S` on macOS, `Ctrl+K Ctrl+S` on Windows/Linux)
2. Search for "Scrcpy: Switch to Tab"
3. Click the pencil icon next to the command you want to change
4. Press your desired key combination
5. Press Enter to save

**Example:** Change `Alt+1` to `Ctrl+Shift+1`:

- Search for "Scrcpy: Switch to Tab 1"
- Click the pencil icon
- Press `Ctrl+Shift+1`
- Press Enter

## Implementation Details

### Architecture

The feature is implemented across three main components:

#### 1. Webview (`src/webview/main.ts`)

- **Event Listener**: A `keydown` event listener on the document captures `Alt+[0-9]` key combinations
- **Tab Index Calculation**: Converts the pressed key to a 0-based tab index
- **Tab Switching Function**: `switchToTabByIndex()` retrieves the device ID at the specified index and sends a message to the extension

```typescript
document.addEventListener('keydown', (e) => {
  if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
    const key = e.key;
    if (key >= '1' && key <= '9') {
      e.preventDefault();
      e.stopPropagation();
      const tabIndex = parseInt(key, 10) - 1;
      switchToTabByIndex(tabIndex);
    } else if (key === '0') {
      e.preventDefault();
      e.stopPropagation();
      const tabCount = sessions.size;
      if (tabCount > 0) {
        switchToTabByIndex(Math.min(9, tabCount - 1));
      }
    }
  }
});
```

#### 2. Extension (`src/extension.ts`)

- **Command Registration**: Registers 9 commands (`scrcpy.switchToTab1` through `scrcpy.switchToTab9`)
- **Provider Method**: Calls `provider.switchToTab(index)` to trigger the tab switch

```typescript
for (let i = 1; i <= 9; i++) {
  const cmd = vscode.commands.registerCommand(`scrcpy.switchToTab${i}`, () => {
    provider?.switchToTab(i - 1);
  });
  tabCommands.push(cmd);
}
```

#### 3. Provider (`src/ScrcpyViewProvider.ts`)

- **Message Handling**: Receives `switchToTabByIndex` message from webview
- **switchToTab Method**: Sends a message back to the webview with the tab index to switch to

```typescript
public switchToTab(index: number): void {
  if (!this._view) {
    return;
  }
  this._view.webview.postMessage({
    type: 'switchToTabByIndex',
    index,
  });
}
```

### Message Flow

**Webview Shortcut Flow:**

1. User presses `Alt+2` in the webview
2. Webview's keydown listener captures the event
3. `switchToTabByIndex(1)` is called (0-indexed)
4. Device ID at index 1 is retrieved from the tab bar
5. Message sent to extension: `{ type: 'switchTab', deviceId: '...' }`
6. Extension switches the active device via DeviceManager
7. Extension sends messages to webview to pause/resume renderers

**Command Palette Flow:**

1. User invokes "Scrcpy: Switch to Tab 2" from command palette
2. VS Code executes `scrcpy.switchToTab2` command
3. Extension calls `provider.switchToTab(1)` (0-indexed)
4. Provider sends message to webview: `{ type: 'switchToTabByIndex', index: 1 }`
5. Webview's `switchToTabByIndex(1)` is called
6. Same flow as webview shortcut from step 4 onwards

### Tab Order

Tabs are ordered in the DOM from left to right. The keyboard shortcuts respect this visual order:

- Tab 1 (Alt+1) = leftmost tab
- Tab 2 (Alt+2) = second tab from left
- Tab N (Alt+N) = Nth tab from left

When tabs are closed or reordered, the shortcuts automatically adapt to the current DOM order.

### Edge Cases

- **No tab at index**: If you press `Alt+5` but only have 3 tabs, nothing happens
- **Alt+0 behavior**: Switches to the 10th tab if it exists, otherwise to the last tab (useful for "go to last tab")
- **Duplicate prevention**: The shortcuts only work when the scrcpy view is active (prevents conflicts with other extensions)
- **Focus requirement**: The webview must have focus for the shortcuts to work (standard webview behavior)

## Accessibility

The keyboard shortcuts improve accessibility by providing a keyboard-only method to switch between device tabs. Users who prefer or require keyboard navigation can now efficiently manage multiple devices without using the mouse.

## Future Enhancements

Potential future improvements to this feature:

- **Cycle through tabs**: Add `Alt+Left/Right` to cycle through tabs sequentially
- **Last tab shortcut**: Add a dedicated shortcut to jump to the most recently active tab
- **Tab reordering**: Allow reordering tabs via keyboard shortcuts
- **Visual feedback**: Show a brief overlay indicating the tab number when switching
