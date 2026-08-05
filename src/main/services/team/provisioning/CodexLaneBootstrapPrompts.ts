import { MATTER_SKILL_SLUG } from '@features/matter-dashboard/contracts';

import { describeStockBootstrapMember } from './TeamProvisioningBootstrapSpec';
import { buildLeadInitialMatterScanInstructions } from './TeamProvisioningPromptBuilders';

import type { RuntimeBootstrapSpec } from './TeamProvisioningBootstrapSpec';

export interface CodexLeadBootstrapOptions {
  /** Existing kanban snapshot lines for relaunches (already formatted). */
  existingTasksSummary?: string;
  /** The team's matter dashboard has no content yet: instruct an initial folder scan. */
  matterNeedsInitialScan?: boolean;
  /** Structured identity of the primary runtime. */
  leadName?: string;
  /** Imported profile instructions applied to the primary runtime. */
  leadWorkflow?: string;
}

/**
 * First input pasted into the codex lead lane. Unlike the stock-Claude prompt,
 * the roster is ALREADY running — the app launched every teammate as its own
 * codex console — so the lead must coordinate, never spawn.
 */
export function buildCodexLeadBootstrapPrompt(
  spec: RuntimeBootstrapSpec,
  initialUserPrompt: string,
  options: CodexLeadBootstrapOptions = {}
): string {
  const teamLabel = spec.team.displayName?.trim() || spec.team.name;
  const leadName = options.leadName?.trim() || 'team-lead';
  const lines: string[] = [];
  if (spec.mode === 'create') {
    lines.push(
      `You are "${leadName}", the lead of the new agent team "${spec.team.name}"` +
        (teamLabel !== spec.team.name ? ` (display name: "${teamLabel}")` : '') +
        '.'
    );
    if (spec.team.description?.trim()) {
      lines.push(`Team purpose: ${spec.team.description.trim()}`);
    }
  } else {
    lines.push(
      `You are "${leadName}", the lead of the existing agent team "${spec.team.name}". Its state is persisted on disk; resume coordinating it.`
    );
  }
  if (options.leadWorkflow?.trim()) {
    lines.push('', 'Your imported lead profile instructions:', '', options.leadWorkflow.trim());
  }
  if (spec.members.length > 0) {
    lines.push('', 'Your teammates:');
    for (const member of spec.members) {
      lines.push(describeStockBootstrapMember(member));
    }
    lines.push(
      '',
      'IMPORTANT: Every teammate above is ALREADY RUNNING — the desktop app launched each one',
      'as its own Codex session. Do NOT create, spawn, or replace them, and do NOT use the',
      'spawn_agent tool to stand in for a teammate (spawn_agent is fine for your own private',
      'throwaway subagents). To reach a teammate, use the message_send tool.'
    );
  }
  lines.push(
    '',
    'You are running inside a desktop app that tracks this team on a kanban board through your',
    '"agent_teams" MCP tools. Follow this protocol:',
    `- Record every distinct work item with the task_create tool (teamName: "${spec.team.name}") before working on it.`,
    '- Keep task status current with task_start, task_set_status, task_set_owner, and task_complete.',
    `- Report progress and results to the human user with the message_send tool (to: "user", from: "${leadName}").`,
    '- Check lead_briefing periodically for the operational queue and newly assigned work.',
    '- Do not stop your session while teammates are still working; keep coordinating.',
    '',
    'CRITICAL — teammates do NOT auto-pick-up work. Assigning a task (task_create /',
    'task_set_owner) does NOT start it. To make a teammate work you MUST call the',
    `message_send tool (to: "<teammate>", from: "${leadName}") with the task id and clear`,
    'instructions. Their replies arrive in your session as messages prefixed',
    '"[Agent Teams message from <name>]". After a teammate reports back, update the task',
    'status yourself.',
    '',
    `Matter dashboard (MANDATORY): do NOT update it per task. When a related series of tasks`,
    `(a job) is fully complete, load the "${MATTER_SKILL_SLUG}" skill and follow it — the app also`,
    'sends you that skill when the user asks for a refresh or the board goes quiet. You may only',
    'propose (matter_get then matter_propose); the user approves in the dashboard and nothing',
    'changes until then. Grounded facts only — never invent dates, amounts, or outcomes.'
  );
  if (spec.members.length > 0) {
    lines.push(
      'Delegate matter work to the right specialist (calendaring, docket, intake/facts) and',
      'message them in parallel. You compile and propose.'
    );
  }
  if (options.matterNeedsInitialScan) {
    lines.push(
      '',
      buildLeadInitialMatterScanInstructions(spec.team.name, {
        hasTeammates: spec.members.length > 0,
        canSpawnTeammates: false,
      })
    );
  }
  if (options.existingTasksSummary?.trim()) {
    lines.push('', 'Current kanban tasks:', options.existingTasksSummary.trim());
  }
  if (initialUserPrompt.trim()) {
    lines.push('', 'Start on this task now:', '', initialUserPrompt.trim());
  } else {
    lines.push('', 'Wait for further instructions from the user.');
  }
  return lines.join('\n');
}

export interface CodexTeammateBriefingInput {
  teamName: string;
  memberName: string;
  role?: string;
  leadName: string;
}

/** First input pasted into each codex teammate lane. */
export function buildCodexTeammateBriefingPrompt(input: CodexTeammateBriefingInput): string {
  const lines: string[] = [
    `You are "${input.memberName}", a teammate of the agent team "${input.teamName}".`,
  ];
  if (input.role?.trim()) {
    lines.push(`Your role: ${input.role.trim()}`);
  }
  lines.push(
    '',
    'You are running inside a desktop app that coordinates this team through your',
    '"agent_teams" MCP tools. Follow this protocol:',
    '- Instructions arrive in this session as messages prefixed "[Agent Teams message from <name>]".',
    `  Most come from the team lead "${input.leadName}". Act on them.`,
    `- When you finish (or get blocked), report back with the message_send tool (to: "${input.leadName}", from: "${input.memberName}").`,
    `- Keep any task you work on current with task_start / task_set_status / task_complete (always pass teamName: "${input.teamName}").`,
    `- Never claim to be the team lead; your "from" is always exactly "${input.memberName}".`,
    '',
    'No work is assigned yet. Acknowledge briefly and wait for instructions.'
  );
  return lines.join('\n');
}
