import { contextBridge, ipcRenderer } from "electron";
import type { PreloadApi } from "./shared/contracts";
import { IPC_CHANNELS } from "./shared/ipc-channels";

const api: PreloadApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SNAPSHOT),
  refreshRuntime: () => ipcRenderer.invoke(IPC_CHANNELS.REFRESH_RUNTIME),
  openSource: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SOURCE),
  openSourcePath: (sourcePath) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SOURCE_PATH, sourcePath),
  openRecentSource: (sourcePath) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_RECENT_SOURCE, sourcePath),
  getServiceLogs: (containerId, tail) => ipcRenderer.invoke(IPC_CHANNELS.GET_SERVICE_LOGS, containerId, tail),
  updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings),
  clearRecents: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_RECENTS),
  subscribeBuildEvents: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: string) => listener(payload);
    ipcRenderer.on(IPC_CHANNELS.BUILD_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BUILD_EVENT, handler);
  }
};

contextBridge.exposeInMainWorld("dockerExplorer", api);

declare global {
  interface Window {
    dockerExplorer: PreloadApi;
  }
}
