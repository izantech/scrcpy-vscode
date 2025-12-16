import { describe, it, expect, vi } from 'vitest';
import { AppStateManager } from '../../src/AppStateManager';
import { DeviceDetailedInfo, DeviceState } from '../../src/types/AppState';

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

    appState.addDevice(createDevice('device_1', 'serial_1', true));
    appState.updateSettings({ showStats: true });
    appState.updateToolStatus({ adbAvailable: false, scrcpyAvailable: true });
    appState.setStatusMessage({ type: 'loading', text: 'Connecting...', deviceId: 'device_1' });

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
    appState.updateSettings({ showStats: true });
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    appState.updateSettings({ showStats: false });
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

    appState.updateSettings({ showStats: true });
    await flushMicrotasks();

    expect(badListener).toHaveBeenCalledTimes(1);
    expect(goodListener).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('Error in state listener:', expect.any(Error));
  });

  it('should clone snapshot fields that are meant to be immutable to consumers', () => {
    const appState = new AppStateManager();

    appState.updateSettings({ showStats: true });
    appState.updateToolStatus({ adbAvailable: false, scrcpyAvailable: true });
    appState.setStatusMessage({ type: 'loading', text: 'Hello' });

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

    appState.addDevice(device);
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
    appState.updateDevice('missing', { name: 'Nope' });
    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
  });

  it('should update device fields and preserve videoCodec when codec not provided', () => {
    const appState = new AppStateManager();
    appState.addDevice(createDevice('device_1', 'serial_1'));

    const updates = { name: 'Updated name' };
    appState.updateDevice('device_1', updates);
    updates.name = 'Mutated updates';

    expect(appState.getDevice('device_1')?.name).toBe('Updated name');

    appState.updateDeviceConnectionState('device_1', 'connecting');
    expect(appState.getDevice('device_1')?.connectionState).toBe('connecting');

    appState.updateDeviceVideoDimensions('device_1', 100, 200, 'h265');
    expect(appState.getDevice('device_1')?.videoDimensions).toEqual({ width: 100, height: 200 });
    expect(appState.getDevice('device_1')?.videoCodec).toBe('h265');

    appState.updateDeviceVideoDimensions('device_1', 120, 220);
    expect(appState.getDevice('device_1')?.videoDimensions).toEqual({ width: 120, height: 220 });
    expect(appState.getDevice('device_1')?.videoCodec).toBe('h265');
  });

  it('should maintain a single active device and avoid redundant notifications', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    appState.addDevice(createDevice('device_1', 'serial_1', true));
    appState.addDevice(createDevice('device_2', 'serial_2', true));
    appState.setActiveDevice('device_2');

    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);

    const snapshot = listener.mock.calls[0][0];
    expect(snapshot.activeDeviceId).toBe('device_2');
    expect(snapshot.devices.filter((d) => d.isActive).map((d) => d.deviceId)).toEqual(['device_2']);

    // Setting the same active device should not trigger another notification
    appState.setActiveDevice('device_2');
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);

    expect(appState.getActiveDeviceId()).toBe('device_2');
    expect(appState.getActiveDevice()?.deviceId).toBe('device_2');
  });

  it('should update and protect settings/toolStatus getters from external mutation', () => {
    const appState = new AppStateManager();

    appState.updateSettings({ showStats: true });
    const settings = appState.getSettings();
    settings.showStats = false;
    expect(appState.getSettings().showStats).toBe(true);

    appState.updateToolStatus({ adbAvailable: false, scrcpyAvailable: false });
    const toolStatus = appState.getToolStatus();
    toolStatus.adbAvailable = true;
    expect(appState.getToolStatus().adbAvailable).toBe(false);
  });

  it('should set/clear status message and only notify when it changes', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    appState.clearStatusMessage();
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();

    appState.setStatusMessage({ type: 'loading', text: 'Loading...' });
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(appState.getStatusMessage()?.text).toBe('Loading...');

    appState.clearStatusMessage();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(appState.getStatusMessage()).toBeUndefined();

    appState.clearStatusMessage();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('should allow clearing status message via setStatusMessage(undefined)', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    appState.setStatusMessage({ type: 'loading', text: 'Loading...' });
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);

    appState.setStatusMessage(undefined);
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(appState.getSnapshot().statusMessage).toBeUndefined();
  });

  it('should not notify when toggling monitoring state (internal-only)', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    expect(appState.isMonitoring()).toBe(false);
    appState.setMonitoring(false);
    await flushMicrotasks();
    expect(appState.isMonitoring()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    appState.setMonitoring(true);
    await flushMicrotasks();

    expect(appState.isMonitoring()).toBe(true);
    expect(listener).not.toHaveBeenCalled();

    appState.setMonitoring(false);
    await flushMicrotasks();

    expect(appState.isMonitoring()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('should clear all devices (and deviceInfo) and avoid notifying when already empty', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    appState.clearAllDevices();
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();

    appState.setDeviceInfo('serial_1', {
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

    appState.clearAllDevices();
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(appState.getDeviceCount()).toBe(0);
    expect(appState.getActiveDeviceId()).toBeNull();
    expect(appState.getSnapshot().deviceInfo).toEqual({});
  });

  it('should remove a non-active device without clearing activeDeviceId', () => {
    const appState = new AppStateManager();

    appState.addDevice(createDevice('device_1', 'serial_1', false));
    appState.addDevice(createDevice('device_2', 'serial_2', true));
    appState.setActiveDevice('device_2');

    appState.setDeviceInfo('serial_1', createDeviceInfo('serial_1'));
    appState.setDeviceInfo('serial_2', createDeviceInfo('serial_2'));

    appState.removeDevice('device_1');

    expect(appState.getActiveDeviceId()).toBe('device_2');
    expect(appState.getSnapshot().devices.map((d) => d.deviceId)).toEqual(['device_2']);
    expect(appState.getSnapshot().deviceInfo).toEqual({ serial_2: createDeviceInfo('serial_2') });
  });

  it('should not notify when removing a missing device', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    appState.removeDevice('missing');
    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
  });

  it('should remove deviceInfo and only notify when it existed', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    appState.removeDeviceInfo('missing');
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();

    appState.setDeviceInfo('serial_1', createDeviceInfo('serial_1'));
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);

    appState.removeDeviceInfo('serial_1');
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(appState.getSnapshot().deviceInfo).toEqual({});
  });

  it('should clear deviceInfo and only notify when it is not empty', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    appState.clearDeviceInfo();
    await flushMicrotasks();
    expect(listener).not.toHaveBeenCalled();

    appState.setDeviceInfo('serial_1', createDeviceInfo('serial_1'));
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(1);

    appState.clearDeviceInfo();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(appState.getSnapshot().deviceInfo).toEqual({});

    appState.clearDeviceInfo();
    await flushMicrotasks();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('should reset state and notify listeners', async () => {
    const appState = new AppStateManager();
    const listener = vi.fn();
    appState.subscribe(listener);

    appState.addDevice(createDevice('device_1', 'serial_1', true));
    appState.setActiveDevice('device_1');
    appState.setStatusMessage({ type: 'loading', text: 'Loading...', deviceId: 'device_1' });
    appState.setDeviceInfo('serial_1', createDeviceInfo('serial_1'));
    appState.setMonitoring(true);
    await flushMicrotasks();

    listener.mockClear();

    appState.reset();
    await flushMicrotasks();

    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = listener.mock.calls[0][0];
    expect(snapshot.devices).toEqual([]);
    expect(snapshot.activeDeviceId).toBeNull();
    expect(snapshot.statusMessage).toBeUndefined();
    expect(snapshot.deviceInfo).toEqual({});
    expect(appState.isMonitoring()).toBe(false);
  });

  it('should expose raw state for internal use', () => {
    const appState = new AppStateManager();
    const raw = appState.getRawState();
    expect(raw.devices).toBeInstanceOf(Map);
    expect(raw.deviceInfo).toBeInstanceOf(Map);
    expect(raw.activeDeviceId).toBeNull();
  });

  it('should remove deviceInfo when device is removed', () => {
    const appState = new AppStateManager();

    appState.addDevice({
      deviceId: 'device_1',
      serial: 'serial_1',
      name: 'Device 1',
      connectionState: 'connected',
      isActive: true,
    });
    appState.setActiveDevice('device_1');

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

    appState.setDeviceInfo('serial_1', info);
    expect(appState.getDeviceInfo('serial_1')).toBeDefined();

    appState.removeDevice('device_1');

    expect(appState.getDeviceCount()).toBe(0);
    expect(appState.getDeviceInfo('serial_1')).toBeUndefined();
    expect(appState.getSnapshot().deviceInfo).toEqual({});
  });

  it('should clear deviceInfo when clearing all devices', () => {
    const appState = new AppStateManager();

    appState.addDevice({
      deviceId: 'device_1',
      serial: 'serial_1',
      name: 'Device 1',
      connectionState: 'connected',
      isActive: false,
    });

    appState.addDevice({
      deviceId: 'device_2',
      serial: 'serial_2',
      name: 'Device 2',
      connectionState: 'connected',
      isActive: true,
    });

    appState.setActiveDevice('device_2');

    appState.setDeviceInfo('serial_1', {
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

    appState.setDeviceInfo('serial_2', {
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

    appState.clearAllDevices();

    expect(appState.getDeviceCount()).toBe(0);
    expect(appState.getActiveDeviceId()).toBeNull();
    expect(appState.getSnapshot().deviceInfo).toEqual({});
  });
});
