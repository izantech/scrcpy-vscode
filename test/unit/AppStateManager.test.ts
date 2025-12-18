import { describe, it, expect, vi } from 'vitest';
import { AppStateManager } from '../../src/AppStateManager';
import {
  DeviceDetailedInfo,
  DeviceState,
  StatusMessage,
  ToolStatus,
  WebviewSettings,
} from '../../src/types/AppState';
import { ActionType } from '../../src/types/Actions';

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function createDevice(deviceId: string, serial: string, isActive: boolean = false): DeviceState {
  return {
    deviceId,
    serial,
    name: `Device ${deviceId}`,
    connectionState: 'disconnected',
    isActive,
  };
}

function createDeviceInfo(serial: string): DeviceDetailedInfo {
  return {
    serial,
    model: 'Model',
    manufacturer: 'Manufacturer',
    androidVersion: '14',
    sdkVersion: 34,
    batteryLevel: 50,
    batteryCharging: false,
    storageTotal: 1024,
    storageUsed: 256,
    screenResolution: '1080x2400',
  };
}

const addDevice = (appState: AppStateManager, device: DeviceState) =>
  appState.dispatch({ type: ActionType.ADD_DEVICE, payload: device });

const updateDevice = (appState: AppStateManager, deviceId: string, updates: Partial<DeviceState>) =>
  appState.dispatch({ type: ActionType.UPDATE_DEVICE, payload: { deviceId, updates } });

const setActiveDevice = (appState: AppStateManager, deviceId: string | null) =>
  appState.dispatch({ type: ActionType.SET_ACTIVE_DEVICE, payload: { deviceId } });

const updateSettings = (appState: AppStateManager, settings: Partial<WebviewSettings>) =>
  appState.dispatch({
    type: ActionType.UPDATE_SETTINGS,
    payload: settings,
  });

const updateToolStatus = (appState: AppStateManager, toolStatus: ToolStatus) =>
  appState.dispatch({
    type: ActionType.UPDATE_TOOL_STATUS,
    payload: toolStatus,
  });

const setStatusMessage = (appState: AppStateManager, message: StatusMessage | undefined) =>
  appState.dispatch({ type: ActionType.SET_STATUS_MESSAGE, payload: message });

const setDeviceInfo = (appState: AppStateManager, serial: string, info: DeviceDetailedInfo) =>
  appState.dispatch({ type: ActionType.SET_DEVICE_INFO, payload: { serial, info } });

const removeDevice = (appState: AppStateManager, deviceId: string) =>
  appState.dispatch({ type: ActionType.REMOVE_DEVICE, payload: { deviceId } });

const removeDeviceInfo = (appState: AppStateManager, serial: string) =>
  appState.dispatch({ type: ActionType.REMOVE_DEVICE_INFO, payload: { serial } });

const clearDeviceInfo = (appState: AppStateManager) =>
  appState.dispatch({ type: ActionType.CLEAR_DEVICE_INFO });

const clearAllDevices = (appState: AppStateManager) =>
  appState.dispatch({ type: ActionType.CLEAR_ALL_DEVICES });

const setMonitoring = (appState: AppStateManager, isMonitoring: boolean) =>
  appState.dispatch({ type: ActionType.SET_MONITORING, payload: { isMonitoring } });

const resetState = (appState: AppStateManager) => appState.dispatch({ type: ActionType.RESET });

