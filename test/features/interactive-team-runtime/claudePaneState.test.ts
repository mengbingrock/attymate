import { isClaudeComposerSubmitted } from '@features/interactive-team-runtime/core/domain/claudePaneState';
import { describe, expect, it } from 'vitest';

describe('isClaudeComposerSubmitted', () => {
  it('reports a pending paste chip as not submitted', () => {
    // The stuck-launch state: bootstrap pasted, Enter coalesced into the paste.
    const tail = [
      ' ▐▛███▜▌   Claude Code v2.1.222',
      ' ⚠ 2 MCP servers need authentication · run /mcp',
      '❯ [Pasted text #1 +141 lines]',
      '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
    ].join('\n');
    expect(isClaudeComposerSubmitted(tail)).toBe(false);
  });

  it('reports an empty composer as submitted', () => {
    const tail = ['✳ Crafting… (5s · thinking)', '❯ ', '  ⏵⏵ bypass permissions on'].join('\n');
    expect(isClaudeComposerSubmitted(tail)).toBe(true);
  });

  it('anchors on the LAST composer line, ignoring transcript echoes above it', () => {
    // After submit the transcript can echo the chip text; only the live
    // composer at the bottom decides.
    const tail = ['❯ [Pasted text #1 +141 lines]', '✳ Thinking…', '❯ '].join('\n');
    expect(isClaudeComposerSubmitted(tail)).toBe(true);
  });

  it('treats typed pending text as not submitted', () => {
    expect(isClaudeComposerSubmitted('❯ still typing something')).toBe(false);
  });

  it('treats a capture without a composer as not submitted, so the caller retries', () => {
    expect(isClaudeComposerSubmitted('Do you trust this folder?\n  Yes, I trust this folder')).toBe(
      false
    );
    expect(isClaudeComposerSubmitted('')).toBe(false);
  });
});
