import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn, ChildProcess } from 'child_process';

// Type for video frame callback
type VideoFrameCallback = (
  data: Uint8Array,
  isConfig: boolean,
  width?: number,
  height?: number
) => void;

// Type for audio frame callback
type AudioFrameCallback = (
  data: Uint8Array,
  isConfig: boolean
) => void;

// Type for status callback
type StatusCallback = (status: string) => void;

// Type for error callback (used for unexpected disconnects)
type ErrorCallback = (message: string) => void;

// Scrcpy configuration options
export interface ScrcpyConfig {
  scrcpyPath: string;
  screenOff: boolean;
  stayAwake: boolean;
  maxSize: number;
  bitRate: number;
  maxFps: number;
  showTouches: boolean;
  audio: boolean;
  clipboardSync: boolean;
  clipboardPollInterval: number;
  autoConnect: boolean;
  autoReconnect: boolean;
  reconnectRetries: number;
}

// Type for clipboard callback
type ClipboardCallback = (text: string) => void;

// VS Code clipboard interface (subset of vscode.env.clipboard)
export interface ClipboardAPI {
  readText(): Thenable<string>;
  writeText(text: string): Thenable<void>;
}

/**
 * Manages scrcpy connection to Android device via ADB
 *
 * Uses ADB shell commands and direct socket communication
 * to mirror Android device screen.
 */
export class ScrcpyConnection {
  private deviceSerial: string | null = null;
  private targetSerial: string | null = null;
  private videoSocket: net.Socket | null = null;
  private controlSocket: net.Socket | null = null;
  private audioSocket: net.Socket | null = null;
  private adbProcess: ChildProcess | null = null;
  private deviceWidth = 0;
  private deviceHeight = 0;
  private isConnected = false;
  private scid: string | null = null;
  private _audioPacketCount = 0;

  // Clipboard sync state
  private clipboardPollInterval: NodeJS.Timeout | null = null;
  private lastHostClipboard = '';
  private lastDeviceClipboard = '';
  private clipboardSequence = 0n;
  private deviceMsgBuffer = Buffer.alloc(0);

  constructor(
    private onVideoFrame: VideoFrameCallback,
    private onStatus: StatusCallback,
    private config: ScrcpyConfig,
    targetDeviceSerial?: string,
    private onClipboard?: ClipboardCallback,
    private clipboardAPI?: ClipboardAPI,
    private onError?: ErrorCallback,
    private onAudioFrame?: AudioFrameCallback
  ) {
    this.targetSerial = targetDeviceSerial ?? null;
  }

  /**
   * Connect to ADB daemon and select a device
   */
  async connect(): Promise<void> {
    this.onStatus('Connecting to ADB daemon...');

    const devices = await this.getDeviceList();

    if (devices.length === 0) {
      throw new Error(
        'No Android devices found.\n\n' +
        'Please ensure:\n' +
        '1. Device is connected via USB\n' +
        '2. USB debugging is enabled\n' +
        '3. ADB is authorized on the device'
      );
    }

    // Use target serial if specified, otherwise first device
    if (this.targetSerial) {
      if (!devices.includes(this.targetSerial)) {
        throw new Error(`Device ${this.targetSerial} not found or not authorized`);
      }
      this.deviceSerial = this.targetSerial;
    } else {
      this.deviceSerial = devices[0];
    }
    this.onStatus(`Found device: ${this.deviceSerial}`);
  }

