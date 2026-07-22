// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('cliFlavor', () => {
  afterEach(() => {
    delete process.env.CLAUDE_TEAM_CLI_FLAVOR;
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('uses the genuine Claude CLI by default', async () => {
    const { getConfiguredCliFlavor } = await import('@main/services/team/cliFlavor');

    expect(getConfiguredCliFlavor()).toBe('claude');
  });

  it('lets env override the default runtime to the multimodel orchestrator', async () => {
    process.env.CLAUDE_TEAM_CLI_FLAVOR = 'agent_teams_orchestrator';

    const { getConfiguredCliFlavor } = await import('@main/services/team/cliFlavor');

    expect(getConfiguredCliFlavor()).toBe('agent_teams_orchestrator');
  });

  it('falls back to the default when the env override is invalid', async () => {
    process.env.CLAUDE_TEAM_CLI_FLAVOR = 'not-a-real-flavor';

    const { getConfiguredCliFlavor } = await import('@main/services/team/cliFlavor');

    expect(getConfiguredCliFlavor()).toBe('claude');
  });
});
