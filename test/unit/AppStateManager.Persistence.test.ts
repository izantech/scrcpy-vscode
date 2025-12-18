import { describe, it, expect, vi } from 'vitest';
import { AppStateManager } from '../../src/AppStateManager';
import { ActionType } from '../../src/types/Actions';
import * as vscode from 'vscode';

// Mock vscode module
vi.mock('vscode', () => import('../mocks/vscode'));

describe('AppStateManager Persistence', () => {
  it('should load allowed and blocked devices from storage on initialization', () => {
    const mockStorage = {
      get: vi.fn().mockReturnValueOnce(['serial_1', 'serial_2']).mockReturnValueOnce(['blocked_1']),
      update: vi.fn(),
    } as unknown as vscode.Memento;

    const appState = new AppStateManager(mockStorage);

    expect(mockStorage.get).toHaveBeenCalledWith('scrcpy.allowedAutoConnectDevices', []);
    expect(mockStorage.get).toHaveBeenCalledWith('scrcpy.blockedAutoConnectDevices', []);
    expect(appState.isAllowedAutoConnectDevice('serial_1')).toBe(true);
    expect(appState.isAllowedAutoConnectDevice('serial_2')).toBe(true);
    expect(appState.isAllowedAutoConnectDevice('serial_3')).toBe(false);
    expect(appState.isBlockedAutoConnectDevice('blocked_1')).toBe(true);
    expect(appState.isBlockedAutoConnectDevice('serial_1')).toBe(false);
  });

  it('should initialize with empty set if storage returns nothing', () => {
    const mockStorage = {
      get: vi.fn().mockReturnValue(undefined),
      update: vi.fn(),
    } as unknown as vscode.Memento;

    const appState = new AppStateManager(mockStorage);

    expect(mockStorage.get).toHaveBeenCalledWith('scrcpy.allowedAutoConnectDevices', []);
    expect(appState.isAllowedAutoConnectDevice('serial_1')).toBe(false);
    expect(appState.isAllowedAutoConnectDevice('serial_2')).toBe(false);
    expect(appState.isBlockedAutoConnectDevice('serial_1')).toBe(false);
  });

  it('should update storage when allowed devices are set', () => {
    const mockStorage = {
      get: vi.fn().mockReturnValue([]),
      update: vi.fn(),
    } as unknown as vscode.Memento;

    const appState = new AppStateManager(mockStorage);
    appState.dispatch({
      type: ActionType.SET_ALLOWED_AUTO_CONNECT,
      payload: { serials: ['serial_1'] },
    });

    expect(mockStorage.update).toHaveBeenCalledWith('scrcpy.allowedAutoConnectDevices', [
      'serial_1',
    ]);
  });

  it('should update storage when allowed device is added', () => {
    const mockStorage = {
      get: vi.fn().mockReturnValue([]),
      update: vi.fn(),
    } as unknown as vscode.Memento;

    const appState = new AppStateManager(mockStorage);
    appState.dispatch({
      type: ActionType.ADD_ALLOWED_AUTO_CONNECT,
      payload: { serial: 'serial_1' },
    });

    expect(mockStorage.update).toHaveBeenCalledWith('scrcpy.allowedAutoConnectDevices', [
      'serial_1',
    ]);
  });

  it('should update storage when allowed device is removed', () => {
    const mockStorage = {
      get: vi.fn().mockReturnValue(['serial_1']),
      update: vi.fn(),
    } as unknown as vscode.Memento;

    const appState = new AppStateManager(mockStorage);
    appState.dispatch({
      type: ActionType.REMOVE_ALLOWED_AUTO_CONNECT,
      payload: { serial: 'serial_1' },
    });

    expect(mockStorage.update).toHaveBeenCalledWith('scrcpy.allowedAutoConnectDevices', []);
  });

  it('should not update storage if adding existing device', () => {
    const mockStorage = {
      get: vi.fn().mockReturnValue(['serial_1']),
      update: vi.fn(),
    } as unknown as vscode.Memento;

    const appState = new AppStateManager(mockStorage);
    vi.mocked(mockStorage.update).mockClear();

    appState.dispatch({
      type: ActionType.ADD_ALLOWED_AUTO_CONNECT,
      payload: { serial: 'serial_1' },
    });

    expect(mockStorage.update).not.toHaveBeenCalled();
  });

  it('should not update storage if removing non-existent device', () => {
    const mockStorage = {
      get: vi.fn().mockReturnValue([]),
      update: vi.fn(),
    } as unknown as vscode.Memento;

    const appState = new AppStateManager(mockStorage);
    vi.mocked(mockStorage.update).mockClear();

    appState.dispatch({
      type: ActionType.REMOVE_ALLOWED_AUTO_CONNECT,
      payload: { serial: 'serial_1' },
    });

    expect(mockStorage.update).not.toHaveBeenCalled();
  });

  it('should persist blocked devices', () => {
    const mockStorage = {
      get: vi.fn().mockReturnValue([]),
      update: vi.fn(),
    } as unknown as vscode.Memento;

    const appState = new AppStateManager(mockStorage);

    appState.dispatch({
      type: ActionType.ADD_BLOCKED_AUTO_CONNECT,
      payload: { serial: 'serial_blocked' },
    });

    expect(mockStorage.update).toHaveBeenCalledWith('scrcpy.blockedAutoConnectDevices', [
      'serial_blocked',
    ]);

    appState.dispatch({
      type: ActionType.REMOVE_BLOCKED_AUTO_CONNECT,
      payload: { serial: 'serial_blocked' },
    });

    expect(mockStorage.update).toHaveBeenCalledWith('scrcpy.blockedAutoConnectDevices', []);
  });
});
