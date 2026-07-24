import { atomicWriteAsync } from '@main/utils/atomicWrite';
import * as agentTeamsControllerModule from 'agent-teams-controller';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getConfiguredAgentLanguageName } from './TeamProvisioningAgentLanguage';

import type { NativeAppManagedBootstrapSpec } from '../bootstrap/NativeAppManagedBootstrapContextBuilder';
import type {
  EffortLevel,
  TeamCreateRequest,
  TeamLaunchRequest,
  TeamProviderId,
} from '@shared/types';

const { AGENT_TEAMS_NAMESPACED_LEAD_BOOTSTRAP_TOOL_NAMES } = agentTeamsControllerModule;
const RUN_TIMEOUT_MS = 300_000;

export interface TeamProvisioningRunTimeoutInput {
  deterministicBootstrap: boolean;
  effectiveMembers: TeamCreateRequest['members'];
}

interface RuntimeBootstrapMemberSpec {
  name: string;
  prompt?: string;
  cwd?: string;
  model?: string;
  provider?: TeamProviderId;
  effort?: EffortLevel;
  isolation?: 'worktree';
  agentType?: string;
  description?: string;
  useSplitPane?: boolean;
  planModeRequired?: boolean;
  mcpConfigPath?: string;
  mcpSettingSources?: string;
  strictMcpConfig?: boolean;
  nativeAppManagedBootstrap?: NativeAppManagedBootstrapSpec;
}

export interface RuntimeBootstrapMemberMcpLaunchConfig {
  mcpConfigPath: string;
  mcpSettingSources: string;
  strictMcpConfig: boolean;
}

export interface RuntimeBootstrapSpec {
  version: 1;
  runId: string;
  mode: 'create' | 'launch';
  initiator: {
    kind: 'app';
    source: 'claude_team_agent_teams_orchestrator';
  };
  team: {
    name: string;
    displayName?: string;
    description?: string;
    color?: string;
    cwd: string;
  };
  lead: {
    agentLanguage?: string;
    permissionSeedTools?: string[];
  };
  members: RuntimeBootstrapMemberSpec[];
  launch?: {
    bootstrapTimeoutMs?: number;
    continueOnPartialFailure?: boolean;
  };
  ui?: {
    emitStructuredEvents?: boolean;
  };
}

const DETERMINISTIC_BOOTSTRAP_MIN_TIMEOUT_MS = 120_000;
// Keep a modest app-side headroom for cold starts and slow Windows I/O. The
// runtime still owns true per-member isolation and stale-bootstrap recovery.
const DETERMINISTIC_BOOTSTRAP_TIMEOUT_PER_MEMBER_MS = 110_000;
const DETERMINISTIC_BOOTSTRAP_MAX_TIMEOUT_MS = 900_000;
const DETERMINISTIC_BOOTSTRAP_OUTER_TIMEOUT_GRACE_MS = 30_000;

export function getDeterministicBootstrapTimeoutMs(memberCount: number): number {
  const perMemberBudget = Math.max(0, memberCount) * DETERMINISTIC_BOOTSTRAP_TIMEOUT_PER_MEMBER_MS;
  return Math.min(
    DETERMINISTIC_BOOTSTRAP_MAX_TIMEOUT_MS,
    Math.max(DETERMINISTIC_BOOTSTRAP_MIN_TIMEOUT_MS, perMemberBudget)
  );
}

export function getProvisioningRunTimeoutMs(run: TeamProvisioningRunTimeoutInput): number {
  if (!run.deterministicBootstrap) {
    return RUN_TIMEOUT_MS;
  }

  return Math.max(
    RUN_TIMEOUT_MS,
    getDeterministicBootstrapTimeoutMs(run.effectiveMembers.length) +
      DETERMINISTIC_BOOTSTRAP_OUTER_TIMEOUT_GRACE_MS
  );
}

