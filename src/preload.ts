import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AppSnapshot,
  ExecExitEvent,
  ExecOutputEvent,
  OperationEvent,
  PreloadApi,
  PullProgressEvent
} from "./shared/contracts";
import type { NetworkPreloadApi } from "./shared/network-contracts";
import type { RemoteAccessPreloadApi } from "./shared/remote-access-contracts";
import { IPC_CHANNELS } from "./shared/ipc-channels";

const api: PreloadApi & NetworkPreloadApi & RemoteAccessPreloadApi = {
  // Electron's `clipboard` module isn't part of the sandboxed preload
  // allowlist (contextBridge, crashReporter, ipcRenderer, nativeImage,
  // webFrame, webUtils only) - has to go through the main process instead.
  copyToClipboard: (text) => ipcRenderer.invoke(IPC_CHANNELS.COPY_TO_CLIPBOARD, text),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SNAPSHOT),
  openSource: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SOURCE),
  createProject: () => ipcRenderer.invoke(IPC_CHANNELS.CREATE_PROJECT),
  openSourcePath: (sourcePath) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SOURCE_PATH, sourcePath),
  openRecentSource: (sourcePath) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_RECENT_SOURCE, sourcePath),
  touchRecentProject: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.TOUCH_RECENT_PROJECT, projectId),
  openExternalUrl: (url) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL_URL, url),
  getServiceLogs: (containerId, tail) => ipcRenderer.invoke(IPC_CHANNELS.GET_SERVICE_LOGS, containerId, tail),
  getServiceStats: (containerId) => ipcRenderer.invoke(IPC_CHANNELS.GET_SERVICE_STATS, containerId),
  updateSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings),
  clearRecents: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_RECENTS),
  updateProjectConfigFiles: (projectId, configFiles) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_PROJECT_CONFIG_FILES, projectId, configFiles),
  readSourceFile: (projectId, filePath) => ipcRenderer.invoke(IPC_CHANNELS.READ_SOURCE_FILE, projectId, filePath),
  saveSourceFile: (projectId, filePath, sourceText, expectedHash) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_SOURCE_FILE, projectId, filePath, sourceText, expectedHash),
  searchDockerHub: (query) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_DOCKER_HUB, query),
  addServiceToProject: (projectId, input) => ipcRenderer.invoke(IPC_CHANNELS.ADD_SERVICE_TO_PROJECT, projectId, input),
  removeServiceFromProject: (projectId, serviceName) =>
    ipcRenderer.invoke(IPC_CHANNELS.REMOVE_SERVICE_FROM_PROJECT, projectId, serviceName),
  getServiceFields: (projectId, serviceName) => ipcRenderer.invoke(IPC_CHANNELS.GET_SERVICE_FIELDS, projectId, serviceName),
  updateServiceFields: (projectId, serviceName, fields) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SERVICE_FIELDS, projectId, serviceName, fields),
  disconnectDependency: (projectId, fromService, toService) =>
    ipcRenderer.invoke(IPC_CHANNELS.DISCONNECT_DEPENDENCY, projectId, fromService, toService),
  disconnectVolumeMount: (projectId, serviceName, volumeName) =>
    ipcRenderer.invoke(IPC_CHANNELS.DISCONNECT_VOLUME_MOUNT, projectId, serviceName, volumeName),
  pullImage: (image) => ipcRenderer.invoke(IPC_CHANNELS.PULL_IMAGE, image),
  runProjectAction: (projectId, actionId) => ipcRenderer.invoke(IPC_CHANNELS.RUN_PROJECT_ACTION, projectId, actionId),
  cancelProjectAction: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_PROJECT_ACTION, projectId),
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
  },
  subscribePullProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PullProgressEvent) => {
      try {
        listener(payload);
      } catch (error) {
        console.error("[preload] pull progress listener failed", {
          payload,
          error
        });
        throw error;
      }
    };
    ipcRenderer.on(IPC_CHANNELS.PULL_PROGRESS_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PULL_PROGRESS_EVENT, handler);
  },
  startContainerExec: (containerId) => ipcRenderer.invoke(IPC_CHANNELS.EXEC_START, containerId),
  writeContainerExec: (sessionId, data) => ipcRenderer.invoke(IPC_CHANNELS.EXEC_WRITE, sessionId, data),
  stopContainerExec: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.EXEC_STOP, sessionId),
  subscribeExecOutput: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ExecOutputEvent) => listener(payload);
    ipcRenderer.on(IPC_CHANNELS.EXEC_OUTPUT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXEC_OUTPUT_EVENT, handler);
  },
  subscribeExecExit: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ExecExitEvent) => listener(payload);
    ipcRenderer.on(IPC_CHANNELS.EXEC_EXIT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXEC_EXIT_EVENT, handler);
  },
  getConfigDrift: (projectId) => ipcRenderer.invoke(IPC_CHANNELS.GET_CONFIG_DRIFT, projectId),
  checkImageUpdate: (image) => ipcRenderer.invoke(IPC_CHANNELS.CHECK_IMAGE_UPDATE, image),
  backupVolume: (volumeName) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_VOLUME, volumeName),
  restoreVolume: (volumeName) => ipcRenderer.invoke(IPC_CHANNELS.RESTORE_VOLUME, volumeName),
  getNetworkTopology: () => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_GET_TOPOLOGY),
  runNetworkAction: (request) => ipcRenderer.invoke(IPC_CHANNELS.NETWORK_RUN_ACTION, request),
  getRemoteAccessStatus: () => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_ACCESS_GET_STATUS),
  enableRemoteAccess: (port, host) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_ACCESS_ENABLE, port, host),
  disableRemoteAccess: () => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_ACCESS_DISABLE),
  regenerateRemoteAccessToken: () => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_ACCESS_REGENERATE_TOKEN),
  setRemoteAccessHost: (host) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_ACCESS_SET_HOST, host),
  windowControls: {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
    subscribeMaximizeChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized);
      ipcRenderer.on(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGED_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGED_EVENT, handler);
    }
  }
};

contextBridge.exposeInMainWorld("dockerExplorer", api);

declare global {
  interface Window {
    dockerExplorer: PreloadApi & NetworkPreloadApi & RemoteAccessPreloadApi;
  }
}
