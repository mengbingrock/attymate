// AttyMate preload — runs in the renderer's isolated world before page load.
//
// Exposes a narrow `window.attymate` API to the remote SPA. Every entry is a
// thin wrapper around an ipcRenderer.invoke call back to the main process —
// no Node APIs are exposed to renderer code directly, sandbox stays intact.
//
// Kept as .cjs (not .js) so the renderer's sandbox loader treats it as
// CommonJS without us having to ship a separate package.json type override.

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("attymate", {
  /**
   * Open the native folder picker. Returns the absolute path the user chose,
   * or `null` if they cancelled the dialog.
   * @returns {Promise<string | null>}
   */
  pickFolder: () => ipcRenderer.invoke("pick-folder"),

  /**
   * Marker so the SPA can feature-detect: "am I running inside AttyMate?".
   * Pure browser callers get `undefined`.
   */
  shell: "electron",
});
