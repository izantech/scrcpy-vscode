import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn, execFileSync } from 'child_process';
import { MockChildProcess, resetMocks as resetChildProcessMocks } from '../mocks/child_process';

// Mock child_process module before importing DeviceService
vi.mock('child_process', () => import('../mocks/child_process'));

// Mock vscode module
vi.mock('vscode', () => import('../mocks/vscode'));

// Import after mocks are set up
import { DeviceService } from '../../src/DeviceService';
import { AppStateManager } from '../../src/AppStateManager';
import { ScrcpyConfig } from '../../src/ScrcpyConnection';
import { ActionType } from '../../src/types/Actions';

describe('DeviceService Auto-Connect Logic', () => {
  let service: DeviceService;
  let appState: AppStateManager;
  let videoCallback: ReturnType<typeof vi.fn>;
  let audioCallback: ReturnType<typeof vi.fn>;
  let statusCallback: ReturnType<typeof vi.fn>;
  let errorCallback: ReturnType<typeof vi.fn>;
  let config: ScrcpyConfig;

  beforeEach(() => {
    resetChildProcessMocks();
    vi.clearAllMocks();

    appState = new AppStateManager();
    videoCallback = vi.fn();
    audioCallback = vi.fn();
    statusCallback = vi.fn();
    errorCallback = vi.fn();

    config = {
      scrcpyPath: '',
      screenOff: false,
      stayAwake: true,
      maxSize: 1920,
      bitRate: 8,
      maxFps: 60,
      showTouches: false,
      audio: false,
      clipboardSync: false,
      autoConnect: true, // Enabled for these tests
      autoReconnect: false,
      reconnectRetries: 2,
      lockVideoOrientation: false,
      scrollSensitivity: 1.0,
      videoCodec: 'h264',
    };

    service = new DeviceService(
      appState,
      videoCallback,
      audioCallback,
      statusCallback,
      errorCallback,
      config
    );
  });

  afterEach(async () => {
    await service.disconnectAll();
  });

  it('should add device to allowed list when added (manual or auto)', async () => {
    const deviceInfo = {
      serial: 'serial123',
      name: 'test-device',
      model: 'test-model',
    };

    try {
      await service.addDevice(deviceInfo);
    } catch (e) {
      // Expected to fail connection in this test env
    }

    expect(appState.isAllowedAutoConnectDevice('serial123')).toBe(true);
  });

  it('should remove device from allowed list when removed', async () => {
    // Pre-populate list
    appState.dispatch({
      type: ActionType.ADD_ALLOWED_AUTO_CONNECT,
      payload: { serial: 'serial123' },
    });

    // Inject fake session
    const session = {
      deviceId: 'device_1',
      deviceInfo: { serial: 'serial123', name: 'test', model: 'test' },
      isDisposed: false,
      connection: { disconnect: vi.fn().mockResolvedValue(undefined) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as unknown as { sessions: Map<string, typeof session> }).sessions.set(
      'device_1',
      session
    );
    appState.dispatch({
      type: ActionType.ADD_DEVICE,
      payload: {
        deviceId: 'device_1',
        serial: 'serial123',
        name: 'test',
        model: 'test',
        connectionState: 'connected',
        isActive: true,
      },
    });

    await service.removeDevice('device_1');

    expect(appState.isAllowedAutoConnectDevice('serial123')).toBe(false);
  });

  it('should not auto-connect if device is not in allowed list', async () => {
    // allowed list is empty by default

    const mockProcess = new MockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess);

    await service.startDeviceMonitoring();

    const deviceList = 'serial123\tdevice\n';
    const hexLength = deviceList.length.toString(16).padStart(4, '0');

    const addDeviceSpy = vi.spyOn(service, 'addDevice');

    mockProcess.stdout.emit('data', Buffer.from(hexLength + deviceList));

    expect(addDeviceSpy).not.toHaveBeenCalled();

    service.stopDeviceMonitoring();
  });

  it('should auto-connect if device IS in allowed list', async () => {
    // Pre-populate allowed list
    appState.dispatch({
      type: ActionType.ADD_ALLOWED_AUTO_CONNECT,
      payload: { serial: 'serial123' },
    });

    const mockProcess = new MockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess);

    await service.startDeviceMonitoring();

    const deviceList = 'serial123\tdevice\n';
    const hexLength = deviceList.length.toString(16).padStart(4, '0');

    // Mock execFileSync to return model
    vi.mocked(execFileSync).mockReturnValue('TestModel');

    const addDeviceSpy = vi.spyOn(service, 'addDevice').mockImplementation(async () => 'device_id');

    mockProcess.stdout.emit('data', Buffer.from(hexLength + deviceList));

    // Wait for microtasks
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(addDeviceSpy).toHaveBeenCalled();

    service.stopDeviceMonitoring();
  });
});