  /**
   * Get list of connected devices from ADB
   */
  private getDeviceList(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      exec('adb devices', (error, stdout, stderr) => {
        if (error) {
          reject(new Error(
            'Failed to run "adb devices".\n\n' +
            'Please ensure ADB is installed and in your PATH.\n' +
            'Install via: brew install android-platform-tools (macOS)\n' +
            'Or download from: https://developer.android.com/studio/releases/platform-tools'
          ));
          return;
        }

        const lines = stdout.trim().split('\n');
        const devices: string[] = [];

        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].trim().split(/\s+/);
          if (parts.length >= 2 && parts[1] === 'device') {
            devices.push(parts[0]);
          }
        }

        resolve(devices);
      });
    });
  }

  /**
   * Start scrcpy screen mirroring
   */
  async startScrcpy(): Promise<void> {
    if (!this.deviceSerial) {
      throw new Error('No device connected');
    }

    this.onStatus('Starting scrcpy server...');

    // Get installed scrcpy version
    const scrcpyVersion = await this.getScrcpyVersion();
    this.onStatus(`Using scrcpy ${scrcpyVersion}`);

    // Ensure scrcpy server exists on device
    await this.ensureServerOnDevice();

    // Generate unique session ID
    this.scid = Math.floor(Math.random() * 0x7FFFFFFF).toString(16).padStart(8, '0');
    const localPort = 27183 + Math.floor(Math.random() * 16);

    // Setup reverse port forwarding
    await this.execAdb(`reverse localabstract:scrcpy_${this.scid} tcp:${localPort}`);

    // Create local server to receive connections
    // The server connects separately for video and control sockets
    const server = net.createServer();

    // Number of sockets: video + control (+ audio if enabled)
    const expectedSockets = this.config.audio ? 3 : 2;

    const connectionPromise = new Promise<{ videoSocket: net.Socket; controlSocket: net.Socket; audioSocket: net.Socket | null }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('Timeout waiting for device connection. The server may have failed to start.'));
      }, 15000);

      const sockets: net.Socket[] = [];

      server.on('connection', (socket: net.Socket) => {
        sockets.push(socket);
        // We need 2 or 3 connections depending on audio
        if (sockets.length === expectedSockets) {
          clearTimeout(timeout);
          // Order: video, audio (if enabled), control (control is always last)
          if (this.config.audio) {
            resolve({ videoSocket: sockets[0], audioSocket: sockets[1], controlSocket: sockets[2] });
          } else {
            resolve({ videoSocket: sockets[0], audioSocket: null, controlSocket: sockets[1] });
          }
        }
      });

      server.once('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    server.listen(localPort, '127.0.0.1');

    // Start scrcpy server on device
    const serverArgs = [
      '-s', this.deviceSerial,
      'shell',
      `CLASSPATH=/data/local/tmp/scrcpy-server.jar`,
      'app_process',
      '/',
      'com.genymobile.scrcpy.Server',
      scrcpyVersion,
      `scid=${this.scid}`,
      'log_level=info',
      'video=true',
      `audio=${this.config.audio}`,
      ...(this.config.audio ? ['audio_codec=opus'] : []),
      'control=true',
      'video_codec=h264',
      `max_size=${this.config.maxSize}`,
      `video_bit_rate=${this.config.bitRate * 1000000}`,
      `max_fps=${this.config.maxFps}`,
      `stay_awake=${this.config.stayAwake}`,
      `show_touches=${this.config.showTouches}`,
      'send_device_meta=true',
      'send_frame_meta=true',
      'send_codec_meta=true'
    ];

    this.adbProcess = spawn('adb', serverArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.adbProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log('[scrcpy-server]', msg);
      }
    });

    this.adbProcess.on('error', (err: Error) => {
      console.error('Failed to start scrcpy server:', err);
    });

    this.adbProcess.on('exit', (code) => {
      console.log('scrcpy server exited with code:', code);
      if (this.isConnected) {
        this.isConnected = false;
        // Report as error so reconnect button appears
        if (this.onError) {
          this.onError('Server disconnected');
        } else {
          this.onStatus('Server disconnected');
        }
      }
    });

    // Wait for device to connect
    this.onStatus('Waiting for device to connect...');

    try {
      const { videoSocket, controlSocket, audioSocket } = await connectionPromise;
      server.close();

      this.isConnected = true;
      this.controlSocket = controlSocket;
      this.onStatus('Connected! Receiving video stream...');

      // Turn screen off if configured
      if (this.config.screenOff) {
        setTimeout(() => this.setDisplayPower(false), 100);
      }

      // Handle the scrcpy protocol on video socket
      this.handleScrcpyStream(videoSocket);

      // Handle audio stream if enabled
      if (audioSocket) {
        console.log('Audio socket connected, handling audio stream');
        this.handleAudioStream(audioSocket);
      } else if (this.config.audio) {
        console.warn('Audio enabled but no audio socket received');
      }

      // Handle device messages on control socket (clipboard, etc.)
      this.handleControlSocketData(controlSocket);

      // Clipboard sync is now on-demand (paste/copy), no polling needed

    } catch (error) {
      server.close();
      this.adbProcess?.kill();
      throw error;
    }
  }

  /**
   * Get the scrcpy command path
   */
  private getScrcpyCommand(): string {
    if (this.config.scrcpyPath) {
      return path.join(this.config.scrcpyPath, 'scrcpy');
    }
    return 'scrcpy';
  }

  /**
   * Get installed scrcpy version
   */
  private async getScrcpyVersion(): Promise<string> {
    const scrcpyCmd = this.getScrcpyCommand();
    return new Promise((resolve, reject) => {
      exec(`"${scrcpyCmd}" --version`, (error, stdout) => {
        if (error) {
          reject(new Error(
            'Failed to get scrcpy version.\n\n' +
            'Please ensure scrcpy is installed:\n' +
            '- macOS: brew install scrcpy\n' +
            '- Linux: sudo apt install scrcpy\n' +
            '- Windows: scoop install scrcpy\n\n' +
            'Or set the scrcpy path in settings.'
          ));
          return;
        }

        // Parse version from output like "scrcpy 3.3.3 <https://...>"
        const match = stdout.match(/scrcpy\s+(\d+\.\d+(?:\.\d+)?)/);
        if (match) {
          resolve(match[1]);
        } else {
          reject(new Error('Could not parse scrcpy version'));
        }
      });
    });
  }

  /**
   * Ensure scrcpy server JAR exists on device
   */
  private async ensureServerOnDevice(): Promise<void> {
    // Check if server exists
    try {
      await this.execAdb('shell ls /data/local/tmp/scrcpy-server.jar');
      return; // Server exists
    } catch {
      // Server doesn't exist, need to push it
    }

    // Common locations for scrcpy-server on different platforms
    const possiblePaths = [
      // User-configured path (highest priority)
      ...(this.config.scrcpyPath ? [path.join(this.config.scrcpyPath, 'scrcpy-server')] : []),
      // macOS Homebrew
      '/opt/homebrew/share/scrcpy/scrcpy-server',
      '/usr/local/share/scrcpy/scrcpy-server',
      // Linux
      '/usr/share/scrcpy/scrcpy-server',
      '/usr/local/share/scrcpy/scrcpy-server',
      // User-local installation
      path.join(process.env.HOME || '', '.local/share/scrcpy/scrcpy-server'),
      // Windows Scoop
      path.join(process.env.USERPROFILE || '', 'scoop/apps/scrcpy/current/scrcpy-server'),
      // Windows Chocolatey
      path.join(process.env.PROGRAMDATA || '', 'chocolatey/lib/scrcpy/tools/scrcpy-server')
    ];

    let serverPath: string | null = null;

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        serverPath = p;
        break;
      }
    }

    if (!serverPath) {
      throw new Error(
        'scrcpy-server not found.\n\n' +
        'Please install scrcpy first:\n' +
        '- macOS: brew install scrcpy\n' +
        '- Linux: sudo apt install scrcpy\n' +
        '- Windows: scoop install scrcpy\n\n' +
        'Or download from: https://github.com/Genymobile/scrcpy/releases'
      );
    }

    this.onStatus('Pushing scrcpy server to device...');
    await this.execAdb(`push "${serverPath}" /data/local/tmp/scrcpy-server.jar`);
  }

  /**
   * Execute ADB command
   */
  private execAdb(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const fullCommand = this.deviceSerial
        ? `adb -s ${this.deviceSerial} ${command}`
        : `adb ${command}`;

      exec(fullCommand, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Handle scrcpy video stream
   */
  private handleScrcpyStream(socket: net.Socket): void {
    this.videoSocket = socket;

    let buffer = Buffer.alloc(0);
    let headerReceived = false;
    let codecReceived = false;

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Parse scrcpy protocol
      while (buffer.length > 0) {
        if (!headerReceived) {
          // First, receive device name (64 bytes)
          if (buffer.length < 64) break;

          const deviceName = buffer.subarray(0, 64).toString('utf8').replace(/\0+$/, '');
          console.log('Device name:', deviceName);
          buffer = buffer.subarray(64);
          headerReceived = true;
          continue;
        }

        if (!codecReceived) {
          // Video codec metadata: codec_id (4) + width (4) + height (4) = 12 bytes
          if (buffer.length < 12) break;

          const codecId = buffer.readUInt32BE(0);
          this.deviceWidth = buffer.readUInt32BE(4);
          this.deviceHeight = buffer.readUInt32BE(8);

          console.log(`Video: codec=0x${codecId.toString(16)}, ${this.deviceWidth}x${this.deviceHeight}`);
          buffer = buffer.subarray(12);
          codecReceived = true;

          // Notify webview of video dimensions
          this.onVideoFrame(new Uint8Array(0), true, this.deviceWidth, this.deviceHeight);
          continue;
        }

        // Video packets: pts_flags (8) + packet_size (4) + data
        if (buffer.length < 12) break;

        const ptsFlags = buffer.readBigUInt64BE(0);
        const packetSize = buffer.readUInt32BE(8);

        if (buffer.length < 12 + packetSize) break;

        const isConfig = (ptsFlags & (1n << 63n)) !== 0n;
        // const isKeyFrame = (ptsFlags & (1n << 62n)) !== 0n;
        // const pts = ptsFlags & ((1n << 62n) - 1n);

        const packetData = buffer.subarray(12, 12 + packetSize);
        buffer = buffer.subarray(12 + packetSize);

        // Send to webview
        this.onVideoFrame(new Uint8Array(packetData), isConfig);
      }
    });

    socket.on('close', () => {
      console.log('Scrcpy socket closed');
      const wasConnected = this.isConnected;
      this.isConnected = false;
      // Report as error (not status) so reconnect button appears
      if (wasConnected && this.onError) {
        this.onError('Disconnected from device');
      } else {
        this.onStatus('Disconnected from device');
      }
    });

    socket.on('error', (err: Error) => {
      console.error('Socket error:', err);
      this.isConnected = false;
    });
  }

  /**
   * Handle scrcpy audio stream
   */
  private handleAudioStream(socket: net.Socket): void {
    this.audioSocket = socket;

    let buffer = Buffer.alloc(0);
    let codecReceived = false;

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Parse audio protocol
      while (buffer.length > 0) {
        if (!codecReceived) {
          // Audio codec metadata: codec_id (4 bytes only)
          if (buffer.length < 4) break;

          const codecId = buffer.readUInt32BE(0);
          console.log(`Audio: codec=0x${codecId.toString(16)} (opus=0x6f707573)`);
          buffer = buffer.subarray(4);
          codecReceived = true;

          // Notify webview to initialize audio decoder
          if (this.onAudioFrame) {
            this.onAudioFrame(new Uint8Array(0), true);
          }
          continue;
        }

        // Audio packets: pts_flags (8) + packet_size (4) + data
        if (buffer.length < 12) break;

        const ptsFlags = buffer.readBigUInt64BE(0);
        const packetSize = buffer.readUInt32BE(8);

        if (buffer.length < 12 + packetSize) break;

        const isConfig = (ptsFlags & (1n << 63n)) !== 0n;
        const packetData = buffer.subarray(12, 12 + packetSize);
        buffer = buffer.subarray(12 + packetSize);

        // Log first few audio packets for debugging
        this._audioPacketCount++;
        if (this._audioPacketCount <= 5) {
          console.log(`Audio packet #${this._audioPacketCount}: size=${packetSize}, isConfig=${isConfig}`);
        }

        // Send to webview
        if (this.onAudioFrame) {
          this.onAudioFrame(new Uint8Array(packetData), isConfig);
        }
      }
    });

    socket.on('close', () => {
      console.log('Audio socket closed');
    });

    socket.on('error', (err: Error) => {
      console.error('Audio socket error:', err);
    });
  }

  /**
   * Send touch event to device
   */
  sendTouch(
    normalizedX: number,
    normalizedY: number,
    action: 'down' | 'move' | 'up',
    _screenWidth: number,
    _screenHeight: number
  ): void {
    if (!this.controlSocket || !this.isConnected) {
      return;
    }

    // Convert normalized coordinates to device coordinates
    const x = Math.round(normalizedX * this.deviceWidth);
    const y = Math.round(normalizedY * this.deviceHeight);

    // Scrcpy control message format for touch:
    // type (1) + action (1) + pointer_id (8) + x (4) + y (4) + width (2) + height (2) + pressure (2) + action_button (4) + buttons (4)
    const msg = Buffer.alloc(32);

    // Type: INJECT_TOUCH_EVENT = 2
    msg.writeUInt8(2, 0);

    // Action
    let actionCode: number;
    switch (action) {
      case 'down': actionCode = 0; break; // AMOTION_EVENT_ACTION_DOWN
      case 'move': actionCode = 2; break; // AMOTION_EVENT_ACTION_MOVE
      case 'up': actionCode = 1; break;   // AMOTION_EVENT_ACTION_UP
    }
    msg.writeUInt8(actionCode, 1);

    // Pointer ID (8 bytes, use -1 for mouse/finger)
    msg.writeBigInt64BE(-1n, 2);

    // Position (x, y as 32-bit integers)
    msg.writeUInt32BE(x, 10);
    msg.writeUInt32BE(y, 14);

    // Screen width and height (16-bit)
    msg.writeUInt16BE(this.deviceWidth, 18);
    msg.writeUInt16BE(this.deviceHeight, 20);

    // Pressure (16-bit, 0xFFFF for full pressure, 0 for up)
    msg.writeUInt16BE(action === 'up' ? 0 : 0xFFFF, 22);

    // Action button (4 bytes)
    msg.writeUInt32BE(0, 24);

    // Buttons (4 bytes)
    msg.writeUInt32BE(0, 28);

    try {
      this.controlSocket.write(msg);
    } catch (error) {
      console.error('Failed to send touch event:', error);
    }
  }

  /**
   * Set display power (turn screen on/off)
   */
  setDisplayPower(on: boolean): void {
    if (!this.controlSocket || !this.isConnected) {
      return;
    }

    // Control message format: type (1) + boolean (1) = 2 bytes
    const msg = Buffer.alloc(2);
    msg.writeUInt8(10, 0); // TYPE_SET_DISPLAY_POWER = 10
    msg.writeUInt8(on ? 1 : 0, 1);

    try {
      this.controlSocket.write(msg);
    } catch (error) {
      console.error('Failed to set display power:', error);
    }
  }

  /**
   * Send key down event to device
   */
  sendKeyDown(keycode: number): void {
    this._sendKey(keycode, 0); // action: down = 0
  }

  /**
   * Send key up event to device
   */
  sendKeyUp(keycode: number): void {
    this._sendKey(keycode, 1); // action: up = 1
  }

  /**
   * Send key event with specific action and metastate
   */
  private _sendKey(keycode: number, action: number, metastate: number = 0): void {
    if (!this.controlSocket || !this.isConnected) {
      return;
    }

    // Scrcpy control message format for key event:
    // type (1) + action (1) + keycode (4) + repeat (4) + metastate (4) = 14 bytes
    const msg = Buffer.alloc(14);

    // Type: INJECT_KEYCODE = 0
    msg.writeUInt8(0, 0);
    // Action: down = 0, up = 1
    msg.writeUInt8(action, 1);
    // Keycode (32-bit big-endian)
    msg.writeUInt32BE(keycode, 2);
    // Repeat count (32-bit big-endian)
    msg.writeUInt32BE(0, 6);
    // Metastate (32-bit big-endian)
    msg.writeUInt32BE(metastate, 10);

    try {
      this.controlSocket.write(msg);
    } catch (error) {
      console.error('Failed to send key event:', error);
    }
  }

  /**
   * Send key event with metastate (for keyboard input with modifiers)
   */
  sendKeyWithMeta(keycode: number, action: 'down' | 'up', metastate: number): void {
    this._sendKey(keycode, action === 'down' ? 0 : 1, metastate);
  }

  /**
   * Send text to device using INJECT_TEXT (type 1)
   * More efficient than INJECT_KEYCODE for regular typing
   */
  sendText(text: string): void {
    if (!this.controlSocket || !this.isConnected || !text || text.length === 0) {
      return;
    }

    // Limit to 300 bytes (scrcpy protocol limit)
    const textBuffer = Buffer.from(text, 'utf8');
    const maxLength = 300;
    const textLength = Math.min(textBuffer.length, maxLength);

    // Message format: type(1) + length(4) + text
    const msg = Buffer.alloc(5 + textLength);
    msg.writeUInt8(1, 0); // SC_CONTROL_MSG_TYPE_INJECT_TEXT = 1
    msg.writeUInt32BE(textLength, 1);
    textBuffer.copy(msg, 5, 0, textLength);

    try {
      this.controlSocket.write(msg);
    } catch (error) {
      console.error('Failed to send text:', error);
    }
  }

  /**
   * Handle device messages from control socket (clipboard, ACKs, etc.)
   */
  private handleControlSocketData(socket: net.Socket): void {
    socket.on('data', (chunk: Buffer) => {
      this.deviceMsgBuffer = Buffer.concat([this.deviceMsgBuffer, chunk]);
      this.parseDeviceMessages();
    });
  }

  /**
   * Parse device messages from buffer
   */
  private parseDeviceMessages(): void {
    while (this.deviceMsgBuffer.length > 0) {
      if (this.deviceMsgBuffer.length < 1) break;

      const msgType = this.deviceMsgBuffer.readUInt8(0);

      switch (msgType) {
        case 0: { // DEVICE_MSG_TYPE_CLIPBOARD
          if (this.deviceMsgBuffer.length < 5) return; // Need type + length
          const textLength = this.deviceMsgBuffer.readUInt32BE(1);
          if (this.deviceMsgBuffer.length < 5 + textLength) return; // Need full message

          const text = this.deviceMsgBuffer.subarray(5, 5 + textLength).toString('utf8');
          this.deviceMsgBuffer = this.deviceMsgBuffer.subarray(5 + textLength);

          this.handleDeviceClipboard(text);
          break;
        }

        case 1: { // DEVICE_MSG_TYPE_ACK_CLIPBOARD
          if (this.deviceMsgBuffer.length < 9) return; // Need type + sequence
          this.deviceMsgBuffer = this.deviceMsgBuffer.subarray(9);
          // ACK received, clipboard set successfully
          break;
        }

        case 2: { // DEVICE_MSG_TYPE_UHID_OUTPUT
          if (this.deviceMsgBuffer.length < 5) return; // Need type + id + length
          const dataLength = this.deviceMsgBuffer.readUInt16BE(3);
          if (this.deviceMsgBuffer.length < 5 + dataLength) return;
          this.deviceMsgBuffer = this.deviceMsgBuffer.subarray(5 + dataLength);
          // Ignore UHID messages
          break;
        }

        default:
          // Unknown message type, skip one byte and continue
          console.warn(`Unknown device message type: ${msgType}`);
          this.deviceMsgBuffer = this.deviceMsgBuffer.subarray(1);
      }
    }
  }

  /**
   * Handle clipboard update from device
   */
  private handleDeviceClipboard(text: string): void {
    // Avoid sync loop - don't sync back if we just sent this
    if (text === this.lastHostClipboard) return;

    this.lastDeviceClipboard = text;
    // Update lastHostClipboard synchronously to prevent race condition with polling
    this.lastHostClipboard = text;

    // Notify callback
    if (this.onClipboard) {
      this.onClipboard(text);
    }

    // Update host clipboard if API available
    if (this.clipboardAPI && this.config.clipboardSync) {
      this.clipboardAPI.writeText(text).then(
        () => { /* already updated synchronously */ },
        (err) => { console.error('Failed to write to host clipboard:', err); }
      );
    }
  }

  /**
   * Sync PC clipboard to device and optionally paste
   * Called when user wants to paste on the device
   */
  async pasteFromHost(): Promise<void> {
    if (!this.clipboardAPI || !this.isConnected || !this.config.clipboardSync) return;

    try {
      const text = await this.clipboardAPI.readText();
      if (text) {
        this.sendSetClipboard(text, true); // paste=true to paste immediately
      }
    } catch (err) {
      console.error('Failed to read host clipboard:', err);
    }
  }

  /**
   * Copy selected text from device to PC clipboard
   * Called when user wants to copy on the device
   */
  async copyToHost(): Promise<void> {
    if (!this.clipboardAPI || !this.isConnected || !this.config.clipboardSync) return;

    // Send Ctrl+C to device to trigger copy, then device will send clipboard update
    // The handleDeviceClipboard will update the host clipboard when device sends it
    this.sendKeyWithMeta(46, 'down', 0x1000); // KEYCODE_C with CTRL
    this.sendKeyWithMeta(46, 'up', 0x1000);
  }

  /**
   * Send SET_CLIPBOARD message to device
   */
  private sendSetClipboard(text: string, paste: boolean = false): void {
    if (!this.controlSocket || !this.isConnected) return;

    const textBuffer = Buffer.from(text, 'utf8');
    // Max clipboard size: 256KB - 14 bytes header
    const maxTextLength = (256 * 1024) - 14;

    const textLength = Math.min(textBuffer.length, maxTextLength);

    // Message format: type(1) + sequence(8) + paste(1) + length(4) + text
    const msg = Buffer.alloc(14 + textLength);
    msg.writeUInt8(9, 0); // SC_CONTROL_MSG_TYPE_SET_CLIPBOARD = 9
    msg.writeBigUInt64BE(this.clipboardSequence++, 1);
    msg.writeUInt8(paste ? 1 : 0, 9); // paste flag
    msg.writeUInt32BE(textLength, 10);
    textBuffer.copy(msg, 14, 0, textLength);

    try {
      this.controlSocket.write(msg);
      this.lastHostClipboard = text;
    } catch (error) {
      console.error('Failed to send clipboard:', error);
    }
  }

  /**
   * Stop clipboard sync (legacy - now a no-op)
   */
  private stopClipboardSync(): void {
    if (this.clipboardPollInterval) {
      clearInterval(this.clipboardPollInterval);
      this.clipboardPollInterval = null;
    }
  }

  /**
   * Disconnect from device
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;

    // Stop clipboard sync and reset state
    this.stopClipboardSync();
    this.lastHostClipboard = '';
    this.lastDeviceClipboard = '';
    this.clipboardSequence = 0n;
    this.deviceMsgBuffer = Buffer.alloc(0);

    // Close sockets
    if (this.videoSocket) {
      this.videoSocket.destroy();
      this.videoSocket = null;
    }
    if (this.audioSocket) {
      try {
        this.audioSocket.destroy();
      } catch {
        // Ignore destroy errors
      }
      this.audioSocket = null;
    }
    if (this.controlSocket) {
      this.controlSocket.destroy();
      this.controlSocket = null;
    }

    // Kill adb process
    if (this.adbProcess) {
      this.adbProcess.kill();
      this.adbProcess = null;
    }

    // Cleanup reverse port forwarding
    if (this.deviceSerial) {
      try {
        await this.execAdb('reverse --remove-all');
      } catch {
        // Ignore cleanup errors
      }
    }

    this.deviceSerial = null;
    this.scid = null;
  }
}
