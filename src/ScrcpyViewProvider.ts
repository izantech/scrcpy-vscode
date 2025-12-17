import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { getHtmlForWebview } from './webview/WebviewTemplate';
import { ScrcpyConfig } from './ScrcpyConnection';
import { DeviceService } from './DeviceService';
import { AppStateManager, Unsubscribe } from './AppStateManager';
import { ToolCheckResult } from './ToolChecker';
import { ToolNotFoundError, ToolErrorCode, DeviceUISettings } from './types/AppState';

export class ScrcpyViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'scrcpy.deviceView';
  private static readonly DEVICE_SETTINGS_CACHE_KEY = 'deviceSettingsCache';

  private _view?: vscode.WebviewView;
  private _appState?: AppStateManager;
  private _deviceService?: DeviceService;
  private _stateUnsubscribe?: Unsubscribe;
  private _disposables: vscode.Disposable[] = [];
  private _isDisposed = false;
  private _abortController?: AbortController;
  private _toolStatus?: ToolCheckResult;
  private _globalState?: vscode.Memento;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    toolStatus?: ToolCheckResult,
    globalState?: vscode.Memento
  ) {
    this._toolStatus = toolStatus;
    this._globalState = globalState;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    // Clean up any previous state (resolveWebviewView can be called multiple times when view is moved)
    while (this._disposables.length) {
      this._disposables.pop()?.dispose();
    }

    // Abort any pending async operations from the previous view
    this._abortController?.abort();
    this._abortController = new AbortController();

    // Unsubscribe from previous state changes
    this._stateUnsubscribe?.();
    this._stateUnsubscribe = undefined;

    // Disconnect any existing device service (may still exist if view was moved, not disposed)
    if (this._deviceService) {
      this._deviceService.stopDeviceMonitoring();
      this._deviceService.disconnectAll().catch(() => {});
      this._deviceService = undefined;
      this._appState = undefined;
    }

    // Reset disposed state
    this._isDisposed = false;

    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        await this._onDidReceiveMessage(message);
      },
      null,
      this._disposables
    );

    // Handle view disposal - only clean up if this is still the current view
    // (prevents race condition when view is moved between sidebars)
    webviewView.onDidDispose(
      () => {
        if (this._view === webviewView) {
          this._onViewDisposed().catch(console.error);
        }
      },
      null,
      this._disposables
    );

    // Auto-connect when view becomes visible
    webviewView.onDidChangeVisibility(
      () => {
        if (webviewView.visible && !this._deviceService) {
          this._initializeAndConnect();
        }
      },
      null,
      this._disposables
    );

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration(
      async (e) => {
        if (e.affectsConfiguration('scrcpy')) {
          // Send settings updates that don't require reconnect
          if (
            e.affectsConfiguration('scrcpy.showStats') ||
            e.affectsConfiguration('scrcpy.showExtendedStats') ||
            e.affectsConfiguration('scrcpy.audio')
          ) {
            this._sendSettings();
          }

          // Reconnect for scrcpy options that affect the stream
          const reconnectSettings = [
            'scrcpy.path',
            'scrcpy.adbPath',
            'scrcpy.displayMode',
            'scrcpy.virtualDisplayWidth',
            'scrcpy.virtualDisplayHeight',
            'scrcpy.virtualDisplayDpi',
            'scrcpy.videoCodec',
            'scrcpy.screenOff',
            'scrcpy.stayAwake',
            'scrcpy.maxSize',
            'scrcpy.bitRate',
            'scrcpy.maxFps',
            'scrcpy.showTouches',
            'scrcpy.audio',
            'scrcpy.audioSource',
            'scrcpy.lockVideoOrientation',
            'scrcpy.videoSource',
            'scrcpy.cameraFacing',
            'scrcpy.cameraId',
            'scrcpy.cameraSize',
            'scrcpy.cameraFps',
            'scrcpy.crop',
            'scrcpy.displayId',
            'scrcpy.keyboardMode',
          ];
          const needsReconnect = reconnectSettings.some((s) => e.affectsConfiguration(s));

          if (needsReconnect && this._deviceService) {
            this._appState?.setStatusMessage({
              type: 'loading',
              text: vscode.l10n.t('Settings changed. Reconnecting...'),
            });
            this._deviceService.updateConfig(this._getConfig());
            await this._deviceService.disconnectAll();
            await this._autoConnectAllDevices();

            // Clear loading message if devices connected successfully
            // (empty state and errors are handled within _autoConnectAllDevices and removeDevice)
            if (this._appState && this._appState.getDeviceCount() > 0) {
              this._appState.clearStatusMessage();
            }
          }
        }
      },
      null,
      this._disposables
    );

    // Initial connection if view is already visible
    if (webviewView.visible) {
      this._initializeAndConnect();
    }
  }

  /**
   * Update tool status (called from extension.ts after re-check)
   */
  public updateToolStatus(toolStatus: ToolCheckResult): void {
    this._toolStatus = toolStatus;
    // Update AppStateManager if it exists (state snapshot will be sent automatically)
    if (this._appState) {
      this._appState.updateToolStatus({
        adbAvailable: toolStatus.adb.isAvailable,
        scrcpyAvailable: toolStatus.scrcpy.isAvailable,
      });
    }
  }

  private _getConfig(): ScrcpyConfig {
    const config = vscode.workspace.getConfiguration('scrcpy');
    return {
      scrcpyPath: config.get<string>('path', ''),
      adbPath: config.get<string>('adbPath', ''),
      displayMode: config.get<'mirror' | 'virtual'>('displayMode', 'mirror'),
      virtualDisplayWidth: config.get<number>('virtualDisplayWidth', 1080),
      virtualDisplayHeight: config.get<number>('virtualDisplayHeight', 1920),
      virtualDisplayDpi: config.get<number>('virtualDisplayDpi', 0),
      videoCodec: config.get<'h264' | 'h265' | 'av1'>('videoCodec', 'h264'),
      screenOff: config.get<boolean>('screenOff', false),
      stayAwake: config.get<boolean>('stayAwake', true),
      maxSize: config.get<number>('maxSize', 1920),
      bitRate: config.get<number>('bitRate', 8),
      maxFps: config.get<number>('maxFps', 60),
      showTouches: config.get<boolean>('showTouches', false),
      audio: config.get<boolean>('audio', true),
      audioSource: config.get<'output' | 'mic' | 'playback-capture'>('audioSource', 'output'),
      clipboardSync: config.get<boolean>('clipboardSync', true),
      autoConnect: config.get<boolean>('autoConnect', true),
      autoReconnect: config.get<boolean>('autoReconnect', true),
      reconnectRetries: config.get<number>('reconnectRetries', 2),
      lockVideoOrientation: config.get<boolean>('lockVideoOrientation', false),
      scrollSensitivity: config.get<number>('scrollSensitivity', 1.0),
      videoSource: config.get<'display' | 'camera'>('videoSource', 'display'),
      cameraFacing: config.get<'front' | 'back' | 'external'>('cameraFacing', 'back'),
      cameraId: config.get<string>('cameraId', ''),
      cameraSize: config.get<string>('cameraSize', ''),
      cameraFps: config.get<number>('cameraFps', 0),
      crop: config.get<string>('crop', ''),
      displayId: config.get<number>('displayId', 0),
      keyboardMode: config.get<'inject' | 'uhid'>('keyboardMode', 'inject'),
    };
  }

  private _sendSettings(): void {
    if (!this._appState) {
      return;
    }
    const config = vscode.workspace.getConfiguration('scrcpy');
    this._appState.updateSettings({
      showStats: config.get<boolean>('showStats', false),
      showExtendedStats: config.get<boolean>('showExtendedStats', false),
      audioEnabled: config.get<boolean>('audio', true),
    });
  }

  private _initializeAndConnect() {
    if (!this._view || this._deviceService) {
      return;
    }

    const config = this._getConfig();

    // Create centralized state manager
    this._appState = new AppStateManager();

    // Initialize settings and tool status in state
    const vsConfig = vscode.workspace.getConfiguration('scrcpy');
    this._appState.updateSettings({
      showStats: vsConfig.get<boolean>('showStats', false),
      showExtendedStats: vsConfig.get<boolean>('showExtendedStats', false),
      audioEnabled: vsConfig.get<boolean>('audio', true),
    });

    if (this._toolStatus) {
      this._appState.updateToolStatus({
        adbAvailable: this._toolStatus.adb.isAvailable,
        scrcpyAvailable: this._toolStatus.scrcpy.isAvailable,
      });
    }

    // Subscribe to state changes - send snapshots to webview
    this._stateUnsubscribe = this._appState.subscribe((snapshot) => {
      if (this._isDisposed || !this._view) {
        return;
      }
      this._view.webview.postMessage({
        type: 'stateSnapshot',
        state: snapshot,
      });
    });

    // Create device service with callbacks for high-frequency data
    this._deviceService = new DeviceService(
      this._appState,
      // Video frame callback (high-frequency, bypasses state)
      (deviceId, frameData, isConfig, isKeyFrame, width, height, codec) => {
        if (this._isDisposed || !this._view) {
          return;
        }
        this._view.webview.postMessage({
          type: 'videoFrame',
          deviceId,
          data: frameData,
          isConfig,
          isKeyFrame,
          width,
          height,
          codec,
        });
      },
      // Audio frame callback (high-frequency, bypasses state)
      (deviceId, frameData, isConfig) => {
        if (this._isDisposed || !this._view) {
          return;
        }
        this._view.webview.postMessage({
          type: 'audioFrame',
          deviceId,
          data: frameData,
          isConfig,
        });
      },
      // Status callback
      (deviceId, status) => {
        if (this._isDisposed || !this._appState) {
          return;
        }
        this._appState.setStatusMessage({
          type: 'loading',
          text: status,
          deviceId: deviceId || undefined,
        });
      },
      // Error callback
      (deviceId, message, error) => {
        if (this._isDisposed || !this._appState) {
          return;
        }

        // Handle tool-not-found errors by updating tool status
        if (error instanceof ToolNotFoundError) {
          if (error.code === ToolErrorCode.SCRCPY_NOT_FOUND) {
            this._appState.updateToolStatus({
              adbAvailable: this._toolStatus?.adb.isAvailable ?? true,
              scrcpyAvailable: false,
            });
          } else if (error.code === ToolErrorCode.ADB_NOT_FOUND) {
            this._appState.updateToolStatus({
              adbAvailable: false,
              scrcpyAvailable: this._toolStatus?.scrcpy.isAvailable ?? true,
            });
          }
          // Don't show error message - the webview will show missing dependency warning
          return;
        }

        this._appState.setStatusMessage({
          type: 'error',
          text: message,
          deviceId: deviceId || undefined,
        });
      },
      config,
      // Pass VS Code clipboard API for clipboard sync
      vscode.env.clipboard
    );

    this._autoConnectAllDevices();

    // Start monitoring for new USB devices (auto-connect)
    this._deviceService.startDeviceMonitoring();
  }

  private async _autoConnectAllDevices() {
    const signal = this._abortController?.signal;
    if (!this._deviceService || !this._appState) {
      return;
    }

    // Show loading while checking for devices (will be replaced by connection status or empty state)
    this._appState.setStatusMessage({
      type: 'loading',
      text: vscode.l10n.t('Searching for devices...'),
    });

    try {
      const devices = await this._deviceService.getAvailableDevices();
      if (signal?.aborted || !this._deviceService) {
        return;
      }

      if (devices.length === 0) {
        this._appState.setStatusMessage({
          type: 'empty',
          text: vscode.l10n.t(
            'No Android devices found.\n\nPlease connect a device and enable USB debugging.'
          ),
        });
        return;
      }

      // Connect to all available devices (including WiFi devices already in ADB)
      // This ensures WiFi connections persist across window reloads
      for (const device of devices) {
        if (signal?.aborted || !this._deviceService) {
          return;
        }
        try {
          await this._deviceService.addDevice(device);
        } catch {
          // Continue connecting other devices even if one fails
        }
      }
    } catch (error) {
      if (signal?.aborted || !this._deviceService) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this._appState.setStatusMessage({
        type: 'error',
        text: vscode.l10n.t('Connection failed: {0}', message),
      });
    }
  }

  private async _onDidReceiveMessage(message: {
    type: string;
    deviceId?: string;
    serial?: string;
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    action?: 'down' | 'move' | 'up';
    screenWidth?: number;
    screenHeight?: number;
    width?: number;
    height?: number;
    keycode?: number;
    text?: string;
    metastate?: number;
    deltaX?: number;
    deltaY?: number;
    base64Data?: string;
    data?: number[];
    mimeType?: string;
    duration?: number;
    setting?: string;
    value?: unknown;
  }) {
    switch (message.type) {
      case 'touch':
        if (
          this._deviceService &&
          message.x !== undefined &&
          message.y !== undefined &&
          message.action
        ) {
          this._deviceService.sendTouch(
            message.x,
            message.y,
            message.action,
            message.screenWidth ?? 0,
            message.screenHeight ?? 0
          );
        }
        break;

      case 'scroll':
        if (
          this._deviceService &&
          message.x !== undefined &&
          message.y !== undefined &&
          message.deltaX !== undefined &&
          message.deltaY !== undefined
        ) {
          this._deviceService.sendScroll(message.x, message.y, message.deltaX, message.deltaY);
        }
        break;

      case 'multiTouch':
        if (
          this._deviceService &&
          message.x1 !== undefined &&
          message.y1 !== undefined &&
          message.x2 !== undefined &&
          message.y2 !== undefined &&
          message.action
        ) {
          this._deviceService.sendMultiTouch(
            message.x1,
            message.y1,
            message.x2,
            message.y2,
            message.action,
            message.screenWidth ?? 0,
            message.screenHeight ?? 0
          );
        }
        break;

      case 'keyDown':
        if (this._deviceService && message.keycode !== undefined) {
          this._deviceService.sendKeyDown(message.keycode);
        }
        break;

      case 'keyUp':
        if (this._deviceService && message.keycode !== undefined) {
          this._deviceService.sendKeyUp(message.keycode);
        }
        break;

      case 'injectText':
        if (this._deviceService && message.text !== undefined) {
          this._deviceService.sendText(message.text);
        }
        break;

      case 'injectKeycode':
        if (
          this._deviceService &&
          message.keycode !== undefined &&
          message.metastate !== undefined &&
          (message.action === 'down' || message.action === 'up')
        ) {
          this._deviceService.sendKeyWithMeta(message.keycode, message.action, message.metastate);
        }
        break;

      case 'pasteFromHost':
        if (this._deviceService) {
          await this._deviceService.pasteFromHost();
        }
        break;

      case 'copyToHost':
        if (this._deviceService) {
          await this._deviceService.copyToHost();
        }
        break;

      case 'rotateDevice':
        if (this._deviceService) {
          this._deviceService.rotateDevice();
        }
        break;

      case 'expandNotificationPanel':
        if (this._deviceService) {
          this._deviceService.expandNotificationPanel();
        }
        break;

      case 'expandSettingsPanel':
        if (this._deviceService) {
          this._deviceService.expandSettingsPanel();
        }
        break;

      case 'collapsePanels':
        if (this._deviceService) {
          this._deviceService.collapsePanels();
        }
        break;

      case 'screenshot':
        await this._takeAndSaveScreenshot();
        break;

      case 'saveScreenshot':
        if (message.base64Data) {
          await this._saveScreenshotFromBase64(message.base64Data);
        }
        break;

      case 'toggleAudio':
        {
          const config = vscode.workspace.getConfiguration('scrcpy');
          const currentAudio = config.get<boolean>('audio', true);
          config.update('audio', !currentAudio, vscode.ConfigurationTarget.Global);
        }
        break;

      case 'dimensionsChanged':
        if (this._deviceService && message.deviceId && message.width && message.height) {
          this._deviceService.updateDimensions(message.deviceId, message.width, message.height);
        }
        break;

      case 'switchTab':
        if (this._deviceService && message.deviceId) {
          this._deviceService.switchToDevice(message.deviceId);
        }
        break;

      case 'closeTab':
        if (this._deviceService && message.deviceId) {
          await this._deviceService.removeDevice(message.deviceId);
        }
        break;

      case 'showDevicePicker':
        await this._showDevicePicker();
        break;

      case 'connectDevice':
        if (this._deviceService && message.serial) {
          const devices = await this._deviceService.getAvailableDevices();
          const device = devices.find((d) => d.serial === message.serial);
          if (device) {
            try {
              await this._deviceService.addDevice(device);
            } catch {
              // Error already handled via callback
            }
          }
        }
        break;

      case 'getRecordingSettings':
        await this._sendRecordingSettings();
        break;

      case 'saveRecording':
        if (message.data && message.mimeType && message.duration !== undefined) {
          await this._saveRecording({
            data: message.data,
            mimeType: message.mimeType,
            duration: message.duration,
          });
        }
        break;

      case 'ready':
        console.log('Webview ready');
        this._sendSettings();
        // Send cached device settings to webview
        this._view?.webview.postMessage({
          type: 'deviceSettingsCacheLoaded',
          cache: this.getDeviceSettingsCache(),
        });
        break;

      case 'reconnect':
        await this._disconnect();
        this._initializeAndConnect();
        break;

      case 'openSettings':
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:izantech.scrcpy-vscode'
        );
        break;

      case 'openInstallDocs':
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/Genymobile/scrcpy'));
        break;

      case 'browseScrcpyPath': {
        const result = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: vscode.l10n.t('Select scrcpy installation folder'),
        });
        if (result && result[0]) {
          await vscode.workspace.getConfiguration('scrcpy').update('path', result[0].fsPath, true);
        }
        break;
      }

      case 'resetScrcpyPath':
        await vscode.workspace.getConfiguration('scrcpy').update('path', undefined, true);
        break;

      case 'getDeviceInfo':
        if (this._deviceService && message.serial) {
          try {
            const deviceInfo = await this._deviceService.getCachedDeviceInfo(message.serial);
            // Device info is now stored in AppState and sent via snapshot
            // But we still need to send it for backward compatibility
            this._view?.webview.postMessage({
              type: 'deviceInfo',
              serial: message.serial,
              info: deviceInfo,
            });
          } catch (error) {
            console.error('Failed to get device info:', error);
            // Send empty response on error
            this._view?.webview.postMessage({
              type: 'deviceInfo',
              serial: message.serial,
              info: null,
            });
          }
        }
        break;

      case 'openDeviceSettings':
        if (this._deviceService) {
          const deviceId = this._appState?.getActiveDeviceId();
          try {
            const settings = await this._deviceService.getDeviceUISettings();
            // Save to persistent cache
            if (deviceId) {
              this.saveDeviceSettingsToCache(deviceId, settings);
            }
            this._view?.webview.postMessage({
              type: 'deviceSettingsLoaded',
              settings,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
              vscode.l10n.t('Failed to load device settings: {0}', errorMessage)
            );
          }
        }
        break;

      case 'applyDeviceSetting':
        if (this._deviceService && message.setting && message.value !== undefined) {
          const deviceId = this._appState?.getActiveDeviceId();
          try {
            await this._deviceService.applyDeviceUISetting(
              message.setting as keyof DeviceUISettings,
              message.value as DeviceUISettings[keyof DeviceUISettings]
            );
            // Update persistent cache
            if (deviceId) {
              this.updateDeviceSettingInCache(
                deviceId,
                message.setting as keyof DeviceUISettings,
                message.value as DeviceUISettings[keyof DeviceUISettings]
              );
            }
            // Notify webview of success
            this._view?.webview.postMessage({
              type: 'deviceSettingApplied',
              setting: message.setting,
              success: true,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            // Notify webview of failure
            this._view?.webview.postMessage({
              type: 'deviceSettingApplied',
              setting: message.setting,
              success: false,
              error: errorMessage,
            });
          }
        }
        break;
    }
  }

  /**
   * Show WiFi connection dialog and connect to device
   */
  public async connectWifi(): Promise<void> {
    // Ask user which connection method to use
    const method = await vscode.window.showQuickPick(
      [
        {
          label: vscode.l10n.t('$(key) Pair new device (Android 11+)'),
          description: vscode.l10n.t('Use pairing code from Wireless debugging'),
          value: 'pair',
        },
        {
          label: vscode.l10n.t('$(plug) Connect to paired device'),
          description: vscode.l10n.t('Device was previously paired or uses legacy ADB WiFi'),
          value: 'connect',
        },
      ],
      {
        placeHolder: vscode.l10n.t('How do you want to connect?'),
        title: vscode.l10n.t('Connect to Device over WiFi'),
      }
    );

    if (!method) {
      return; // User cancelled
    }

    if (method.value === 'pair') {
      await this._pairWifiDevice();
    } else {
      await this._connectWifiDevice();
    }
  }

  /**
   * Pair with a new device using Android 11+ Wireless Debugging
   */
  private async _pairWifiDevice(): Promise<void> {
    // Step 1: Get pairing address (IP:port from Wireless debugging > Pair device)
    const pairingAddress = await vscode.window.showInputBox({
      title: vscode.l10n.t('Pair Device (Step 1/2)'),
      prompt: vscode.l10n.t('Enter the pairing address from "Pair device with pairing code"'),
      placeHolder: '192.168.1.100:37000',
      validateInput: (value) => {
        if (!value) {
          return vscode.l10n.t('Pairing address is required');
        }
        const ipPortRegex = /^(\d{1,3}\.){3}\d{1,3}:\d+$/;
        if (!ipPortRegex.test(value)) {
          return vscode.l10n.t('Enter address as IP:port (e.g., 192.168.1.100:37000)');
        }
        return undefined;
      },
    });

    if (!pairingAddress) {
      return;
    }

    // Step 2: Get pairing code
    const pairingCode = await vscode.window.showInputBox({
      title: vscode.l10n.t('Pair Device (Step 2/2)'),
      prompt: vscode.l10n.t('Enter the 6-digit pairing code'),
      placeHolder: '123456',
      validateInput: (value) => {
        if (!value) {
          return vscode.l10n.t('Pairing code is required');
        }
        if (!/^\d{6}$/.test(value)) {
          return vscode.l10n.t('Pairing code must be 6 digits');
        }
        return undefined;
      },
    });

    if (!pairingCode) {
      return;
    }

    // Initialize device service if not already
    if (!this._deviceService) {
      this._initializeAndConnect();
    }

    if (!this._deviceService) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to initialize device service'));
      return;
    }

    // Pair the device
    const pairResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Pairing with {0}...', pairingAddress),
        cancellable: false,
      },
      async () => {
        try {
          await this._deviceService!.pairWifi(pairingAddress, pairingCode);
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(vscode.l10n.t('Pairing failed: {0}', message));
          return false;
        }
      }
    );

    if (!pairResult) {
      return;
    }

    vscode.window.showInformationMessage(
      vscode.l10n.t('Device paired successfully! Now connecting...')
    );

    // After pairing, prompt for the connection address
    // The connection port is different from the pairing port
    const ip = pairingAddress.split(':')[0];
    const connectAddress = await vscode.window.showInputBox({
      title: vscode.l10n.t('Connect to Paired Device'),
      prompt: vscode.l10n.t(
        'Enter the connection address shown in Wireless debugging (not the pairing address)'
      ),
      placeHolder: `${ip}:5555`,
      value: ip,
      validateInput: (value) => {
        if (!value) {
          return vscode.l10n.t('Connection address is required');
        }
        const ipPortRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
        if (!ipPortRegex.test(value)) {
          return vscode.l10n.t('Enter address as IP or IP:port');
        }
        return undefined;
      },
    });

    if (!connectAddress) {
      return;
    }

    await this._connectWifiDeviceWithAddress(connectAddress);
  }

  /**
   * Connect to an already paired or legacy WiFi device
   */
  private async _connectWifiDevice(): Promise<void> {
    const ipAddress = await vscode.window.showInputBox({
      title: vscode.l10n.t('Connect to Device over WiFi'),
      prompt: vscode.l10n.t('Enter the IP address (and port) of your Android device'),
      placeHolder: '192.168.1.100:5555',
      validateInput: (value) => {
        if (!value) {
          return vscode.l10n.t('IP address is required');
        }
        const ipPortRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
        if (!ipPortRegex.test(value)) {
          return vscode.l10n.t(
            'Enter a valid IP address (e.g., 192.168.1.100 or 192.168.1.100:5555)'
          );
        }
        const ipPart = value.split(':')[0];
        const octets = ipPart.split('.').map(Number);
        if (octets.some((o) => o < 0 || o > 255)) {
          return vscode.l10n.t('Invalid IP address: each octet must be between 0 and 255');
        }
        return undefined;
      },
    });

    if (!ipAddress) {
      return;
    }

    await this._connectWifiDeviceWithAddress(ipAddress);
  }

  /**
   * Show file picker and install APK on device
   */
  public async installApk(): Promise<void> {
    // Get default path from settings (fallback to Downloads folder)
    const config = vscode.workspace.getConfiguration('scrcpy');
    const customPath = config.get<string>('apkInstallDefaultPath', '');
    const defaultPath = customPath || path.join(os.homedir(), 'Downloads');

    // Show file picker for APK files
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(defaultPath),
      filters: {
        'APK Files': ['apk'],
      },
      title: vscode.l10n.t('Select APK to Install'),
    });

    if (!result || result.length === 0) {
      return; // User cancelled
    }

    const apkPath = result[0].fsPath;
    const apkName = path.basename(apkPath);

    // Initialize device service if not already
    if (!this._deviceService) {
      vscode.window.showErrorMessage(vscode.l10n.t('No device connected'));
      return;
    }

    // Install with progress notification
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Installing {0}...', apkName),
        cancellable: false,
      },
      async () => {
        try {
          await this._deviceService!.installApk(apkPath);
          vscode.window.showInformationMessage(
            vscode.l10n.t('APK installed successfully: {0}', apkName)
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(vscode.l10n.t('Failed to install APK: {0}', message));
        }
      }
    );
  }

  /**
   * List available cameras on the active device
   */
  public async listCameras(): Promise<void> {
    if (!this._deviceService) {
      vscode.window.showErrorMessage(vscode.l10n.t('No device connected'));
      return;
    }

    try {
      const cameraList = await this._deviceService.listCameras();

      // Parse camera list to show in quick pick
      const lines = cameraList.split('\n');
      const cameraItems: Array<{ label: string; description: string; id?: string }> = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('--camera-id=')) {
          // Extract camera ID and details
          // Format: --camera-id=0    (back, 4032x3024, fps=[15, 24, 30])
          const match = trimmed.match(/--camera-id=(\S+)\s+\(([^)]+)\)/);
          if (match) {
            const cameraId = match[1];
            const details = match[2];
            cameraItems.push({
              label: `Camera ${cameraId}`,
              description: details,
              id: cameraId,
            });
          }
        }
      }

      if (cameraItems.length === 0) {
        vscode.window.showInformationMessage('No cameras found on the device');
        return;
      }

      // Show quick pick
      const selected = await vscode.window.showQuickPick(cameraItems, {
        title: 'Available Cameras',
        placeHolder: 'Select a camera to copy its ID to settings',
      });

      if (selected && selected.id) {
        // Ask if user wants to set this camera ID in settings
        const setCameraId = await vscode.window.showInformationMessage(
          `Set camera ID to "${selected.id}" in settings?`,
          'Yes',
          'No'
        );

        if (setCameraId === 'Yes') {
          const config = vscode.workspace.getConfiguration('scrcpy');
          await config.update('cameraId', selected.id, vscode.ConfigurationTarget.Workspace);
          vscode.window.showInformationMessage(
            `Camera ID set to "${selected.id}". Change video source to "camera" to use it.`
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to list cameras: ${message}`);
    }
  }

  /**
   * Show display picker and select which display to mirror
   */
  public async selectDisplay(): Promise<void> {
    if (!this._deviceService) {
      vscode.window.showErrorMessage(vscode.l10n.t('No device connected'));
      return;
    }

    try {
      // Get available displays from the active device
      const displays = await this._deviceService.getDisplays();

      if (displays.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('No displays found on the device'));
        return;
      }

      // Show quick pick with display options
      const items = displays.map((d) => ({
        label: d.info,
        description: d.id === 0 ? vscode.l10n.t('Main display') : '',
        displayId: d.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('Select a display to mirror'),
        title: vscode.l10n.t('Select Display'),
      });

      if (selected) {
        // Update the displayId setting
        const config = vscode.workspace.getConfiguration('scrcpy');
        await config.update('displayId', selected.displayId, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage(
          vscode.l10n.t('Display set to {0}. Reconnecting...', selected.label)
        );

        // Reconnect to apply the change
        await this._disconnect();
        this._initializeAndConnect();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to list displays: {0}', message));
    }
  }

  /**
   * Show file/folder picker and upload to device
   */
  public async uploadFiles(): Promise<void> {
    // Get default path from settings (reuse APK default path setting)
    const config = vscode.workspace.getConfiguration('scrcpy');
    const customPath = config.get<string>('apkInstallDefaultPath', '');
    const defaultPath = customPath || path.join(os.homedir(), 'Downloads');

    // Show file/folder picker - allow multiple selections
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: true,
      defaultUri: vscode.Uri.file(defaultPath),
      title: vscode.l10n.t('Select Files or Folders to Upload'),
    });

    if (!result || result.length === 0) {
      return; // User cancelled
    }

    // Check device connection
    if (!this._deviceService) {
      vscode.window.showErrorMessage(vscode.l10n.t('No device connected'));
      return;
    }

    // Upload with progress notification
    // adb push handles directories recursively and supports multiple paths in one command
    const filePaths = result.map((uri) => uri.fsPath);
    const itemNames = filePaths.map((p) => path.basename(p)).join(', ');

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Uploading to device...'),
        cancellable: false,
      },
      async () => {
        try {
          await this._deviceService!.pushFiles(filePaths);
          vscode.window.showInformationMessage(
            vscode.l10n.t('Successfully uploaded to /sdcard/Download/: {0}', itemNames)
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(vscode.l10n.t('Failed to upload: {0}', message));
        }
      }
    );
  }

  /**
   * Show app picker and launch app on device
   */
  public async launchApp(): Promise<void> {
    // Check device connection
    if (!this._deviceService) {
      vscode.window.showErrorMessage(vscode.l10n.t('No device connected'));
      return;
    }

    // Get list of installed apps with progress notification
    const apps = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Loading installed apps...'),
        cancellable: false,
      },
      async () => {
        try {
          // Get all apps (not just third-party) for better UX
          return await this._deviceService!.getInstalledApps(false);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            vscode.l10n.t('Failed to get installed apps: {0}', message)
          );
          return null;
        }
      }
    );

    if (!apps || apps.length === 0) {
      return;
    }

    // Create quick pick items with package names
    const items = apps.map((app) => ({
      label: app.packageName,
      packageName: app.packageName,
    }));

    // Show quick pick with search
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('Select an app to launch'),
    });

    if (!selected) {
      return; // User cancelled
    }

    // Launch the selected app
    try {
      this._deviceService.launchApp(selected.packageName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to launch app: {0}', message));
    }
  }

  /**
   * Toggle screen recording
   */
  public async toggleRecording(): Promise<void> {
    // Send message to webview to toggle recording
    // The webview will request settings and handle the actual recording
    this._view?.webview.postMessage({ type: 'toggleRecording' });
  }

  /**
   * Connect to a WiFi device with the given address
   */
  private async _connectWifiDeviceWithAddress(address: string): Promise<void> {
    // Parse IP and port
    let ip: string;
    let port: number;

    if (address.includes(':')) {
      const parts = address.split(':');
      ip = parts[0];
      port = parseInt(parts[1], 10);
    } else {
      ip = address;
      port = 5555;
    }

    // Initialize device service if not already
    if (!this._deviceService) {
      this._initializeAndConnect();
    }

    if (!this._deviceService) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to initialize device service'));
      return;
    }

    // Show progress notification
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Connecting to {0}...', `${ip}:${port}`),
        cancellable: false,
      },
      async () => {
        try {
          // Connect via ADB
          const deviceInfo = await this._deviceService!.connectWifi(ip, port);

          // Now add the device to the session
          await this._deviceService!.addDevice(deviceInfo);

          vscode.window.showInformationMessage(
            vscode.l10n.t('Connected to {0} over WiFi', deviceInfo.name)
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(vscode.l10n.t('WiFi connection failed: {0}', message));
        }
      }
    );
  }

  private async _showDevicePicker(): Promise<void> {
    const signal = this._abortController?.signal;
    if (!this._deviceService) {
      return;
    }

    const devices = await this._deviceService.getAvailableDevices();
    if (signal?.aborted) {
      return;
    }

    if (devices.length === 0) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('No Android devices found. Please connect a device and enable USB debugging.')
      );
      return;
    }

    // Filter out already connected devices
    const availableDevices = devices.filter(
      (d) => !this._deviceService!.isDeviceConnected(d.serial)
    );

    if (availableDevices.length === 0) {
      vscode.window.showInformationMessage(
        vscode.l10n.t('All available devices are already connected.')
      );
      return;
    }

    // Show quick pick
    const items = availableDevices.map((d) => ({
      label: d.name,
      description: d.serial,
      device: d,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('Select a device to connect'),
    });

    if (selected && !signal?.aborted) {
      if (!this._deviceService) {
        return;
      }
      try {
        await this._deviceService.addDevice(selected.device);
      } catch {
        // Error already handled via callback
      }
    }
  }

  private async _disconnect() {
    this._stateUnsubscribe?.();
    this._stateUnsubscribe = undefined;
    if (this._deviceService) {
      this._deviceService.stopDeviceMonitoring();
      await this._deviceService.disconnectAll();
      this._deviceService = undefined;
      this._appState = undefined;
    }
  }

  private async _onViewDisposed() {
    this._isDisposed = true;
    this._abortController?.abort();
    await this._disconnect();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      disposable?.dispose();
    }
  }

  public async start() {
    if (this._view) {
      this._view.show?.(true);
      if (!this._deviceService) {
        this._initializeAndConnect();
      }
    }
  }

  public async stop() {
    await this._disconnect();
    this._view?.webview.postMessage({
      type: 'status',
      message: vscode.l10n.t('Disconnected'),
    });
  }

  /**
   * Send recording settings to webview
   */
  private async _sendRecordingSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration('scrcpy');
    const format = config.get<'webm' | 'mp4'>('recordingFormat', 'webm');

    this._view?.webview.postMessage({
      type: 'recordingSettings',
      format,
    });
  }

  /**
   * Save recording to file
   */
  private async _saveRecording(message: {
    data: number[];
    mimeType: string;
    duration: number;
  }): Promise<void> {
    if (!message.data || message.data.length === 0) {
      vscode.window.showErrorMessage('Recording is empty');
      return;
    }

    try {
      // Convert array to Uint8Array
      const videoBuffer = new Uint8Array(message.data);

      // Determine file extension from MIME type
      const extension = message.mimeType.includes('mp4') ? 'mp4' : 'webm';

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `recording-${timestamp}.${extension}`;

      // Get settings
      const config = vscode.workspace.getConfiguration('scrcpy');
      const showSaveDialog = config.get<boolean>('recordingShowSaveDialog', true);
      const customPath = config.get<string>('recordingSavePath', '');

      let uri: vscode.Uri | undefined;

      if (showSaveDialog) {
        // Show save dialog
        const filters: { [name: string]: string[] } = {};
        if (extension === 'webm') {
          filters['WebM Video'] = ['webm'];
        } else {
          filters['MP4 Video'] = ['mp4'];
        }

        uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(filename),
          filters,
          title: 'Save Recording',
        });

        if (!uri) {
          return; // User cancelled
        }
      } else {
        // Save directly to configured path or Downloads folder
        const saveDir = customPath || path.join(os.homedir(), 'Downloads');
        uri = vscode.Uri.file(path.join(saveDir, filename));
      }

      // Write to file
      await vscode.workspace.fs.writeFile(uri, videoBuffer);

      // Show success notification with file path
      const durationStr = `${Math.floor(message.duration / 60)}:${String(Math.floor(message.duration % 60)).padStart(2, '0')}`;
      vscode.window.showInformationMessage(
        `Recording saved: ${path.basename(uri.fsPath)} (${durationStr})`
      );

      // Optionally open the video
      // await vscode.commands.executeCommand('vscode.open', uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to save recording: ${message}`);
    }
  }

  /**
   * Switch to a tab by index (0-based)
   */
  public switchToTab(index: number): void {
    if (!this._view) {
      return;
    }
    this._view.webview.postMessage({
      type: 'switchToTabByIndex',
      index,
    });
  }

  private async _takeAndSaveScreenshot(): Promise<void> {
    const notifyComplete = () => {
      this._view?.webview.postMessage({ type: 'screenshotComplete' });
    };

    if (!this._deviceService) {
      vscode.window.showErrorMessage(vscode.l10n.t('No device connected'));
      notifyComplete();
      return;
    }

    try {
      // Take screenshot from device (original resolution, lossless PNG)
      const pngBuffer = await this._deviceService.takeScreenshot();

      // Get settings
      const config = vscode.workspace.getConfiguration('scrcpy');
      const showPreview = config.get<boolean>('screenshotPreview', true);

      if (showPreview) {
        // Send preview to webview
        const base64Data = pngBuffer.toString('base64');
        this._view?.webview.postMessage({
          type: 'screenshotPreview',
          base64Data,
        });
      } else {
        // Save immediately (legacy behavior)
        await this._saveScreenshotDirect(pngBuffer);
        notifyComplete();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to take screenshot: {0}', message));
      notifyComplete();
    }
  }

  private async _saveScreenshotDirect(pngBuffer: Uint8Array): Promise<void> {
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `screenshot-${timestamp}.png`;

    // Get settings
    const config = vscode.workspace.getConfiguration('scrcpy');
    const showSaveDialog = config.get<boolean>('screenshotShowSaveDialog', false);
    const customPath = config.get<string>('screenshotSavePath', '');

    let uri: vscode.Uri | undefined;

    if (showSaveDialog) {
      // Show save dialog
      uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(filename),
        filters: {
          'PNG Image': ['png'],
        },
        title: vscode.l10n.t('Save Screenshot'),
      });

      if (!uri) {
        return; // User cancelled
      }
    } else {
      // Save directly to configured path or Downloads folder
      const saveDir = customPath || path.join(os.homedir(), 'Downloads');
      uri = vscode.Uri.file(path.join(saveDir, filename));
    }

    // Write to file
    await vscode.workspace.fs.writeFile(uri, pngBuffer);

    // Open the screenshot in the main editor panel
    await vscode.commands.executeCommand('vscode.open', uri);
  }

  private async _saveScreenshotFromBase64(base64Data: string): Promise<void> {
    try {
      // Convert base64 to buffer
      const pngBuffer = Buffer.from(base64Data, 'base64');
      await this._saveScreenshotDirect(pngBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to save screenshot: {0}', message));
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return getHtmlForWebview(webview, this._extensionUri);
  }

  /**
   * Get device settings cache from globalState
   */
  private getDeviceSettingsCache(): Record<string, DeviceUISettings> {
    if (!this._globalState) {
      return {};
    }
    return this._globalState.get<Record<string, DeviceUISettings>>(
      ScrcpyViewProvider.DEVICE_SETTINGS_CACHE_KEY,
      {}
    );
  }

  /**
   * Save device settings to persistent cache
   */
  private saveDeviceSettingsToCache(deviceId: string, settings: DeviceUISettings): void {
    if (!this._globalState) {
      return;
    }
    const cache = this.getDeviceSettingsCache();
    cache[deviceId] = settings;
    this._globalState.update(ScrcpyViewProvider.DEVICE_SETTINGS_CACHE_KEY, cache);
  }

  /**
   * Update a single setting in the persistent cache
   */
  private updateDeviceSettingInCache(
    deviceId: string,
    setting: keyof DeviceUISettings,
    value: DeviceUISettings[keyof DeviceUISettings]
  ): void {
    if (!this._globalState) {
      return;
    }
    const cache = this.getDeviceSettingsCache();
    if (cache[deviceId]) {
      (cache[deviceId] as unknown as Record<string, unknown>)[setting] = value;
      this._globalState.update(ScrcpyViewProvider.DEVICE_SETTINGS_CACHE_KEY, cache);
    }
  }

  /**
   * Get cached settings for a device
   */
  public getDeviceSettingsFromCache(deviceId: string): DeviceUISettings | undefined {
    return this.getDeviceSettingsCache()[deviceId];
  }
}