export function buildDeterministicCreateBootstrapSpec(
  runId: string,
  request: TeamCreateRequest,
  effectiveMembers: TeamCreateRequest['members'],
  nativeAppManagedBootstrapByMember: ReadonlyMap<string, NativeAppManagedBootstrapSpec> = new Map(),
  mcpLaunchConfigByMember: ReadonlyMap<string, RuntimeBootstrapMemberMcpLaunchConfig> = new Map()
): RuntimeBootstrapSpec {
  return {
    version: 1,
    runId,
    mode: 'create',
    initiator: {
      kind: 'app',
      source: 'claude_team_agent_teams_orchestrator',
    },
    team: {
      name: request.teamName,
      ...(request.displayName?.trim() ? { displayName: request.displayName.trim() } : {}),
      ...(request.description?.trim() ? { description: request.description.trim() } : {}),
      ...(request.color?.trim() ? { color: request.color.trim() } : {}),
      cwd: request.cwd,
    },
    lead: {
      agentLanguage: getConfiguredAgentLanguageName(),
      ...(request.skipPermissions === false
        ? {
            permissionSeedTools: [
              ...AGENT_TEAMS_NAMESPACED_LEAD_BOOTSTRAP_TOOL_NAMES,
              'Edit',
              'Write',
              'NotebookEdit',
            ],
          }
        : {}),
    },
    members: effectiveMembers.map((member) => {
      const mcpLaunchConfig = mcpLaunchConfigByMember.get(member.name);
      return {
        name: member.name,
        ...(member.role?.trim() ? { role: member.role.trim() } : {}),
        ...(member.workflow?.trim() ? { workflow: member.workflow.trim() } : {}),
        ...(request.cwd ? { cwd: request.cwd } : {}),
        ...(member.model?.trim() ? { model: member.model.trim() } : {}),
        ...(member.providerId ? { provider: member.providerId } : {}),
        ...(member.effort ? { effort: member.effort } : {}),
        ...(member.isolation === 'worktree' ? { isolation: 'worktree' as const } : {}),
        ...(member.role?.trim() ? { description: member.role.trim() } : {}),
        ...(mcpLaunchConfig ? mcpLaunchConfig : {}),
        ...(nativeAppManagedBootstrapByMember.get(member.name)
          ? { nativeAppManagedBootstrap: nativeAppManagedBootstrapByMember.get(member.name)! }
          : {}),
      };
    }),
    launch: {
      bootstrapTimeoutMs: getDeterministicBootstrapTimeoutMs(effectiveMembers.length),
      continueOnPartialFailure: true,
    },
    ui: {
      emitStructuredEvents: true,
    },
  };
}

export function buildDeterministicLaunchBootstrapSpec(
  runId: string,
  request: TeamLaunchRequest,
  effectiveMembers: TeamCreateRequest['members'],
  nativeAppManagedBootstrapByMember: ReadonlyMap<string, NativeAppManagedBootstrapSpec> = new Map(),
  mcpLaunchConfigByMember: ReadonlyMap<string, RuntimeBootstrapMemberMcpLaunchConfig> = new Map()
): RuntimeBootstrapSpec {
  return {
    version: 1,
    runId,
    mode: 'launch',
    initiator: {
      kind: 'app',
      source: 'claude_team_agent_teams_orchestrator',
    },
    team: {
      name: request.teamName,
      cwd: request.cwd,
    },
    lead: {
      agentLanguage: getConfiguredAgentLanguageName(),
      ...(request.skipPermissions === false
        ? {
            permissionSeedTools: [
              ...AGENT_TEAMS_NAMESPACED_LEAD_BOOTSTRAP_TOOL_NAMES,
              'Edit',
              'Write',
              'NotebookEdit',
            ],
          }
        : {}),
    },
    members: effectiveMembers.map((member) => {
      const mcpLaunchConfig = mcpLaunchConfigByMember.get(member.name);
      return {
        name: member.name,
        ...(request.cwd ? { cwd: request.cwd } : {}),
        ...(member.model?.trim() ? { model: member.model.trim() } : {}),
        ...(member.providerId ? { provider: member.providerId } : {}),
        ...(member.effort ? { effort: member.effort } : {}),
        ...(member.isolation === 'worktree' ? { isolation: 'worktree' as const } : {}),
        ...(member.role?.trim() ? { role: member.role.trim() } : {}),
        ...(member.workflow?.trim() ? { workflow: member.workflow.trim() } : {}),
        ...(member.role?.trim() ? { description: member.role.trim() } : {}),
        ...(mcpLaunchConfig ? mcpLaunchConfig : {}),
        ...(nativeAppManagedBootstrapByMember.get(member.name)
          ? { nativeAppManagedBootstrap: nativeAppManagedBootstrapByMember.get(member.name)! }
          : {}),
      };
    }),
    launch: {
      bootstrapTimeoutMs: getDeterministicBootstrapTimeoutMs(effectiveMembers.length),
      continueOnPartialFailure: true,
    },
    ui: {
      emitStructuredEvents: true,
    },
  };
}

export function describeStockBootstrapMember(member: RuntimeBootstrapMemberSpec): string {
  const details: string[] = [];
  if (member.model) details.push(`model: ${member.model}`);
  if (member.effort) details.push(`effort: ${member.effort}`);
  if (member.isolation === 'worktree') details.push('work in an isolated git worktree');
  const header =
    details.length > 0 ? `- ${member.name} (${details.join(', ')})` : `- ${member.name}`;
  const brief = member.description?.trim() || member.prompt?.trim();
  return brief ? `${header}: ${brief}` : header;
}

