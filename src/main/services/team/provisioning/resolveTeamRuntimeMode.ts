import { resolveTeamProviderId } from '@main/services/runtime/providerRuntimeEnv';

import type { TeamProviderId } from '@shared/types/team';

export type TeamRuntimeMode = 'stock-claude' | 'stock-codex-lanes';

/**
 * Pick the team runtime per run. The lead provider decides the runtime so a
 * Codex team never silently runs on the stock Claude binary.
 */
export function resolveTeamRuntimeMode(input: {
  leadProviderId: TeamProviderId | undefined;
}): TeamRuntimeMode {
  if (resolveTeamProviderId(input.leadProviderId) === 'codex') return 'stock-codex-lanes';
  return 'stock-claude';
}
