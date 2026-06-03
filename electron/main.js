// AttyMate — Electron shell.
//
// Loads the live Paperclip SPA from paperclip.attymate.com so the webview is
// first-party to the backend (cookies, auth, CORS all "just work"). Identical
// architecture to the Tauri variant on UItoApp; this is a parallel exploration
// to compare frameworks. See doc/UItoApp-architecture.md for context.

import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_URL = process.env.ATTYMATE_APP_URL ?? "https://paperclip.attymate.com";

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "AttyMate",
    backgroundColor: "#18181b",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Defer show until first paint to avoid the white flash.
  win.once("ready-to-show", () => win.show());

  // Open any window.open() / target="_blank" link in the user's default browser
  // rather than spawning child Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  // Standard macOS convention: keep app running until ⌘Q.
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