/**
 * Stock Claude Code has no --team-bootstrap-spec flag; the same roster is
 * delivered as the first stdin user turn so the lead assembles the team itself.
 */
export function buildStockClaudeBootstrapPrompt(
  spec: RuntimeBootstrapSpec,
  initialUserPrompt: string
): string {
  const teamLabel = spec.team.displayName?.trim() || spec.team.name;
  const lines: string[] = [];
  if (spec.mode === 'create') {
    lines.push(
      `You are the lead of a new agent team. Create the team named exactly "${spec.team.name}"` +
        (teamLabel !== spec.team.name ? ` (display name: "${teamLabel}")` : '') +
        '.'
    );
    if (spec.team.description?.trim()) {
      lines.push(`Team purpose: ${spec.team.description.trim()}`);
    }
  } else {
    lines.push(
      `You are the lead of the existing agent team "${spec.team.name}". Its state is persisted on disk; bring the team back up.`
    );
  }
  if (spec.members.length > 0) {
    lines.push(
      '',
      'Spawn one teammate per roster entry below. Use the exact teammate names as given:'
    );
    for (const member of spec.members) {
      lines.push(describeStockBootstrapMember(member));
    }
  }
  lines.push(
    '',
    'IMPORTANT: The desktop app has pre-registered this roster for tracking only. The',
    'teammates are NOT running yet — team_get / team_list may list them, but that is just',
    'the registered roster, not live agents. You MUST spawn every roster entry yourself now,',
    'as an agent-team TEAMMATE: a named, persistent agent you can message by name with',
    'SendMessage — not a one-shot subagent that just returns a result. Do not skip spawning',
    'or assume they are already provisioned; if you do not spawn them, the launch fails.',
    'In each spawn, use the exact roster name and begin the description field with that name',
    '(e.g. description: "<name>: ...") so the app can track the spawn. Spawn all teammates',
    'before starting any other work, and keep them running so they can pick up tasks.'
  );
  lines.push(
    '',
    'You are running inside a desktop app that tracks this team on a kanban board through your',
    '"agent-teams-mcp" MCP tools. Follow this protocol:',
    `- Record every distinct work item with the task_create tool (teamName: "${spec.team.name}") before working on it.`,
    '- Keep task status current with task_start, task_set_status, task_set_owner, and task_complete.',
    '- Report progress and results to the human user with the message_send tool (to: "user", from: "team-lead").',
    '- Check lead_briefing periodically for the operational queue and newly assigned work.',
    '- Do not stop your session while teammates are still working; wait for them and keep coordinating.',
    '',
    'CRITICAL — teammates do NOT auto-pick-up work. Your teammates are in-process agents that',
    'you spawned; they do not poll the task board or their inbox on their own. Assigning a task',
    '(task_create/task_set_owner with a teammate owner) does NOT start it. To make a teammate',
    'do work you MUST call the SendMessage tool (to: "<teammate>") with the task id and what to',
    'do, then wait for their reply. After they report back, update the task status yourself.'
  );
  if (initialUserPrompt.trim()) {
    lines.push('', 'Once the team is assembled, start on this task:', '', initialUserPrompt.trim());
  } else {
    lines.push('', 'Once the team is assembled, wait for further instructions from the user.');
  }
  return lines.join('\n');
}

export async function writeDeterministicBootstrapSpecFile(
  spec: RuntimeBootstrapSpec
): Promise<string> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-teams-bootstrap-'));
  const filePath = path.join(tempDir, `${spec.team.name}-${randomUUID()}.json`);
  await atomicWriteAsync(filePath, JSON.stringify(spec), { mode: 0o600 });
  return filePath;
}

async function removeDeterministicBootstrapTempFile(filePath: string | null): Promise<void> {
  if (!filePath) return;
  await fs.promises.rm(filePath, { force: true }).catch(() => {});
  await fs.promises.rmdir(path.dirname(filePath)).catch(() => {});
}

export async function removeDeterministicBootstrapSpecFile(filePath: string | null): Promise<void> {
  await removeDeterministicBootstrapTempFile(filePath);
}

export async function writeDeterministicBootstrapUserPromptFile(prompt: string): Promise<string> {
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'agent-teams-bootstrap-prompt-')
  );
  const filePath = path.join(tempDir, `${randomUUID()}.txt`);
  await atomicWriteAsync(filePath, prompt, { mode: 0o600 });
  return filePath;
}

export async function removeDeterministicBootstrapUserPromptFile(
  filePath: string | null
): Promise<void> {
  await removeDeterministicBootstrapTempFile(filePath);
}
