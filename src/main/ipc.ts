import { BrowserWindow, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type {
  AppSnapshot,
  OpenSourceResult,
  ProjectActionResult,
  ReadSourceFileResult,
  SaveSourceFileResult
} from "../shared/contracts";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import { ProjectService } from "./project-service";

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
    IPC_CHANNELS.READ_SOURCE_FILE,
    async (event, projectId: unknown, filePath: unknown): Promise<ReadSourceFileResult> => {
      if (!isTrustedSender(mainWindow, event)) {
        throw new Error("Untrusted sender");
      }

      if (typeof projectId !== "string" || typeof filePath !== "string") {
        return { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid read file request." } };
      }

      return projectService.readComposeFile(projectId, filePath);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.SAVE_SOURCE_FILE,
    async (
      event,
      projectId: unknown,
      filePath: unknown,
      sourceText: unknown,
      expectedHash: unknown
    ): Promise<SaveSourceFileResult> => {
      if (!isTrustedSender(mainWindow, event)) {
        throw new Error("Untrusted sender");
      }

      if (
        typeof projectId !== "string" ||
        typeof filePath !== "string" ||
        typeof sourceText !== "string" ||
        typeof expectedHash !== "string"
      ) {
        return { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid save file request." } };
      }

      return projectService.saveComposeFile(projectId, filePath, sourceText, expectedHash);
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
}


