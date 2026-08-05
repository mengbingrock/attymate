// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolveTeamRuntimeMode } from '@main/services/team/provisioning/resolveTeamRuntimeMode';

describe('resolveTeamRuntimeMode', () => {
  it('routes codex leads to stock codex lanes', () => {
    expect(resolveTeamRuntimeMode({ leadProviderId: 'codex' })).toBe('stock-codex-lanes');
  });

  it('routes anthropic and unset providers to stock claude', () => {
    expect(resolveTeamRuntimeMode({ leadProviderId: 'anthropic' })).toBe('stock-claude');
    expect(resolveTeamRuntimeMode({ leadProviderId: undefined })).toBe('stock-claude');
  });
});
