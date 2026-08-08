import { isPaneSafeLauncherEnvKey } from '@features/interactive-team-runtime/main/launcherEnv';
import { describe, expect, it } from 'vitest';

describe('isPaneSafeLauncherEnvKey', () => {
  it('rejects the tmux pane-identity variables the pane must set itself', () => {
    // When the app runs inside tmux, its own TMUX/TMUX_PANE leak into the
    // shell-env snapshot; exporting them into a lead's pane made stock Claude
    // split every teammate pane into the app's session instead of the team's.
    expect(isPaneSafeLauncherEnvKey('TMUX')).toBe(false);
    expect(isPaneSafeLauncherEnvKey('TMUX_PANE')).toBe(false);
  });

  it('keeps ordinary exportable keys and rejects malformed names', () => {
    expect(isPaneSafeLauncherEnvKey('PATH')).toBe(true);
    expect(isPaneSafeLauncherEnvKey('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')).toBe(true);
    expect(isPaneSafeLauncherEnvKey('AGENT_TEAMS_MATTERS_DIR')).toBe(true);
    expect(isPaneSafeLauncherEnvKey('TMUX_TMPDIR')).toBe(true);
    expect(isPaneSafeLauncherEnvKey('BAD-NAME')).toBe(false);
    expect(isPaneSafeLauncherEnvKey('1LEADING')).toBe(false);
  });
});
