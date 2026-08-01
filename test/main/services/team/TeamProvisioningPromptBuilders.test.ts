import { buildCodexLeadBootstrapPrompt } from '@main/services/team/provisioning/CodexLaneBootstrapPrompts';
import { buildStockClaudeBootstrapPrompt } from '@main/services/team/provisioning/TeamProvisioningBootstrapSpec';
import {
  buildGeminiPostLaunchHydrationPrompt,
  buildLeadInitialMatterScanInstructions,
  buildLeadMatterDashboardInstructions,
  buildMemberSpawnPrompt,
  buildPersistentLeadContext,
} from '@main/services/team/provisioning/TeamProvisioningPromptBuilders';
import { describe, expect, it } from 'vitest';

import type { RuntimeBootstrapSpec } from '@main/services/team/provisioning/TeamProvisioningBootstrapSpec';
import type { MemberSpawnStatusEntry, TeamCreateRequest } from '@shared/types';

function buildPromptWithStatus(status: MemberSpawnStatusEntry): string {
  return buildGeminiPostLaunchHydrationPrompt(
    {
      teamName: 'signal-ops',
      request: { prompt: 'Check readiness.' },
      memberSpawnStatuses: new Map([['tom', status]]),
    },
    'lead',
    [{ name: 'tom', providerId: 'anthropic', model: 'sonnet' }] as TeamCreateRequest['members'],
    []
  );
}

describe('TeamProvisioningPromptBuilders', () => {
  it('clarifies that assigned teammates may inspect and edit files for implementation work', () => {
    const prompt = buildMemberSpawnPrompt(
      { name: 'tom', role: 'developer' },
      'signal-ops',
      'signal-ops',
      'lead'
    );

    expect(prompt).toContain(
      'If an assigned task requires implementation, fixes, review follow-up, or concrete investigation, you may inspect, read/search, and edit files in your working directory as needed.'
    );
  });

  it('keeps non-solo lead delegation first while excluding assigned teammates from that restriction', () => {
    const prompt = buildPersistentLeadContext({
      teamName: 'signal-ops',
      leadName: 'lead',
      isSolo: false,
      members: [
        { name: 'lead', role: 'team-lead' },
        { name: 'tom', role: 'developer' },
      ] as TeamCreateRequest['members'],
    });

    expect(prompt).toContain('your top priority as team lead');
    expect(prompt).toContain(
      'This lead-only delegation rule does NOT restrict assigned teammates.'
    );
  });

  it('keeps errored provisioned-but-not-alive members failed in Gemini hydration prompts', () => {
    const prompt = buildPromptWithStatus({
      status: 'error',
      launchState: 'failed_to_start',
      agentToolAccepted: true,
      runtimeAlive: false,
      bootstrapConfirmed: true,
      hardFailure: true,
      hardFailureReason: 'CLI process exited (code 1) - team provisioned but not alive',
      livenessKind: 'confirmed_bootstrap',
      runtimeDiagnostic: 'Runtime process crashed',
      runtimeDiagnosticSeverity: 'error',
      updatedAt: '2026-05-25T20:14:02.147Z',
    });

    expect(prompt).toContain(
      '- @tom: failed to start - CLI process exited (code 1) - team provisioned but not alive'
    );
    expect(prompt).not.toContain('- @tom: bootstrap confirmed');
  });

  it('keeps benign provisioned-but-not-alive members confirmed in Gemini hydration prompts', () => {
    const prompt = buildPromptWithStatus({
      status: 'error',
      launchState: 'failed_to_start',
      agentToolAccepted: true,
      runtimeAlive: false,
      bootstrapConfirmed: true,
      hardFailure: true,
      hardFailureReason: 'CLI process exited (code 1) - team provisioned but not alive',
      livenessKind: 'confirmed_bootstrap',
      runtimeDiagnostic: 'runtime pid could not be verified because process table is unavailable',
      runtimeDiagnosticSeverity: 'warning',
      updatedAt: '2026-05-25T20:14:02.147Z',
    });

    expect(prompt).toContain('- @tom: bootstrap confirmed');
    expect(prompt).not.toContain('- @tom: failed to start');
  });
});

