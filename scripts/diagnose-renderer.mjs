import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, "..");

app.whenReady().then(async () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(projectRoot, ".webpack", "renderer", "main_window", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.on("console-message", (_event, _level, message) => {
    console.log(`[renderer] ${message}`);
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.log(`[fail-load] ${code} ${description} ${url}`);
  });

  mainWindow.webContents.on("did-finish-load", async () => {
    try {
      const result = await mainWindow.webContents.executeJavaScript(`
        ({
          rootHtml: document.getElementById("root")?.innerHTML ?? null,
          hasApi: typeof window.dockerExplorer !== "undefined",
          title: document.title
        })
      `);
      console.log("[dom]", JSON.stringify(result, null, 2));
    } catch (error) {
      console.log("[dom-check-error]", error);
    } finally {
      setTimeout(() => app.quit(), 1000);
    }
  });

  await mainWindow.loadURL("http://localhost:3000/main_window/index.html");
});