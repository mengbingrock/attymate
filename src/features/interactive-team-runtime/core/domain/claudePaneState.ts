/**
 * Reads submission state off a Claude Code TUI pane capture.
 *
 * The composer is the `❯` input line. While a pasted bootstrap is pending it
 * renders a collapsed chip there — `❯ [Pasted text #1 +141 lines]` — and after
 * a successful submit the composer is empty while the transcript may echo the
 * same chip text above it. Anchoring on the LAST composer line (screens redraw
 * below old output) distinguishes the two.
 */

const COMPOSER_LINE = /^\s*❯\s?(.*)$/;

/** True when the pane's composer holds no pending input — the send went through. */
export function isClaudeComposerSubmitted(paneTail: string): boolean {
  let lastComposerContent: string | null = null;
  for (const line of paneTail.split('\n')) {
    const match = COMPOSER_LINE.exec(line);
    if (match) lastComposerContent = match[1].trim();
  }
  // No composer visible (mid-redraw, dialogs): treat as not submitted so the
  // caller retries — Enter on an empty or absent composer is a no-op.
  if (lastComposerContent === null) return false;
  return lastComposerContent === '';
}
