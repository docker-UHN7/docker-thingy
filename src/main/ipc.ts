import { app, BrowserWindow, clipboard, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type { AppSnapshot, OpenSourceResult, ProjectActionResult } from "../shared/contracts";
import type { NetworkActionResult, NetworkTopologyResult } from "../shared/network-contracts";
import { NetworkActionRequestSchema } from "../shared/network-contracts";
import type { RemoteAccessStatus } from "../shared/remote-access-contracts";
import { RemoteAccessEnableRequestSchema, RemoteAccessSetHostRequestSchema } from "../shared/remote-access-contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { ProjectService } from "./project-service";
import { getNetworkTopology } from "./topology-service";
import { runNetworkAction } from "./network-control-service";
import {
  disableRemoteAccess,
  enableRemoteAccess,
  getRemoteAccessStatus,
  regenerateRemoteAccessToken,
  setRemoteAccessHost
} from "./remote-access-service";

function isTrustedSender(mainWindow: BrowserWindow, event: IpcMainInvokeEvent): boolean {
  if (event.sender.id !== mainWindow.webContents.id) {
    return false;
  }

  const senderFrame = event.senderFrame;
  const mainFrame = mainWindow.webContents.mainFrame;

  if (!senderFrame) {
    return true;
  }

  return senderFrame === mainFrame || senderFrame.routingId === mainFrame.routingId;
}

export function registerIpc(mainWindow: BrowserWindow, projectService: ProjectService): void {
  projectService.subscribeSnapshots((snapshot) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.SNAPSHOT_EVENT, snapshot);
    }
  });

  ipcMain.handle(IPC_CHANNELS.GET_SNAPSHOT, async (event): Promise<AppSnapshot> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    return projectService.getSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_SOURCE, async (event): Promise<OpenSourceResult> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    return projectService.openSource();
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_SOURCE_PATH, async (event, sourcePath: string): Promise<OpenSourceResult> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    return projectService.openSourcePath(sourcePath);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_RECENT_SOURCE, async (event, sourcePath: string): Promise<OpenSourceResult> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    return projectService.openRecentSource(sourcePath);
  });

  ipcMain.handle(IPC_CHANNELS.GET_SERVICE_LOGS, async (event, containerId: string, tail: number) => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    return projectService.getServiceLogs(containerId, tail);
  });

  ipcMain.handle(IPC_CHANNELS.GET_SERVICE_STATS, async (event, containerId: string) => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    return projectService.getServiceStats(containerId);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, async (event, settings) => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    return projectService.updateSettings(settings);
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_RECENTS, async (event) => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    return projectService.clearRecents();
  });

  ipcMain.handle(
    IPC_CHANNELS.UPDATE_PROJECT_CONFIG_FILES,
    async (event, projectId: unknown, configFiles: unknown): Promise<AppSnapshot> => {
      if (!isTrustedSender(mainWindow, event)) {
        throw new Error("Untrusted sender");
      }

      if (typeof projectId !== "string" || !Array.isArray(configFiles) || !configFiles.every((f) => typeof f === "string")) {
        throw new Error("Invalid project config files request.");
      }

      return projectService.updateProjectConfigFiles(projectId, configFiles);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.RUN_PROJECT_ACTION,
    async (event, projectId: unknown, actionId: unknown): Promise<ProjectActionResult> => {
      if (!isTrustedSender(mainWindow, event)) {
        throw new Error("Untrusted sender");
      }

      // The renderer sends only a project id + action name here - main
      // resolves cwd/config paths/commands entirely from its own snapshot,
      // never from anything the renderer supplies directly.
      if (typeof projectId !== "string" || typeof actionId !== "string") {
        return {
          ok: false,
          error: { code: "VALIDATION_FAILED", message: "Invalid project action request." }
        };
      }

      return projectService.runProjectAction(projectId, actionId, (operationEvent) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.BUILD_EVENT, operationEvent);
        }
      });
    }
  );

  ipcMain.handle(IPC_CHANNELS.NETWORK_GET_TOPOLOGY, async (event): Promise<NetworkTopologyResult> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    try {
      return { ok: true, data: await getNetworkTopology() };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "PROCESS_FAILED",
          message: error instanceof Error ? error.message : "Failed to load network topology."
        }
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.NETWORK_RUN_ACTION, async (event, request: unknown): Promise<NetworkActionResult> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    // Re-validate the shape here rather than trusting the renderer's typing -
    // the same posture RUN_PROJECT_ACTION already takes on projectId/actionId.
    const parsed = NetworkActionRequestSchema.safeParse(request);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "Invalid network action request." }
      };
    }

    return runNetworkAction(parsed.data);
  });

  // Deliberately no equivalent handlers exist on the remote-access HTTP
  // server (see remote-access-service.ts) - these four stay local-only so a
  // leaked token can never be used to re-enable/reconfigure/re-read its own
  // exposure.
  ipcMain.handle(IPC_CHANNELS.REMOTE_ACCESS_GET_STATUS, async (event): Promise<RemoteAccessStatus> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    return getRemoteAccessStatus();
  });

  ipcMain.handle(IPC_CHANNELS.REMOTE_ACCESS_ENABLE, async (event, port: unknown, host: unknown): Promise<RemoteAccessStatus> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    const parsed = RemoteAccessEnableRequestSchema.safeParse({ port, host: host === "" ? undefined : host });
    if (!parsed.success) {
      throw new Error("Invalid port number or host.");
    }

    return enableRemoteAccess(parsed.data.port, projectService, parsed.data.host, app.getPath("userData"));
  });

  ipcMain.handle(IPC_CHANNELS.REMOTE_ACCESS_DISABLE, async (event): Promise<RemoteAccessStatus> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    return disableRemoteAccess();
  });

  ipcMain.handle(IPC_CHANNELS.REMOTE_ACCESS_REGENERATE_TOKEN, async (event): Promise<RemoteAccessStatus> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    return regenerateRemoteAccessToken();
  });

  ipcMain.handle(IPC_CHANNELS.REMOTE_ACCESS_SET_HOST, async (event, host: unknown): Promise<RemoteAccessStatus> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    const parsed = RemoteAccessSetHostRequestSchema.safeParse({ host });
    if (!parsed.success) {
      throw new Error("Invalid host.");
    }

    return setRemoteAccessHost(parsed.data.host);
  });

  // Electron's `clipboard` module isn't reachable from a sandboxed preload
  // script (see webPreferences.sandbox: true in main.ts) - it has to be
  // called here in the main process instead.
  ipcMain.handle(IPC_CHANNELS.COPY_TO_CLIPBOARD, async (event, text: unknown): Promise<void> => {
    if (!isTrustedSender(mainWindow, event)) {
      throw new Error("Untrusted sender");
    }

    if (typeof text !== "string") {
      throw new Error("Invalid clipboard text.");
    }

    clipboard.writeText(text);
  });
}


