// Cross-platform helpers for AttyMate local-workspace paths.
//
// A workspace path is chosen on the user's machine (via the desktop folder
// picker) but validated on the server and consumed by the local runner — which
// may run on a different OS than the server. The server therefore CANNOT rely on
// Node's platform-aware `path` (it's POSIX on a Linux/macOS server and would
// reject or mangle Windows paths like `C:\Users\...`). These helpers reason
// about absolute-ness / traversal / normalization purely from the string, so the
// same rules apply regardless of which OS is running.
//
// Pure string logic only — NO `node:*` imports — so this module is safe to import
// from the browser bundle (the UI) as well as the server and runner.

// Windows drive-absolute: `C:\` or `C:/` (also matches the POSIX-prefixed legacy
// form `/C:/...` when the leading slash has been stripped).
const WINDOWS_DRIVE_ABS_RE = /^[A-Za-z]:[\\/]/;
// Windows UNC: `\\server\share`.
const WINDOWS_UNC_RE = /^\\\\[^\\]+\\[^\\]+/;
// Legacy "POSIX-prefixed Windows" form produced by the old `/C:/...` workaround.
const LEGACY_WINDOWS_PREFIXED_RE = /^\/([A-Za-z]:[\\/].*)$/;

/**
 * True if `value` is an absolute path on ANY supported platform: POSIX
 * (`/Users/...`), Windows drive (`C:\...` / `C:/...`), or Windows UNC
 * (`\\server\share`). Use this for workspace-path validation instead of
 * `path.isAbsolute`, which only understands the server's own OS.
 */
export function isAbsoluteWorkspacePath(value: string): boolean {
  return value.startsWith("/") || WINDOWS_DRIVE_ABS_RE.test(value) || WINDOWS_UNC_RE.test(value);
}

/**
 * True if `value` looks like a Windows path — a drive path (`C:\...`/`C:/...`),
 * a UNC path, or the legacy POSIX-prefixed form (`/C:/...`). Lets the server pick
 * `path.win32` vs `path.posix` semantics based on the stored root.
 */
export function isWindowsWorkspacePath(value: string): boolean {
  return (
    WINDOWS_DRIVE_ABS_RE.test(value) ||
    WINDOWS_UNC_RE.test(value) ||
    LEGACY_WINDOWS_PREFIXED_RE.test(value)
  );
}

/**
 * True if the path contains a `..` segment under EITHER separator. Workspace
 * paths and workspace-relative paths must never traverse upward.
 */
export function hasWorkspacePathTraversal(value: string): boolean {
  return value.split(/[\\/]/).includes("..");
}

/**
 * Convert the legacy POSIX-prefixed Windows form `/C:/Users/...` back to a native
 * Windows path `C:/Users/...`. No-op for genuine POSIX paths (`/Users/...`) and
 * native Windows paths (`C:\...`). This repairs workspace records created by the
 * old `/C:/...` workaround so the Windows runner can `fs.stat` them.
 */
export function normalizeLegacyWindowsWorkspacePath(value: string): string {
  const match = LEGACY_WINDOWS_PREFIXED_RE.exec(value);
  return match ? match[1] : value;
}
