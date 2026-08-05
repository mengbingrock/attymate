import { atomicWriteAsync } from '@main/utils/atomicWrite';
import { getTeamsBasePath } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

import type { TeamCreateRequest, TeamProviderId } from '@shared/types';

const logger = createLogger('Service:TeamProvisioning');

export interface SynthesizeStockClaudeTeamStateOptions {
  teamName: string;
  cwd: string;
  description?: string;
  /** Existing imported profile occupying the primary lead runtime. */
  lead?: TeamCreateRequest['lead'];
  members: TeamCreateRequest['members'];
  providerId?: TeamProviderId;
  leadSessionId?: string | null;
}

interface SynthesizedConfigMember {
  agentId: string;
  name: string;
  agentType?: string;
  model?: string;
  joinedAt: number;
  cwd: string;
  subscriptions: string[];
  provider?: TeamProviderId;
  providerId?: TeamProviderId;
  sessionId?: string;
  isActive?: boolean;
}

function buildSynthesizedConfig(options: SynthesizeStockClaudeTeamStateOptions): {
  name: string;
  description?: string;
  createdAt: number;
  lead: { name: string; agentId: string };
  leadAgentId: string;
  leadSessionId: string;
  members: SynthesizedConfigMember[];
} {
  const now = Date.now();
  const providerId = options.providerId ?? 'anthropic';
  const leadName = options.lead?.name.trim() || 'team-lead';
  const leadAgentId = `${leadName}@${options.teamName}`;
  const lead: SynthesizedConfigMember = {
    agentId: leadAgentId,
    name: leadName,
    agentType: 'team-lead',
    ...(options.lead?.model?.trim() ? { model: options.lead.model.trim() } : {}),
    joinedAt: now,
    cwd: options.cwd,
    subscriptions: [],
    provider: providerId,
    providerId,
    sessionId: options.leadSessionId ?? '',
  };
  const members = options.members.map((member): SynthesizedConfigMember => {
    return {
      agentId: `${member.name}@${options.teamName}`,
      name: member.name,
      ...(member.model?.trim() ? { model: member.model.trim() } : {}),
      joinedAt: now,
      cwd: member.cwd?.trim() || options.cwd,
      subscriptions: [],
      provider: member.providerId ?? providerId,
      providerId: member.providerId ?? providerId,
      // Register the member as PENDING, not active. The lead must still spawn
      // each teammate via the Agent tool at bootstrap; marking them active here
      // would make the lead's team_get see them as "already provisioned" and
      // skip spawning, which then trips the "never spawned" launch failure.
      isActive: false,
    };
  });
  return {
    name: options.teamName,
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    createdAt: now,
    lead: { name: lead.name, agentId: leadAgentId },
    leadAgentId,
    leadSessionId: options.leadSessionId ?? '',
    members: [lead, ...members],
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stock Claude Code cannot emit the fork's on-disk team contract: its
 * agent-teams toolset is unavailable in headless mode, so nothing writes
 * `config.json` or inbox files under `~/.claude/teams/<team>/`. The app's
 * provisioning readiness (filesystem monitor) and the team UI readers depend
 * on those files, so for stock launches the app synthesizes them itself from
 * the roster it already knows. Existing files are never overwritten — a
 * relaunch of a previously provisioned team keeps its real state.
 */
export async function synthesizeStockClaudeTeamRuntimeState(
  options: SynthesizeStockClaudeTeamStateOptions
): Promise<void> {
  const teamDir = path.join(getTeamsBasePath(), options.teamName);
  const inboxesDir = path.join(teamDir, 'inboxes');
  await fs.promises.mkdir(inboxesDir, { recursive: true });

  const configPath = path.join(teamDir, 'config.json');
  if (!(await pathExists(configPath))) {
    const config = buildSynthesizedConfig(options);
    await atomicWriteAsync(configPath, JSON.stringify(config, null, 2));
    logger.info(
      `[${options.teamName}] Synthesized stock-runtime config.json with ${config.members.length} members`
    );
  }

  for (const member of options.members) {
    const inboxPath = path.join(inboxesDir, `${member.name}.json`);
    if (!(await pathExists(inboxPath))) {
      await atomicWriteAsync(inboxPath, '[]');
    }
  }
}
