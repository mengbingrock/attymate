import { describe, expect, it } from 'vitest';

import { resolveLinkCommandInvocation } from '@features/matter-dashboard/main';

describe('resolveLinkCommandInvocation', () => {
  it('prefers an explicit packaged or global command override', () => {
    expect(
      resolveLinkCommandInvocation({
        AGENT_TEAMS_LINK_COMMAND: '/runtime/bin/lnk',
        AGENT_TEAMS_LINK_SCRIPT: '/src/link/link.py',
      })
    ).toEqual({
      command: '/runtime/bin/lnk',
      prefixArgs: [],
      displayName: '/runtime/bin/lnk',
    });
  });

  it('runs a local Link source checkout through Python without a shell', () => {
    expect(
      resolveLinkCommandInvocation({
        AGENT_TEAMS_LINK_SCRIPT: '/src/link/link.py',
        AGENT_TEAMS_LINK_PYTHON: '/usr/bin/python3',
      })
    ).toEqual({
      command: '/usr/bin/python3',
      prefixArgs: ['/src/link/link.py'],
      displayName: '/usr/bin/python3 /src/link/link.py',
    });
  });

  it('falls back to the installed lnk command', () => {
    expect(resolveLinkCommandInvocation({})).toEqual({
      command: 'lnk',
      prefixArgs: [],
      displayName: 'lnk',
    });
  });
});
