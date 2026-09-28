import { contextBridge, ipcRenderer } from 'electron';
import type { CompanionApi } from './types';

const api: CompanionApi = {
  isPreview: false,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  saveApiKey: (key) => ipcRenderer.invoke('credential:save', key),
  hasApiKey: () => ipcRenderer.invoke('credential:has'),
  listDisplays: () => ipcRenderer.invoke('display:list'),
  captureSnapshot: (displayId) => ipcRenderer.invoke('screen:capture', displayId),
  ask: (request) => ipcRenderer.invoke('ai:ask', request),
  getStatus: () => ipcRenderer.invoke('status:get'),
  setMonitoring: (enabled) => ipcRenderer.invoke('monitoring:set', enabled),
  openSystemSettings: () => ipcRenderer.invoke('system-settings:open'),
  onStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) => callback(status);
    ipcRenderer.on('status:changed', listener);
    return () => ipcRenderer.removeListener('status:changed', listener);
  },
  onHotkey: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('hotkey:pressed', listener);
    return () => ipcRenderer.removeListener('hotkey:pressed', listener);
  },
  onTip: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, text: string) => callback(text);
    ipcRenderer.on('companion:tip', listener);
    return () => ipcRenderer.removeListener('companion:tip', listener);
  },
  setOverlayMode: (mode) => ipcRenderer.send('overlay:mode', mode),
  armOverlayMove: () => ipcRenderer.send('overlay:move-arm'),
  moveOverlayBy: (dx, dy) => ipcRenderer.send('overlay:move-by', dx, dy),
  finishOverlayMove: () => ipcRenderer.send('overlay:move-finished'),
  onMoveMode: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled);
    ipcRenderer.on('overlay:move-mode', listener);
    return () => ipcRenderer.removeListener('overlay:move-mode', listener);
  },
  quit: () => ipcRenderer.send('app:quit')
};

contextBridge.exposeInMainWorld('companion', api);
