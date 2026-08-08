/**
 * Env keys that must NEVER be exported into a tmux pane's launcher script.
 *
 * tmux sets fresh, correct values for these inside every pane. When the app
 * itself runs inside tmux (dev harness, or launched from a tmux terminal),
 * its own values leak into the shell-env snapshot; exporting them into the
 * lead's pane makes the stock CLI believe it lives in the APP's pane. Claude
 * 2.1.223's tmux backend trusts TMUX_PANE to place teammate panes, so a
 * poisoned value scattered all ten teammates into the app's own dev session
 * — no breakout windows, no console targets.
 */
const TMUX_HOST_ENV_KEYS = new Set(['TMUX', 'TMUX_PANE']);

export function isPaneSafeLauncherEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !TMUX_HOST_ENV_KEYS.has(key);
}
