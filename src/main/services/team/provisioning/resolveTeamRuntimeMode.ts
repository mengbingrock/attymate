import { resolveTeamProviderId } from '@main/services/runtime/providerRuntimeEnv';

import type { CliFlavor } from '@shared/types';
import type { TeamProviderId } from '@shared/types/team';

export type TeamRuntimeMode = 'fork-headless' | 'stock-claude' | 'stock-codex-lanes';

/**
 * Pick the team runtime per run. The multimodel fork is opt-in only
 * (CLAUDE_TEAM_CLI_FLAVOR=agent_teams_orchestrator); under the stock default,
 * the lead provider decides the runtime so a Codex team never silently runs on
 * the stock Claude binary.
 */
export function resolveTeamRuntimeMode(input: {
  cliFlavor: CliFlavor;
  leadProviderId: TeamProviderId | undefined;
}): TeamRuntimeMode {
  if (input.cliFlavor === 'agent_teams_orchestrator') return 'fork-headless';
  if (resolveTeamProviderId(input.leadProviderId) === 'codex') return 'stock-codex-lanes';
  return 'stock-claude';
}
