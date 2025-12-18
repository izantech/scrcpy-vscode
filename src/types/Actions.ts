import {
  DeviceDetailedInfo,
  DeviceState,
  DeviceUISettings,
  StatusMessage,
  ToolStatus,
  WebviewSettings,
} from './AppState';

export enum ActionType {
  ADD_DEVICE = 'ADD_DEVICE',
  REMOVE_DEVICE = 'REMOVE_DEVICE',
  UPDATE_DEVICE = 'UPDATE_DEVICE',
  SET_ACTIVE_DEVICE = 'SET_ACTIVE_DEVICE',
  UPDATE_SETTINGS = 'UPDATE_SETTINGS',
  UPDATE_TOOL_STATUS = 'UPDATE_TOOL_STATUS',
  SET_STATUS_MESSAGE = 'SET_STATUS_MESSAGE',
  SET_DEVICE_INFO = 'SET_DEVICE_INFO',
  REMOVE_DEVICE_INFO = 'REMOVE_DEVICE_INFO',
  CLEAR_DEVICE_INFO = 'CLEAR_DEVICE_INFO',
  SET_MONITORING = 'SET_MONITORING',
  CLEAR_ALL_DEVICES = 'CLEAR_ALL_DEVICES',
  RESET = 'RESET',
  SET_ALLOWED_AUTO_CONNECT = 'SET_ALLOWED_AUTO_CONNECT',
  ADD_ALLOWED_AUTO_CONNECT = 'ADD_ALLOWED_AUTO_CONNECT',
  REMOVE_ALLOWED_AUTO_CONNECT = 'REMOVE_ALLOWED_AUTO_CONNECT',
  SET_CONTROL_CENTER_CACHE = 'SET_CONTROL_CENTER_CACHE',
  SAVE_CONTROL_CENTER_TO_CACHE = 'SAVE_CONTROL_CENTER_TO_CACHE',
  UPDATE_DEVICE_SETTING_IN_CACHE = 'UPDATE_DEVICE_SETTING_IN_CACHE',
  ADD_BLOCKED_AUTO_CONNECT = 'ADD_BLOCKED_AUTO_CONNECT',
  REMOVE_BLOCKED_AUTO_CONNECT = 'REMOVE_BLOCKED_AUTO_CONNECT',
}

export interface AddDeviceAction {
  type: ActionType.ADD_DEVICE;
  payload: DeviceState;
}

export interface RemoveDeviceAction {
  type: ActionType.REMOVE_DEVICE;
  payload: { deviceId: string };
}

export interface UpdateDeviceAction {
  type: ActionType.UPDATE_DEVICE;
  payload: { deviceId: string; updates: Partial<DeviceState> };
}

export interface SetActiveDeviceAction {
  type: ActionType.SET_ACTIVE_DEVICE;
  payload: { deviceId: string | null };
}

export interface UpdateSettingsAction {
  type: ActionType.UPDATE_SETTINGS;
  payload: Partial<WebviewSettings>;
}

export interface UpdateToolStatusAction {
  type: ActionType.UPDATE_TOOL_STATUS;
  payload: ToolStatus;
}

export interface SetStatusMessageAction {
  type: ActionType.SET_STATUS_MESSAGE;
  payload: StatusMessage | undefined;
}

export interface SetDeviceInfoAction {
  type: ActionType.SET_DEVICE_INFO;
  payload: { serial: string; info: DeviceDetailedInfo };
}

export interface RemoveDeviceInfoAction {
  type: ActionType.REMOVE_DEVICE_INFO;
  payload: { serial: string };
}

export interface ClearDeviceInfoAction {
  type: ActionType.CLEAR_DEVICE_INFO;
}

export interface SetMonitoringAction {
  type: ActionType.SET_MONITORING;
  payload: { isMonitoring: boolean };
}

export interface ClearAllDevicesAction {
  type: ActionType.CLEAR_ALL_DEVICES;
}

export interface ResetAction {
  type: ActionType.RESET;
}

export interface SetAllowedAutoConnectAction {
  type: ActionType.SET_ALLOWED_AUTO_CONNECT;
  payload: { serials: string[] };
}

export interface AddAllowedAutoConnectAction {
  type: ActionType.ADD_ALLOWED_AUTO_CONNECT;
  payload: { serial: string };
}

export interface RemoveAllowedAutoConnectAction {
  type: ActionType.REMOVE_ALLOWED_AUTO_CONNECT;
  payload: { serial: string };
}

export interface SetControlCenterCacheAction {
  type: ActionType.SET_CONTROL_CENTER_CACHE;
  payload: { cache: Record<string, DeviceUISettings> };
}

export interface SaveControlCenterToCacheAction {
  type: ActionType.SAVE_CONTROL_CENTER_TO_CACHE;
  payload: { deviceId: string; settings: DeviceUISettings };
}

export interface UpdateDeviceSettingInCacheAction {
  type: ActionType.UPDATE_DEVICE_SETTING_IN_CACHE;
  payload: {
    deviceId: string;
    setting: keyof DeviceUISettings;
    value: DeviceUISettings[keyof DeviceUISettings];
  };
}

export interface AddBlockedAutoConnectAction {
  type: ActionType.ADD_BLOCKED_AUTO_CONNECT;
  payload: { serial: string };
}

export interface RemoveBlockedAutoConnectAction {
  type: ActionType.REMOVE_BLOCKED_AUTO_CONNECT;
  payload: { serial: string };
}

export type AppAction =
  | AddDeviceAction
  | RemoveDeviceAction
  | UpdateDeviceAction
  | SetActiveDeviceAction
  | UpdateSettingsAction
  | UpdateToolStatusAction
  | SetStatusMessageAction
  | SetDeviceInfoAction
  | RemoveDeviceInfoAction
  | ClearDeviceInfoAction
  | SetMonitoringAction
  | ClearAllDevicesAction
  | ResetAction
  | SetAllowedAutoConnectAction
  | AddAllowedAutoConnectAction
  | RemoveAllowedAutoConnectAction
  | SetControlCenterCacheAction
  | SaveControlCenterToCacheAction
  | UpdateDeviceSettingInCacheAction
  | AddBlockedAutoConnectAction
  | RemoveBlockedAutoConnectAction;
