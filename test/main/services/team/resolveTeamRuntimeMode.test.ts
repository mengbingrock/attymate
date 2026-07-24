// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolveTeamRuntimeMode } from '@main/services/team/provisioning/resolveTeamRuntimeMode';

describe('resolveTeamRuntimeMode', () => {
  it('routes the multimodel fork only on explicit flavor opt-in', () => {
    expect(
      resolveTeamRuntimeMode({ cliFlavor: 'agent_teams_orchestrator', leadProviderId: 'codex' })
    ).toBe('fork-headless');
    expect(
      resolveTeamRuntimeMode({ cliFlavor: 'agent_teams_orchestrator', leadProviderId: 'anthropic' })
    ).toBe('fork-headless');
  });

  it('routes codex leads to stock codex lanes under the stock flavor', () => {
    expect(resolveTeamRuntimeMode({ cliFlavor: 'claude', leadProviderId: 'codex' })).toBe(
      'stock-codex-lanes'
    );
  });

  it('routes anthropic and unset providers to stock claude', () => {
    expect(resolveTeamRuntimeMode({ cliFlavor: 'claude', leadProviderId: 'anthropic' })).toBe(
      'stock-claude'
    );
    expect(resolveTeamRuntimeMode({ cliFlavor: 'claude', leadProviderId: undefined })).toBe(
      'stock-claude'
    );
  });
});
