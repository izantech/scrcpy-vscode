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

// Type for status callback
type StatusCallback = (status: string) => void;

// Scrcpy configuration options
export interface ScrcpyConfig {
  scrcpyPath: string;
  screenOff: boolean;
  stayAwake: boolean;
  maxSize: number;
  bitRate: number;
  maxFps: number;
  showTouches: boolean;
}

/**
 * Manages scrcpy connection to Android device via ADB
 *
 * Uses ADB shell commands and direct socket communication
 * to mirror Android device screen.
 */
export class ScrcpyConnection {
  private deviceSerial: string | null = null;
  private videoSocket: net.Socket | null = null;
  private controlSocket: net.Socket | null = null;
  private adbProcess: ChildProcess | null = null;
  private deviceWidth = 0;
  private deviceHeight = 0;
  private isConnected = false;
  private scid: string | null = null;

  constructor(
    private onVideoFrame: VideoFrameCallback,
    private onStatus: StatusCallback,
    private config: ScrcpyConfig
  ) {}

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

    // Use first device
    this.deviceSerial = devices[0];
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

    const connectionPromise = new Promise<{ videoSocket: net.Socket; controlSocket: net.Socket }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('Timeout waiting for device connection. The server may have failed to start.'));
      }, 15000);

      const sockets: net.Socket[] = [];

      server.on('connection', (socket: net.Socket) => {
        sockets.push(socket);
        // We need 2 connections: video + control
        if (sockets.length === 2) {
          clearTimeout(timeout);
          // First connection is video, second is control
          resolve({ videoSocket: sockets[0], controlSocket: sockets[1] });
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
      'audio=false',
      'control=true',
      'video_codec=h264',
      `max_size=${this.config.maxSize}`,
      `video_bit_rate=${this.config.bitRate * 1000000}`,
      `max_fps=${this.config.maxFps}`,
      `turn_screen_off=${this.config.screenOff}`,
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
        this.onStatus('Server disconnected');
      }
    });

    // Wait for device to connect
    this.onStatus('Waiting for device to connect...');

    try {
      const { videoSocket, controlSocket } = await connectionPromise;
      server.close();

      this.isConnected = true;
      this.controlSocket = controlSocket;
      this.onStatus('Connected! Receiving video stream...');

      // Handle the scrcpy protocol on video socket
      this.handleScrcpyStream(videoSocket);

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
      this.isConnected = false;
      this.onStatus('Disconnected from device');
    });

    socket.on('error', (err: Error) => {
      console.error('Socket error:', err);
      this.isConnected = false;
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
   * Disconnect from device
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;

    // Close sockets
    if (this.videoSocket) {
      this.videoSocket.destroy();
      this.videoSocket = null;
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
