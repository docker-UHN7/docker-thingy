import { contextBridge, ipcRenderer } from "electron";
import type { AppSnapshot, OperationEvent, PreloadApi } from "./shared/contracts";
import { IPC_CHANNELS } from "./shared/ipc-channels";

const api: PreloadApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SNAPSHOT),
  openSource: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SOURCE),
  openSourcePath: (sourcePath) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SOURCE_PATH, sourcePath),
  openRecentSource: (sourcePath) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_RECENT_SOURCE, sourcePath),
  getServiceLogs: (containerId, tail) => ipcRenderer.invoke(IPC_CHANNELS.GET_SERVICE_LOGS, containerId, tail),
  getServiceStats: (containerId) => ipcRenderer.invoke(IPC_CHANNELS.GET_SERVICE_STATS, containerId),
  updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings),
  clearRecents: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_RECENTS),
  runProjectAction: (projectId, actionId) => ipcRenderer.invoke(IPC_CHANNELS.RUN_PROJECT_ACTION, projectId, actionId),
  subscribeBuildEvents: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: OperationEvent) => {
      try {
        listener(payload);
      } catch (error) {
        console.error("[preload] build event listener failed", {
          payload,
          error
        });
        throw error;
      }
    };
    ipcRenderer.on(IPC_CHANNELS.BUILD_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.BUILD_EVENT, handler);
  },
  subscribeSnapshotEvents: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AppSnapshot) => {
      try {
        listener(payload);
      } catch (error) {
        console.error("[preload] snapshot event listener failed", {
          payload,
          error
        });
        throw error;
      }
    };
    ipcRenderer.on(IPC_CHANNELS.SNAPSHOT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SNAPSHOT_EVENT, handler);
  }
};

contextBridge.exposeInMainWorld("dockerExplorer", api);

declare global {
  interface Window {
    dockerExplorer: PreloadApi;
  }
}
