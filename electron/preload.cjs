// AttyMate preload — runs in the renderer's isolated world before page load.
//
// Intentionally minimal: no IPC bridge yet, no native APIs exposed.
// Reserved for future use (file picker, drag-drop paths, etc.) via
// contextBridge.exposeInMainWorld(...).
//
// Kept as .cjs (not .js) so the renderer's preload sandbox loader treats it
// as CommonJS without us having to ship a separate package.json type override.

"use strict";
