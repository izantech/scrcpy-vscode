import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn, ChildProcess } from 'child_process';
import { ScrcpyProtocol } from './ScrcpyProtocol';

// Type for video frame callback
type VideoFrameCallback = (
  data: Uint8Array,
  isConfig: boolean,
  isKeyFrame: boolean,
  width?: number,
  height?: number
) => void;

// Type for audio frame callback
type AudioFrameCallback = (data: Uint8Array, isConfig: boolean) => void;

// Type for status callback
type StatusCallback = (status: string) => void;

// Type for error callback (used for unexpected disconnects)
type ErrorCallback = (message: string) => void;

// Scrcpy configuration options
export interface ScrcpyConfig {
  scrcpyPath: string;
  displayMode: 'mirror' | 'virtual';
  virtualDisplayWidth: number;
  virtualDisplayHeight: number;
  virtualDisplayDpi: number;
  screenOff: boolean;
  stayAwake: boolean;
  maxSize: number;
  bitRate: number;
  maxFps: number;
  showTouches: boolean;
  audio: boolean;
  clipboardSync: boolean;
  autoConnect: boolean;
  autoReconnect: boolean;
  reconnectRetries: number;
  lockVideoOrientation: boolean;
  scrollSensitivity: number;
  videoSource: 'display' | 'camera';
  cameraFacing: 'front' | 'back' | 'external';
  cameraId: string;
  cameraSize: string;
  cameraFps: number;
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
    this.onStatus(vscode.l10n.t('Connecting to ADB daemon...'));

    const devices = await this.getDeviceList();

    if (devices.length === 0) {
      throw new Error(
        vscode.l10n.t(
          'No Android devices found.\n\nPlease ensure:\n1. Device is connected via USB\n2. USB debugging is enabled\n3. ADB is authorized on the device'
        )
      );
    }

