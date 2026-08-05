export type CodexPaneState =
  | 'ready'
  | 'trust-dialog'
  | 'login-required'
  | 'approval-dialog'
  | 'unknown';

/**
 * Classify a codex TUI pane from its captured tail (codex-cli 0.145.0
 * fixtures). The TUI redraws below earlier output instead of clearing it, so
 * old dialogs stay in the capture forever — classification must key off the
 * LAST non-empty lines, never off matches anywhere in the tail.
 *
 * `ready` means the composer/status footer is the bottommost content and
 * pasted input will land in the composer (codex queues input even mid-turn).
 */
export function detectCodexPaneState(tail: string): CodexPaneState {
  const lines = tail
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return 'unknown';
  const last = lines[lines.length - 1];
  const lastFew = lines.slice(-6);

  // Trust dialog bottom: "› 1. Yes, continue / 2. No, quit / Press enter to continue"
  if (
    /Press enter to continue/i.test(last) ||
    lastFew.some((line) => /Do you trust the contents of this directory/i.test(line))
  ) {
    return 'trust-dialog';
  }
  if (lastFew.some((line) => /Sign in with ChatGPT|Not signed in|codex login\b/i.test(line))) {
    return 'login-required';
  }
  if (lastFew.some((line) => /Allow Codex to run|Approve this command/i.test(line))) {
    return 'approval-dialog';
  }
  // Idle footer: status line `<model> <effort> · <cwd>` is the bottommost
  // content, with the `›` composer line just above it.
  const hasStatusFooter = last.includes('·');
  const hasComposerAbove = lines.slice(-4).some((line) => /^\s*›/.test(line));
  if (hasStatusFooter && hasComposerAbove) {
    return 'ready';
  }
  return 'unknown';
}
