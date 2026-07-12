import path from "node:path";
import { existsSync } from "node:fs";
import { app, BrowserWindow, session } from "electron";
import { ProjectService } from "./main/project-service";
import { registerIpc } from "./main/ipc";
import { disableRemoteAccess } from "./main/remote-access-service";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require("electron-squirrel-startup")) {
  app.quit();
}

function resolveWindowIcon(): string | undefined {
  if (process.platform === "darwin") {
    return undefined;
  }

  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "icons", "icon-512.png")
    : path.join(app.getAppPath(), "resources", "icons", "icon-512.png");
  return existsSync(candidate) ? candidate : undefined;
}

function createMainWindow(): BrowserWindow {
  const windowIcon = resolveWindowIcon();
  const mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#0B1220",
    ...(windowIcon ? { icon: windowIcon } : {}),
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const ses = mainWindow.webContents.session;
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  ses.setPermissionCheckHandler(() => false);

  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: "deny"
  }));

  const startUrl = MAIN_WINDOW_WEBPACK_ENTRY;
  const allowedOrigin = startUrl.startsWith("http") ? new URL(startUrl).origin : undefined;

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!allowedOrigin || new URL(url).origin !== allowedOrigin) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer] process gone:", details.reason);
  });

  if (!app.isPackaged) {
    mainWindow.webContents.on("console-message", (_event, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  void mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  return mainWindow;
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  const mainWindow = createMainWindow();
  const projectService = new ProjectService();
  registerIpc(mainWindow, projectService);
  projectService.startAutoSync();
  try {
    await projectService.synchronizeSnapshot();
  } catch {
    // Keep the shell running even if Docker is unavailable during startup.
  }

  app.on("before-quit", () => {
    disableRemoteAccess();
    projectService.dispose();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