    // Use target serial if specified, otherwise first device
    if (this.targetSerial) {
      if (!devices.includes(this.targetSerial)) {
        throw new Error(vscode.l10n.t('Device {0} not found or not authorized', this.targetSerial));
      }
      this.deviceSerial = this.targetSerial;
    } else {
      this.deviceSerial = devices[0];
    }
    this.onStatus(vscode.l10n.t('Found device: {0}', this.deviceSerial));
  }

  /**
   * Get list of connected devices from ADB
   */
  private getDeviceList(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      exec('adb devices', (error, stdout, _stderr) => {
        if (error) {
          reject(
            new Error(
              vscode.l10n.t(
                'Failed to run "adb devices".\n\nPlease ensure ADB is installed and in your PATH.\nInstall via: brew install android-platform-tools (macOS)\nOr download from: https://developer.android.com/studio/releases/platform-tools'
              )
            )
          );
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
      throw new Error(vscode.l10n.t('No device connected'));
    }

    this.onStatus(vscode.l10n.t('Starting scrcpy server...'));

    // Get installed scrcpy version
    const scrcpyVersion = await this.getScrcpyVersion();
    this.onStatus(vscode.l10n.t('Using scrcpy {0}', scrcpyVersion));

    // Ensure scrcpy server exists on device
    await this.ensureServerOnDevice();

    // Generate unique session ID
    this.scid = Math.floor(Math.random() * 0x7fffffff)
      .toString(16)
      .padStart(8, '0');
    const localPort = 27183 + Math.floor(Math.random() * 16);

    // Setup reverse port forwarding
    await this.execAdb(`reverse localabstract:scrcpy_${this.scid} tcp:${localPort}`);

    // Create local server to receive connections
    // The server connects separately for video and control sockets
    const server = net.createServer();

    // Number of sockets: video + control (+ audio if enabled)
    const expectedSockets = this.config.audio ? 3 : 2;

    const connectionPromise = new Promise<{
      videoSocket: net.Socket;
      controlSocket: net.Socket;
      audioSocket: net.Socket | null;
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.close();
        reject(
          new Error(
            vscode.l10n.t(
              'Timeout waiting for device connection. The server may have failed to start.'
            )
          )
        );
      }, 15000);

      const sockets: net.Socket[] = [];

      server.on('connection', (socket: net.Socket) => {
        sockets.push(socket);
        // We need 2 or 3 connections depending on audio
        if (sockets.length === expectedSockets) {
          clearTimeout(timeout);
          // Order: video, audio (if enabled), control (control is always last)
          if (this.config.audio) {
            resolve({
              videoSocket: sockets[0],
              audioSocket: sockets[1],
              controlSocket: sockets[2],
            });
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

    // Build new_display parameter for virtual display mode
    let newDisplayArg: string | null = null;
    if (this.config.displayMode === 'virtual') {
      const width = this.config.virtualDisplayWidth;
      const height = this.config.virtualDisplayHeight;
      const dpi = this.config.virtualDisplayDpi;

      if (dpi > 0) {
        newDisplayArg = `new_display=${width}x${height}/${dpi}`;
      } else {
        newDisplayArg = `new_display=${width}x${height}`;
      }
    }

    // Start scrcpy server on device
    const serverArgs = [
      '-s',
      this.deviceSerial,
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
      `video_source=${this.config.videoSource}`,
      `max_size=${this.config.maxSize}`,
      `video_bit_rate=${this.config.bitRate * 1000000}`,
      `max_fps=${this.config.maxFps}`,
      `stay_awake=${this.config.stayAwake}`,
      `show_touches=${this.config.showTouches}`,
      ...(this.config.lockVideoOrientation ? ['capture_orientation=@'] : []),
      // Camera options (only used when video_source=camera)
      ...(this.config.videoSource === 'camera'
        ? [
            `camera_facing=${this.config.cameraFacing}`,
            ...(this.config.cameraId ? [`camera_id=${this.config.cameraId}`] : []),
            ...(this.config.cameraSize ? [`camera_size=${this.config.cameraSize}`] : []),
            ...(this.config.cameraFps > 0 ? [`camera_fps=${this.config.cameraFps}`] : []),
          ]
        : []),
      ...(newDisplayArg ? [newDisplayArg] : []),
      'send_device_meta=true',
      'send_frame_meta=true',
      'send_codec_meta=true',
    ];

    this.adbProcess = spawn('adb', serverArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
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
          this.onError(vscode.l10n.t('Server disconnected'));
        } else {
          this.onStatus(vscode.l10n.t('Server disconnected'));
        }
      }
    });

    // Wait for device to connect
    this.onStatus(vscode.l10n.t('Waiting for device to connect...'));

    try {
      const { videoSocket, controlSocket, audioSocket } = await connectionPromise;
      server.close();

      this.isConnected = true;
      this.controlSocket = controlSocket;
      this.onStatus(vscode.l10n.t('Connected! Receiving video stream...'));

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
          reject(
            new Error(
              vscode.l10n.t(
                'Failed to get scrcpy version.\n\nPlease ensure scrcpy is installed:\n- macOS: brew install scrcpy\n- Linux: sudo apt install scrcpy\n- Windows: scoop install scrcpy\n\nOr set the scrcpy path in settings.'
              )
            )
          );
          return;
        }

        // Parse version from output like "scrcpy 3.3.3 <https://...>"
        const match = stdout.match(/scrcpy\s+(\d+\.\d+(?:\.\d+)?)/);
        if (match) {
          resolve(match[1]);
        } else {
          reject(new Error(vscode.l10n.t('Could not parse scrcpy version')));
        }
      });
    });
  }

  /**
   * Ensure scrcpy server JAR exists on device and matches client version
   * Always pushes the server to avoid version mismatch issues
   */
  private async ensureServerOnDevice(): Promise<void> {
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
      path.join(process.env.PROGRAMDATA || '', 'chocolatey/lib/scrcpy/tools/scrcpy-server'),
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
        vscode.l10n.t(
          'scrcpy-server not found.\n\nPlease install scrcpy first:\n- macOS: brew install scrcpy\n- Linux: sudo apt install scrcpy\n- Windows: scoop install scrcpy\n\nOr download from: https://github.com/Genymobile/scrcpy/releases'
        )
      );
    }

    this.onStatus(vscode.l10n.t('Pushing scrcpy server to device...'));
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
          if (buffer.length < ScrcpyProtocol.DEVICE_NAME_LENGTH) {
            break;
          }

          const deviceName = buffer
            .subarray(0, ScrcpyProtocol.DEVICE_NAME_LENGTH)
            .toString('utf8')
            .replace(/\0+$/, '');
          console.log('Device name:', deviceName);
          buffer = buffer.subarray(ScrcpyProtocol.DEVICE_NAME_LENGTH);
          headerReceived = true;
          continue;
        }

        if (!codecReceived) {
          // Video codec metadata: codec_id (4) + width (4) + height (4) = 12 bytes
          if (buffer.length < 12) {
            break;
          }

          const codecId = buffer.readUInt32BE(0);
          this.deviceWidth = buffer.readUInt32BE(4);
          this.deviceHeight = buffer.readUInt32BE(8);

          console.log(
            `Video: codec=0x${codecId.toString(16)}, ${this.deviceWidth}x${this.deviceHeight}`
          );
          buffer = buffer.subarray(12);
          codecReceived = true;

          // Notify webview of video dimensions
          this.onVideoFrame(new Uint8Array(0), true, false, this.deviceWidth, this.deviceHeight);
          continue;
        }

        // Check for new codec metadata (sent on rotation/reconfiguration)
        // Codec metadata: codec_id (4) + width (4) + height (4)
        // H.264 codec_id = 0x68323634 ("h264")
        if (buffer.length >= 12) {
          const possibleCodecId = buffer.readUInt32BE(0);
          if (possibleCodecId === ScrcpyProtocol.VIDEO_CODEC_ID_H264) {
            const newWidth = buffer.readUInt32BE(4);
            const newHeight = buffer.readUInt32BE(8);

            // Sanity check dimensions
            if (newWidth > 0 && newWidth < 10000 && newHeight > 0 && newHeight < 10000) {
              if (newWidth !== this.deviceWidth || newHeight !== this.deviceHeight) {
                this.deviceWidth = newWidth;
                this.deviceHeight = newHeight;
                console.log(`Video reconfigured: ${this.deviceWidth}x${this.deviceHeight}`);
                buffer = buffer.subarray(12);

                // Notify webview of new dimensions
                this.onVideoFrame(
                  new Uint8Array(0),
                  true,
                  false,
                  this.deviceWidth,
                  this.deviceHeight
                );
                continue;
              }
            }
          }
        }

        // Video packets: pts_flags (8) + packet_size (4) + data
        if (buffer.length < 12) {
          break;
        }

        const ptsFlags = buffer.readBigUInt64BE(0);
        const packetSize = buffer.readUInt32BE(8);

        if (buffer.length < 12 + packetSize) {
          break;
        }

        const isConfig = (ptsFlags & (1n << 63n)) !== 0n;
        const isKeyFrame = (ptsFlags & (1n << 62n)) !== 0n;
        // const pts = ptsFlags & ((1n << 62n) - 1n);

        const packetData = buffer.subarray(12, 12 + packetSize);
        buffer = buffer.subarray(12 + packetSize);

        // Send to webview
        this.onVideoFrame(new Uint8Array(packetData), isConfig, isKeyFrame);
      }
    });

    socket.on('close', () => {
      console.log('Scrcpy socket closed');
      const wasConnected = this.isConnected;
      this.isConnected = false;
      // Report as error (not status) so reconnect button appears
      if (wasConnected && this.onError) {
        this.onError(vscode.l10n.t('Disconnected from device'));
      } else {
        this.onStatus(vscode.l10n.t('Disconnected from device'));
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
          if (buffer.length < 4) {
            break;
          }

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
        if (buffer.length < 12) {
          break;
        }

        const ptsFlags = buffer.readBigUInt64BE(0);
        const packetSize = buffer.readUInt32BE(8);

        if (buffer.length < 12 + packetSize) {
          break;
        }

        const isConfig = (ptsFlags & (1n << 63n)) !== 0n;
        const packetData = buffer.subarray(12, 12 + packetSize);
        buffer = buffer.subarray(12 + packetSize);

        // Log first few audio packets for debugging
        this._audioPacketCount++;
        if (this._audioPacketCount <= 5) {
          console.log(
            `Audio packet #${this._audioPacketCount}: size=${packetSize}, isConfig=${isConfig}`
          );
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
    msg.writeUInt8(ScrcpyProtocol.ControlMessageType.INJECT_TOUCH_EVENT, 0);

    // Action
    let actionCode: number;
    switch (action) {
      case 'down':
        actionCode = ScrcpyProtocol.MotionEventAction.DOWN;
        break; // AMOTION_EVENT_ACTION_DOWN
      case 'move':
        actionCode = ScrcpyProtocol.MotionEventAction.MOVE;
        break; // AMOTION_EVENT_ACTION_MOVE
      case 'up':
        actionCode = ScrcpyProtocol.MotionEventAction.UP;
        break; // AMOTION_EVENT_ACTION_UP
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
    msg.writeUInt16BE(action === 'up' ? 0 : 0xffff, 22);

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
   * Send scroll event to device.
   * Handles large deltas by splitting them into multiple valid packets.
   */
  sendScroll(normalizedX: number, normalizedY: number, deltaX: number, deltaY: number): void {
    if (!this.controlSocket || !this.isConnected) {
      return;
    }

    // Convert normalized coordinates to device coordinates
    const x = Math.round(normalizedX * this.deviceWidth);
    const y = Math.round(normalizedY * this.deviceHeight);

    // Apply sensitivity config
    const sensitivity = this.config.scrollSensitivity;
    let hScrollRemaining = deltaX * sensitivity;
    let vScrollRemaining = deltaY * sensitivity;

    // Max 16-bit signed int value for fixed-point math
    // Use 32767 instead of 32768 to stay safely within signed range
    const FIXED_POINT_MULTIPLIER = 32767;

    // Loop until we have sent the entire scroll distance
    while (Math.abs(hScrollRemaining) > 0.001 || Math.abs(vScrollRemaining) > 0.001) {
      // Clamp the step to [-1, 1] range allowed by protocol
      const stepH = Math.max(-1, Math.min(1, hScrollRemaining));
      const stepV = Math.max(-1, Math.min(1, vScrollRemaining));

      // Scrcpy scroll message format (21 bytes):
      // type (1) + x (4) + y (4) + width (2) + height (2) + hScroll (2) + vScroll (2) + buttons (4)
      const msg = Buffer.alloc(21);

      // Type: INJECT_SCROLL_EVENT = 3
      msg.writeUInt8(ScrcpyProtocol.ControlMessageType.INJECT_SCROLL_EVENT, 0);

      // Position (x, y as 32-bit integers)
      msg.writeUInt32BE(x, 1);
      msg.writeUInt32BE(y, 5);

      // Screen width and height (16-bit)
      msg.writeUInt16BE(this.deviceWidth, 9);
      msg.writeUInt16BE(this.deviceHeight, 11);

      // Fixed-point scroll values
      const hScrollFixed = Math.round(stepH * FIXED_POINT_MULTIPLIER);
      const vScrollFixed = Math.round(stepV * FIXED_POINT_MULTIPLIER);

      msg.writeInt16BE(hScrollFixed, 13);
      msg.writeInt16BE(vScrollFixed, 15);

      // Buttons (4 bytes) - no buttons held during scroll
      msg.writeUInt32BE(0, 17);

      try {
        this.controlSocket.write(msg);
      } catch (error) {
        console.error('Failed to send scroll event:', error);
        break;
      }

      // Subtract what we just sent
      hScrollRemaining -= stepH;
      vScrollRemaining -= stepV;
    }
  }

  /**
   * Update device dimensions (called when webview detects rotation via SPS parsing)
   */
  updateDimensions(width: number, height: number): void {
    if (width !== this.deviceWidth || height !== this.deviceHeight) {
      this.deviceWidth = width;
      this.deviceHeight = height;
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
    msg.writeUInt8(ScrcpyProtocol.ControlMessageType.SET_DISPLAY_POWER, 0); // TYPE_SET_DISPLAY_POWER = 10
    msg.writeUInt8(on ? 1 : 0, 1);

    try {
      this.controlSocket.write(msg);
    } catch (error) {
      console.error('Failed to set display power:', error);
    }
  }

  /**
   * Rotate device screen counter-clockwise
   */
  rotateDevice(): void {
    if (!this.controlSocket || !this.isConnected) {
      return;
    }

    // Control message format: type (1) = 1 byte only
    const msg = Buffer.alloc(1);
    msg.writeUInt8(ScrcpyProtocol.ControlMessageType.ROTATE_DEVICE, 0); // TYPE_ROTATE_DEVICE = 11

    try {
      this.controlSocket.write(msg);
    } catch (error) {
      console.error('Failed to rotate device:', error);
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
    msg.writeUInt8(ScrcpyProtocol.ControlMessageType.INJECT_KEYCODE, 0);
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
    msg.writeUInt8(ScrcpyProtocol.ControlMessageType.INJECT_TEXT, 0); // SC_CONTROL_MSG_TYPE_INJECT_TEXT = 1
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
      if (this.deviceMsgBuffer.length < 1) {
        break;
      }

      const msgType = this.deviceMsgBuffer.readUInt8(0);

      switch (msgType) {
        case ScrcpyProtocol.DeviceMessageType.CLIPBOARD: {
          // DEVICE_MSG_TYPE_CLIPBOARD
          if (this.deviceMsgBuffer.length < 5) {
            return;
          } // Need type + length
          const textLength = this.deviceMsgBuffer.readUInt32BE(1);
          if (this.deviceMsgBuffer.length < 5 + textLength) {
            return;
          } // Need full message

          const text = this.deviceMsgBuffer.subarray(5, 5 + textLength).toString('utf8');
          this.deviceMsgBuffer = this.deviceMsgBuffer.subarray(5 + textLength);

          this.handleDeviceClipboard(text);
          break;
        }

        case ScrcpyProtocol.DeviceMessageType.ACK_CLIPBOARD: {
          // DEVICE_MSG_TYPE_ACK_CLIPBOARD
          if (this.deviceMsgBuffer.length < 9) {
            return;
          } // Need type + sequence
          this.deviceMsgBuffer = this.deviceMsgBuffer.subarray(9);
          // ACK received, clipboard set successfully
          break;
        }

        case ScrcpyProtocol.DeviceMessageType.UHID_OUTPUT: {
          // DEVICE_MSG_TYPE_UHID_OUTPUT
          if (this.deviceMsgBuffer.length < 5) {
            return;
          } // Need type + id + length
          const dataLength = this.deviceMsgBuffer.readUInt16BE(3);
          if (this.deviceMsgBuffer.length < 5 + dataLength) {
            return;
          }
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
    if (text === this.lastHostClipboard) {
      return;
    }

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
        () => {
          /* already updated synchronously */
        },
        (err) => {
          console.error('Failed to write to host clipboard:', err);
        }
      );
    }
  }

  /**
   * Sync PC clipboard to device and optionally paste
   * Called when user wants to paste on the device
   */
  async pasteFromHost(): Promise<void> {
    if (!this.clipboardAPI || !this.isConnected || !this.config.clipboardSync) {
      return;
    }

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
    if (!this.clipboardAPI || !this.isConnected || !this.config.clipboardSync) {
      return;
    }

    // Send Ctrl+C to device to trigger copy, then device will send clipboard update
    // The handleDeviceClipboard will update the host clipboard when device sends it
    this.sendKeyWithMeta(46, 'down', 0x1000); // KEYCODE_C with CTRL
    this.sendKeyWithMeta(46, 'up', 0x1000);
  }

  /**
   * Send SET_CLIPBOARD message to device
   */
  private sendSetClipboard(text: string, paste: boolean = false): void {
    if (!this.controlSocket || !this.isConnected) {
      return;
    }

    const textBuffer = Buffer.from(text, 'utf8');
    // Max clipboard size: 256KB - 14 bytes header
    const maxTextLength = 256 * 1024 - 14;

    const textLength = Math.min(textBuffer.length, maxTextLength);

    // Message format: type(1) + sequence(8) + paste(1) + length(4) + text
    const msg = Buffer.alloc(14 + textLength);
    msg.writeUInt8(ScrcpyProtocol.ControlMessageType.SET_CLIPBOARD, 0); // SC_CONTROL_MSG_TYPE_SET_CLIPBOARD = 9
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
   * Install an APK on the device
   */
  async installApk(filePath: string): Promise<void> {
    if (!this.deviceSerial) {
      throw new Error(vscode.l10n.t('No device connected'));
    }
    await this.execAdb(`install -r "${filePath}"`);
  }

  /**
   * Push files/folders to the device in a single adb push command
   */
  async pushFiles(filePaths: string[], destPath: string = '/sdcard/Download/'): Promise<void> {
    if (!this.deviceSerial) {
      throw new Error(vscode.l10n.t('No device connected'));
    }
    if (filePaths.length === 0) {
      return;
    }
    const quotedPaths = filePaths.map((p) => `"${p}"`).join(' ');
    await this.execAdb(`push ${quotedPaths} "${destPath}"`);
  }

  /**
   * List available cameras on the device
   */
  async listCameras(): Promise<string> {
    if (!this.deviceSerial) {
      throw new Error(vscode.l10n.t('No device connected'));
    }

    // Ensure scrcpy server exists on device
    await this.ensureServerOnDevice();

    // Get installed scrcpy version
    const scrcpyVersion = await this.getScrcpyVersion();

    return new Promise((resolve, reject) => {
      const args = [
        '-s',
        this.deviceSerial!,
        'shell',
        'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
        'app_process',
        '/',
        'com.genymobile.scrcpy.Server',
        scrcpyVersion,
        'list_cameras=true',
      ];

      const proc = spawn('adb', args);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // The output will be in stderr (scrcpy server uses Ln.i which outputs to stderr)
          resolve(stderr || stdout);
        } else {
          reject(new Error(`Failed to list cameras (exit code ${code})`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run list cameras command: ${err.message}`));
      });
    });
  }

  /**
   * Take a screenshot using ADB screencap (original resolution, lossless)
   */
  async takeScreenshot(): Promise<Buffer> {
    if (!this.deviceSerial) {
      throw new Error(vscode.l10n.t('No device connected'));
    }

    return new Promise((resolve, reject) => {
      const args = ['-s', this.deviceSerial!, 'exec-out', 'screencap', '-p'];
      const proc = spawn('adb', args);

      const chunks: Buffer[] = [];
      proc.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      proc.stderr.on('data', (data: Buffer) => {
        console.error('screencap stderr:', data.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(vscode.l10n.t('screencap failed with code {0}', code ?? -1)));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(vscode.l10n.t('Failed to run screencap: {0}', err.message)));
      });
    });
  }

  /**
   * Start app on device by package name
   * @param packageName - Package name like "com.android.settings"
   */
  startApp(packageName: string): void {
    if (!packageName || packageName.trim() === '') {
      return;
    }

    if (!this.controlSocket || !this.isConnected) {
      return;
    }

    // START_APP message format (from ControlMessageReader.java):
    // - Type: 1 byte (16 = TYPE_START_APP)
    // - Name length: 1 byte (parseString(1) uses 1-byte length)
    // - Name: UTF-8 string (package name, max 255 bytes)
    const nameBuffer = Buffer.from(packageName, 'utf8');
    const nameLength = Math.min(nameBuffer.length, 255);

    const msg = Buffer.alloc(1 + 1 + nameLength);
    msg.writeUInt8(ScrcpyProtocol.ControlMessageType.START_APP, 0);
    msg.writeUInt8(nameLength, 1);
    nameBuffer.copy(msg, 2, 0, nameLength);

    try {
      this.controlSocket.write(msg);
    } catch (error) {
      console.error('Failed to start app:', error);
    }
  }

  /**
   * Get list of installed apps from device
   * @param thirdPartyOnly - If true, only list third-party apps (default: false)
   * @returns Array of app info objects with package name and label
   */
  async getInstalledApps(
    thirdPartyOnly: boolean = false
  ): Promise<Array<{ packageName: string; label: string }>> {
    if (!this.deviceSerial) {
      throw new Error(vscode.l10n.t('No device connected'));
    }

    // List packages
    const listCmd = thirdPartyOnly ? 'shell pm list packages -3' : 'shell pm list packages';
    const packagesOutput = await this.execAdb(listCmd);
    const lines = packagesOutput.trim().split('\n');
    const apps: Array<{ packageName: string; label: string }> = [];

    for (const line of lines) {
      const match = line.match(/^package:(.+)$/);
      if (!match) {
        continue;
      }

      const packageName = match[1].trim();
      // Use package name as label for now
      apps.push({ packageName, label: packageName });
    }

    // Sort by package name
    apps.sort((a, b) => a.packageName.localeCompare(b.packageName));

    return apps;
  }

  /**
   * Disconnect from device
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;

    // Reset clipboard state
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