describe('AppStateManager', () => {
  it('should return undefined for active device when none is set', () => {
    const appState = new AppStateManager();
    expect(appState.getActiveDeviceId()).toBeNull();
    expect(appState.getActiveDevice()).toBeUndefined();
  });

  it('should emit a single batched snapshot for multiple mutations', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();

    appState.subscribe(listener);

    addDevice(appState, createDevice('device_1', 'serial_1', true));
    updateSettings(appState, { showStats: true });
    updateToolStatus(appState, { adbAvailable: false, scrcpyAvailable: true });
    setStatusMessage(appState, { type: 'loading', text: 'Connecting...', deviceId: 'device_1' });

    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);

    const snapshot = listener.mock.calls[0][0];
    expect(snapshot.devices).toHaveLength(1);
    expect(snapshot.settings.showStats).toBe(true);
    expect(snapshot.toolStatus.adbAvailable).toBe(false);
    expect(snapshot.statusMessage?.text).toBe('Connecting...');
  });

  it('should not notify after unsubscribe', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();

    const unsubscribe = appState.subscribe(listener);
    updateSettings(appState, { showStats: true });
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    updateSettings(appState, { showStats: false });
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should continue notifying other listeners if one throws', async () => {
    const appState = new AppStateManager();
    const badListener = vi.fn(() => {
      throw new Error('boom');
    });
    const goodListener = vi.fn();

    appState.subscribe(badListener);
    appState.subscribe(goodListener);

    updateSettings(appState, { showStats: true });
    await flushMicrotasks();

    expect(badListener).toHaveBeenCalledTimes(1);
    expect(goodListener).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('Error in state listener:', expect.any(Error));
  });

  it('should clone snapshot fields that are meant to be immutable to consumers', () => {
    const appState = new AppStateManager();

    updateSettings(appState, { showStats: true });
    updateToolStatus(appState, { adbAvailable: false, scrcpyAvailable: true });
    setStatusMessage(appState, { type: 'loading', text: 'Hello' });

    const snapshot = appState.getSnapshot();
    snapshot.settings.showStats = false;
    snapshot.toolStatus.adbAvailable = true;
    if (snapshot.statusMessage) {
      snapshot.statusMessage.text = 'Mutated';
    }

    const next = appState.getSnapshot();
    expect(next.settings.showStats).toBe(true);
    expect(next.toolStatus.adbAvailable).toBe(false);
    expect(next.statusMessage?.text).toBe('Hello');
  });

  it('should support device lookups and not leak mutations from inputs', () => {
    const appState = new AppStateManager();
    const device = createDevice('device_1', 'serial_1', false);

    addDevice(appState, device);
    device.name = 'Mutated name';

    expect(appState.getDeviceCount()).toBe(1);
    expect(appState.hasDevice('device_1')).toBe(true);
    expect(appState.getDevice('device_1')?.name).toBe('Device device_1');
    expect(appState.getDeviceBySerial('serial_1')?.deviceId).toBe('device_1');
    expect(appState.getDeviceBySerial('missing')).toBeUndefined();
    expect(appState.getDeviceIds()).toEqual(['device_1']);
  });

  it('should no-op when updating a missing device', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();

    appState.subscribe(listener);
    updateDevice(appState, 'missing', { name: 'Nope' });
    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
  });

  it('should update device fields and preserve videoCodec when codec not provided', () => {
    const appState = new AppStateManager();
    addDevice(appState, createDevice('device_1', 'serial_1'));

    const updates = { name: 'Updated name' };
    updateDevice(appState, 'device_1', updates);
    updates.name = 'Mutated updates';

    expect(appState.getDevice('device_1')?.name).toBe('Updated name');

    updateDevice(appState, 'device_1', { connectionState: 'connecting' });
    expect(appState.getDevice('device_1')?.connectionState).toBe('connecting');

    updateDevice(appState, 'device_1', {
      videoDimensions: { width: 100, height: 200 },
      videoCodec: 'h265',
    });
    expect(appState.getDevice('device_1')?.videoDimensions).toEqual({ width: 100, height: 200 });
    expect(appState.getDevice('device_1')?.videoCodec).toBe('h265');

    updateDevice(appState, 'device_1', {
      videoDimensions: { width: 120, height: 220 },
    });
    expect(appState.getDevice('device_1')?.videoDimensions).toEqual({ width: 120, height: 220 });
    expect(appState.getDevice('device_1')?.videoCodec).toBe('h265');
  });

  it('should maintain a single active device and avoid redundant notifications', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    addDevice(appState, createDevice('device_1', 'serial_1', true));
    addDevice(appState, createDevice('device_2', 'serial_2', true));
    setActiveDevice(appState, 'device_2');

    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);

    const snapshot = listener.mock.calls[0][0];
    expect(snapshot.activeDeviceId).toBe('device_2');
    expect(snapshot.devices.filter((d) => d.isActive).map((d) => d.deviceId)).toEqual(['device_2']);

    // Setting the same active device should not trigger another notification
    setActiveDevice(appState, 'device_2');
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);

    expect(appState.getActiveDeviceId()).toBe('device_2');
    expect(appState.getActiveDevice()?.deviceId).toBe('device_2');
  });

  it('should update and protect settings/toolStatus getters from external mutation', () => {
    const appState = new AppStateManager();

    updateSettings(appState, { showStats: true });
    const settings = appState.getSettings();
    settings.showStats = false;
    expect(appState.getSettings().showStats).toBe(true);

    updateToolStatus(appState, { adbAvailable: false, scrcpyAvailable: false });
    const toolStatus = appState.getToolStatus();
    toolStatus.adbAvailable = true;
    expect(appState.getToolStatus().adbAvailable).toBe(false);
  });

  it('should set/clear status message and only notify when it changes', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    setStatusMessage(appState, undefined);
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();

    setStatusMessage(appState, { type: 'loading', text: 'Loading...' });
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(appState.getStatusMessage()?.text).toBe('Loading...');

    setStatusMessage(appState, undefined);
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(appState.getStatusMessage()).toBeUndefined();

    setStatusMessage(appState, undefined);
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('should allow clearing status message via setStatusMessage(undefined)', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    setStatusMessage(appState, { type: 'loading', text: 'Loading...' });
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);

    setStatusMessage(appState, undefined);
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(appState.getSnapshot().statusMessage).toBeUndefined();
  });

  it('should not notify when toggling monitoring state (internal-only)', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    expect(appState.isMonitoring()).toBe(false);
    setMonitoring(appState, false);
    await flushMicrotasks();
    expect(appState.isMonitoring()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    setMonitoring(appState, true);
    await flushMicrotasks();

    expect(appState.isMonitoring()).toBe(true);
    expect(listener).not.toHaveBeenCalled();

    setMonitoring(appState, false);
    await flushMicrotasks();

    expect(appState.isMonitoring()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('should clear all devices (and deviceInfo) and avoid notifying when already empty', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    clearAllDevices(appState);
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();

    setDeviceInfo(appState, 'serial_1', {
      serial: 'serial_1',
      model: 'Model 1',
      manufacturer: 'Manufacturer 1',
      androidVersion: '13',
      sdkVersion: 33,
      batteryLevel: 25,
      batteryCharging: false,
      storageTotal: 2048,
      storageUsed: 1024,
      screenResolution: '1080x2400',
    });
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.keys(appState.getSnapshot().deviceInfo)).toHaveLength(1);

    clearAllDevices(appState);
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(appState.getDeviceCount()).toBe(0);
    expect(appState.getActiveDeviceId()).toBeNull();
    expect(appState.getSnapshot().deviceInfo).toEqual({});
  });

  it('should remove a non-active device without clearing activeDeviceId', () => {
    const appState = new AppStateManager();

    addDevice(appState, createDevice('device_1', 'serial_1', false));
    addDevice(appState, createDevice('device_2', 'serial_2', true));
    setActiveDevice(appState, 'device_2');

    setDeviceInfo(appState, 'serial_1', createDeviceInfo('serial_1'));
    setDeviceInfo(appState, 'serial_2', createDeviceInfo('serial_2'));

    removeDevice(appState, 'device_1');

    expect(appState.getActiveDeviceId()).toBe('device_2');
    expect(appState.getSnapshot().devices.map((d) => d.deviceId)).toEqual(['device_2']);
    expect(appState.getSnapshot().deviceInfo).toEqual({ serial_2: createDeviceInfo('serial_2') });
  });

  it('should not notify when removing a missing device', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    removeDevice(appState, 'missing');
    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
  });

  it('should remove deviceInfo and only notify when it existed', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    removeDeviceInfo(appState, 'missing');
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();

    setDeviceInfo(appState, 'serial_1', createDeviceInfo('serial_1'));
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);

    removeDeviceInfo(appState, 'serial_1');
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(appState.getSnapshot().deviceInfo).toEqual({});
  });

  it('should clear deviceInfo and only notify when it is not empty', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    clearDeviceInfo(appState);
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();

    setDeviceInfo(appState, 'serial_1', createDeviceInfo('serial_1'));
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);

    clearDeviceInfo(appState);
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(appState.getSnapshot().deviceInfo).toEqual({});

    clearDeviceInfo(appState);
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('should reset state and notify listeners', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    addDevice(appState, createDevice('device_1', 'serial_1', true));
    setActiveDevice(appState, 'device_1');
    setStatusMessage(appState, { type: 'loading', text: 'Loading...', deviceId: 'device_1' });
    setDeviceInfo(appState, 'serial_1', createDeviceInfo('serial_1'));
    setMonitoring(appState, true);
    await flushMicrotasks();

    listener.mockClear();

    resetState(appState);
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = listener.mock.calls[0][0];
    expect(snapshot.devices).toEqual([]);
    expect(snapshot.activeDeviceId).toBeNull();
    expect(snapshot.statusMessage).toBeUndefined();
    expect(snapshot.deviceInfo).toEqual({});
    expect(appState.isMonitoring()).toBe(false);
  });

  it('should allow dispatching actions directly', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    appState.dispatch({
      type: ActionType.SET_STATUS_MESSAGE,
      payload: { type: 'loading', text: 'Dispatched...' },
    });

    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(appState.getStatusMessage()?.text).toBe('Dispatched...');
  });

  it('should remove deviceInfo when device is removed', () => {
    const appState = new AppStateManager();

    addDevice(appState, {
      deviceId: 'device_1',
      serial: 'serial_1',
      name: 'Device 1',
      connectionState: 'connected',
      isActive: true,
    });
    setActiveDevice(appState, 'device_1');

    const info: DeviceDetailedInfo = {
      serial: 'serial_1',
      model: 'Pixel',
      manufacturer: 'Google',
      androidVersion: '14',
      sdkVersion: 34,
      batteryLevel: 50,
      batteryCharging: false,
      storageTotal: 1024,
      storageUsed: 256,
      screenResolution: '1080x2400',
      ipAddress: '192.168.1.100',
    };

    setDeviceInfo(appState, 'serial_1', info);
    expect(appState.getDeviceInfo('serial_1')).toBeDefined();

    removeDevice(appState, 'device_1');

    expect(appState.getDeviceCount()).toBe(0);
    expect(appState.getDeviceInfo('serial_1')).toBeUndefined();
    expect(appState.getSnapshot().deviceInfo).toEqual({});
  });

  it('should clear deviceInfo when clearing all devices', () => {
    const appState = new AppStateManager();

    addDevice(appState, {
      deviceId: 'device_1',
      serial: 'serial_1',
      name: 'Device 1',
      connectionState: 'connected',
      isActive: false,
    });

    addDevice(appState, {
      deviceId: 'device_2',
      serial: 'serial_2',
      name: 'Device 2',
      connectionState: 'connected',
      isActive: true,
    });

    setActiveDevice(appState, 'device_2');

    setDeviceInfo(appState, 'serial_1', {
      serial: 'serial_1',
      model: 'Model 1',
      manufacturer: 'Manufacturer 1',
      androidVersion: '13',
      sdkVersion: 33,
      batteryLevel: 25,
      batteryCharging: false,
      storageTotal: 2048,
      storageUsed: 1024,
      screenResolution: '1080x2400',
    });

    setDeviceInfo(appState, 'serial_2', {
      serial: 'serial_2',
      model: 'Model 2',
      manufacturer: 'Manufacturer 2',
      androidVersion: '14',
      sdkVersion: 34,
      batteryLevel: 75,
      batteryCharging: true,
      storageTotal: 4096,
      storageUsed: 512,
      screenResolution: '1440x3200',
    });

    expect(Object.keys(appState.getSnapshot().deviceInfo)).toHaveLength(2);

    clearAllDevices(appState);

    expect(appState.getDeviceCount()).toBe(0);
    expect(appState.getActiveDeviceId()).toBeNull();
    expect(appState.getSnapshot().deviceInfo).toEqual({});
  });
});
