// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildInteractiveCliArgs } from '@features/interactive-team-runtime/core/domain/interactiveCliArgs';
import {
  buildInteractiveTmuxSessionName,
  buildViewerSessionName,
  isInteractiveTmuxSessionName,
  isViewerSessionNameFor,
  slugifyTeamNameForTmux,
} from '@features/interactive-team-runtime/core/domain/sessionNaming';

describe('sessionNaming', () => {
  it('slugifies team names into tmux-safe tokens', () => {
    expect(slugifyTeamNameForTmux('My Team.v2:prod')).toBe('my-team-v2-prod');
    expect(slugifyTeamNameForTmux('---')).toBe('team');
  });

  it('builds and recognizes interactive session names', () => {
    const name = buildInteractiveTmuxSessionName('beacon-desk', 'a1b2c3d4-e5f6');
    expect(name).toBe('agteams-beacon-desk-a1b2c3d4');
    expect(isInteractiveTmuxSessionName(name)).toBe(true);
    expect(isInteractiveTmuxSessionName('con-agteams-x-1')).toBe(false);
  });

  it('builds and matches viewer session names', () => {
    const viewer = buildViewerSessionName('agteams-x-run1', 3);
    expect(viewer).toBe('con-agteams-x-run1-3');
    expect(isViewerSessionNameFor(viewer, 'agteams-x-run1')).toBe(true);
    expect(isViewerSessionNameFor(viewer, 'agteams-y-run2')).toBe(false);
  });
});

describe('buildInteractiveCliArgs', () => {
  it('strips headless plumbing and pins tmux teammate mode', () => {
    const headless = [
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--mcp-config',
      '/opt/fixtures/mcp.json',
      '--dangerously-skip-permissions',
      '--permission-mode',
      'bypassPermissions',
      '--model',
      'opus',
    ];
    expect(buildInteractiveCliArgs(headless)).toEqual([
      '--mcp-config',
      '/opt/fixtures/mcp.json',
      '--dangerously-skip-permissions',
      '--permission-mode',
      'bypassPermissions',
      '--model',
      'opus',
      '--teammate-mode',
      'tmux',
    ]);
  });

  it('drops the stdio permission prompt tool with its value', () => {
    expect(
      buildInteractiveCliArgs(['--permission-prompt-tool', 'stdio', '--permission-mode', 'default'])
    ).toEqual(['--permission-mode', 'default', '--teammate-mode', 'tmux']);
  });
});
