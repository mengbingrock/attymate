import { describe, expect, it } from 'vitest';

import { rehomeMemberCwdsForLaunch } from '@main/services/team/provisioning/TeamProvisioningConfigLaunchNormalization';
import type { TeamMember } from '@shared/types';

const member = (name: string, cwd?: string): TeamMember => ({ name, cwd });

describe('rehomeMemberCwdsForLaunch', () => {
  it('rewrites member cwds that equal the previous launch cwd', () => {
    const members = [
      member('lead', '/projects/old'),
      member('researcher', '/projects/old'),
    ];

    const result = rehomeMemberCwdsForLaunch(members, '/projects/old', '/projects/new');

    expect(result.map((m) => m.cwd)).toEqual(['/projects/new', '/projects/new']);
  });

  it('keeps members whose cwd deliberately differs from the previous launch cwd', () => {
    const members = [
      member('lead', '/projects/old'),
      member('worktree-agent', '/worktrees/agent-a'),
    ];

    const result = rehomeMemberCwdsForLaunch(members, '/projects/old', '/projects/new');

    expect(result[0]?.cwd).toBe('/projects/new');
    expect(result[1]?.cwd).toBe('/worktrees/agent-a');
  });

  it('leaves members without a cwd untouched', () => {
    const members = [member('lead'), member('drafter', '')];

    const result = rehomeMemberCwdsForLaunch(members, '/projects/old', '/projects/new');

    expect(result[0]?.cwd).toBeUndefined();
    expect(result[1]?.cwd).toBe('');
  });

  it('matches trimmed cwds when rewriting', () => {
    const members = [member('lead', '  /projects/old  ')];

    const result = rehomeMemberCwdsForLaunch(members, '/projects/old', '/projects/new');

    expect(result[0]?.cwd).toBe('/projects/new');
  });

  it('is a no-op when the launch cwd is unchanged', () => {
    const members = [member('lead', '/projects/old')];

    const result = rehomeMemberCwdsForLaunch(members, '/projects/old', '/projects/old');

    expect(result).toEqual(members);
    expect(result).not.toBe(members);
  });

  it('is a no-op when there is no previous cwd (first launch)', () => {
    const members = [member('lead', '/projects/old')];

    expect(rehomeMemberCwdsForLaunch(members, null, '/projects/new')).toEqual(members);
    expect(rehomeMemberCwdsForLaunch(members, undefined, '/projects/new')).toEqual(members);
    expect(rehomeMemberCwdsForLaunch(members, '   ', '/projects/new')).toEqual(members);
  });

  it('is a no-op when the next cwd is missing', () => {
    const members = [member('lead', '/projects/old')];

    expect(rehomeMemberCwdsForLaunch(members, '/projects/old', null)).toEqual(members);
    expect(rehomeMemberCwdsForLaunch(members, '/projects/old', '')).toEqual(members);
  });

  it('does not mutate the input members', () => {
    const original = member('lead', '/projects/old');

    const result = rehomeMemberCwdsForLaunch([original], '/projects/old', '/projects/new');

    expect(original.cwd).toBe('/projects/old');
    expect(result[0]).not.toBe(original);
  });
});
