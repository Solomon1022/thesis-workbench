import { app, BrowserWindow, shell } from "electron";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { ThesisDB } from "./db";
import { registerIpc } from "./ipc";

let mainWindow: BrowserWindow | null = null;
let db: ThesisDB | null = null;

// 缓解部分机器/远程桌面环境下 GPU 进程触发的 0x80000003 崩溃（CHECK 失败）。
// 本应用以表单为主，软件渲染无可见性能影响。
app.disableHardwareAcceleration();

// 崩溃留痕：GUI 进程没有控制台，把主进程异常与子进程退出写入 userData/crash.log 便于排查。
const crashLogPath = () => path.join(app.getPath("userData"), "crash.log");
function logCrash(message: string): void {
  try { appendFileSync(crashLogPath(), new Date().toISOString() + " " + message + "\n"); } catch { /* ignore */ }
}
process.on("uncaughtException", (error) => logCrash("uncaughtException: " + String((error as Error)?.stack ?? error)));
app.on("render-process-gone", (_event, _wc, details) => logCrash("render-process-gone: " + details.reason + " exitCode=" + details.exitCode));
app.on("child-process-gone", (_event, details) => logCrash("child-process-gone: " + details.type + " " + details.reason + " exitCode=" + details.exitCode));

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