describe('matter dashboard lead instructions', () => {
  const bootstrapSpec: RuntimeBootstrapSpec = {
    version: 1,
    runId: 'run-1',
    mode: 'create',
    initiator: { kind: 'app', source: 'claude_team_agent_teams_orchestrator' },
    team: { name: 'signal-ops', cwd: '/workspace/project' },
    lead: {},
    members: [],
  };

  it('includes the batched propose-and-confirm instruction in the persistent lead context', () => {
    const prompt = buildLeadMatterDashboardInstructions('signal-ops');
    expect(prompt).toContain('Do NOT update the matter dashboard after every task');
    expect(prompt).toContain('matter_get');
    expect(prompt).toContain('matter_propose');
    expect(prompt).toContain('approves or rejects');

    const context = buildPersistentLeadContext({
      teamName: 'signal-ops',
      leadName: 'lead',
      isSolo: false,
      members: [],
    });
    expect(context).toContain('Matter dashboard (MANDATORY');
    expect(context).toContain('matter_propose');
  });

  it('includes the matter instruction in the stock Claude bootstrap prompt', () => {
    const prompt = buildStockClaudeBootstrapPrompt(bootstrapSpec, 'Start here.');
    expect(prompt).toContain('Matter dashboard (MANDATORY)');
    expect(prompt).toContain('matter_propose');
    expect(prompt).toContain('do NOT update it per task');
  });

  it('includes the matter instruction in the codex lead bootstrap prompt', () => {
    const prompt = buildCodexLeadBootstrapPrompt(bootstrapSpec, '');
    expect(prompt).toContain('Matter dashboard (MANDATORY)');
    expect(prompt).toContain('matter_propose');
  });

  it('carries the folder re-scan and conditional initial-scan clauses in the standing instruction', () => {
    const prompt = buildLeadMatterDashboardInstructions('signal-ops');
    expect(prompt).toContain('re-scan the project folder for new or changed case documents');
    expect(prompt).toContain('If matter_get shows an empty dashboard');
    expect(prompt).toContain('perform the initial matter scan');
  });

  it('adds specialist delegation with parallel checks only when the team has teammates', () => {
    const solo = buildLeadMatterDashboardInstructions('signal-ops');
    expect(solo).not.toContain('calendar/calendaring specialist');

    const teamed = buildLeadMatterDashboardInstructions('signal-ops', { hasTeammates: true });
    expect(teamed).toContain('deadline computation and date verification to a calendar/calendaring specialist');
    expect(teamed).toContain('docket confirmation to a docket specialist');
    expect(teamed).toContain('IN PARALLEL');
    expect(teamed).toContain('only you call matter_get/matter_propose');

    const context = buildPersistentLeadContext({
      teamName: 'signal-ops',
      leadName: 'lead',
      isSolo: false,
      members: [
        { name: 'lead', role: 'team-lead' },
        { name: 'calendar-agent', role: 'calendaring' },
      ] as TeamCreateRequest['members'],
    });
    expect(context).toContain('calendar/calendaring specialist');

    const soloContext = buildPersistentLeadContext({
      teamName: 'signal-ops',
      leadName: 'lead',
      isSolo: true,
      members: [] as TeamCreateRequest['members'],
    });
    expect(soloContext).not.toContain('calendar/calendaring specialist');
  });

  it('phrases parallel folder fan-out per runtime spawning rules', () => {
    const spawning = buildLeadInitialMatterScanInstructions('signal-ops', {
      hasTeammates: true,
      canSpawnTeammates: true,
    });
    expect(spawning).toContain('Delegate the scan across your specialists');
    expect(spawning).toContain('spawn additional instances of the same specialist type');
    expect(spawning).toContain('source-intake-a');
    expect(spawning).not.toContain('Do NOT create, replace, or duplicate teammates');

    const laneSafe = buildLeadInitialMatterScanInstructions('signal-ops', {
      hasTeammates: true,
      canSpawnTeammates: false,
    });
    expect(laneSafe).toContain('private subagents');
    expect(laneSafe).toContain('Do NOT create, replace, or duplicate teammates');
    expect(laneSafe).not.toContain('spawn additional instances of the same specialist type');
  });

  it('appends the initial matter scan to bootstrap prompts only when the dashboard is empty', () => {
    const scanMarker = 'Initial matter scan (do this early, alongside team assembly)';
    expect(buildLeadInitialMatterScanInstructions('signal-ops')).toContain('matter_propose');

    expect(buildStockClaudeBootstrapPrompt(bootstrapSpec, '')).not.toContain(scanMarker);
    expect(
      buildStockClaudeBootstrapPrompt(bootstrapSpec, '', { matterNeedsInitialScan: true })
    ).toContain(scanMarker);

    expect(buildCodexLeadBootstrapPrompt(bootstrapSpec, '')).not.toContain(scanMarker);
    expect(
      buildCodexLeadBootstrapPrompt(bootstrapSpec, '', { matterNeedsInitialScan: true })
    ).toContain(scanMarker);
  });

  it('mentions the folder re-scan in the short bootstrap matter blocks', () => {
    expect(buildStockClaudeBootstrapPrompt(bootstrapSpec, '')).toContain(
      're-scan the project folder'
    );
    expect(buildCodexLeadBootstrapPrompt(bootstrapSpec, '')).toContain('re-scan the project folder');
  });
});
