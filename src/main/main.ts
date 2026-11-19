import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { ThesisDB } from "./db";
import { registerIpc } from "./ipc";

let mainWindow: BrowserWindow | null = null;
let db: ThesisDB | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1000, minHeight: 660,
    title: "论文工作台（暂用名）",
    backgroundColor: "#f6f7f9",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const devUrl = process.env.ELECTRON_DEV_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

if (gotLock) {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    db = new ThesisDB(path.join(app.getPath("userData"), "thesis-workbench.db"));
    registerIpc(db);
    createWindow();
  }).catch((error) => {
    console.error("[main] startup error:", error);
    app.quit();
  });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", () => { db?.close(); db = null; });
}
