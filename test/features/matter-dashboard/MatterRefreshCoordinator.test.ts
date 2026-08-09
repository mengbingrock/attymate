import { MATTER_SKILL_MARKDOWN } from '@features/matter-dashboard/core/domain/matterSkillDefinition';
import { MatterRefreshCoordinator } from '@features/matter-dashboard/main';
import { describe, expect, it, vi } from 'vitest';

import type { EnsuredTeamMatterSkill } from '@features/matter-dashboard/main';

const TEAM_SKILL_DIR = '/app-data/skills/teams/my-team/matter-dashboard';
const TEAM_SKILL_FILE = `${TEAM_SKILL_DIR}/SKILL.md`;

/** What the provisioner hands back once the team's own copy is on disk. */
function teamSkill(markdown = MATTER_SKILL_MARKDOWN): EnsuredTeamMatterSkill {
  return {
    filePath: TEAM_SKILL_FILE,
    skillDir: TEAM_SKILL_DIR,
    markdown,
    source: 'seeded-from-bundled',
  };
}

function createCoordinator(overrides: {
  empty?: boolean;
  /** Undefined keeps the default prepared copy; null means none could be made. */
  ensuredSkill?: EnsuredTeamMatterSkill | null;
  hasTeammates?: boolean;
  canSpawnTeammates?: boolean;
  deliveryError?: Error;
  matters?: Array<{ id: string; caption?: string; status?: string }>;
  linkedMatterIds?: string[];
}) {
  const notifyLead = overrides.deliveryError
    ? vi.fn().mockRejectedValue(overrides.deliveryError)
    : vi.fn().mockResolvedValue(undefined);
  // Default snapshot: one linked matter whose content matches `empty`.
  const matters = (
    overrides.matters ??
    (overrides.empty
      ? [{ id: 'm-1' }]
      : [{ id: 'm-1', caption: 'Smith v. Jones', status: 'Active' }])
  ).map((matter) => ({ schemaVersion: 2 as const, ...matter }));
  const linkedMatterIds = overrides.linkedMatterIds ?? matters.map((matter) => matter.id);
  const coordinator = new MatterRefreshCoordinator({
    readSnapshot: vi.fn().mockResolvedValue({ matters, linkedMatterIds, proposal: null }),
    resolveRuntimeFacts: vi.fn().mockResolvedValue({
      projectPath: '/cases/1234567',
      hasTeammates: overrides.hasTeammates ?? true,
      canSpawnTeammates: overrides.canSpawnTeammates ?? true,
    }),
    ensureTeamSkill: vi
      .fn()
      .mockResolvedValue(
        overrides.ensuredSkill === undefined ? teamSkill() : overrides.ensuredSkill
      ),
    leadNotifier: { notifyLead },
  });
  return { coordinator, notifyLead };
}

describe('MatterRefreshCoordinator', () => {
  it('asks for an initial scan when the dashboard is empty', async () => {
    const { coordinator, notifyLead } = createCoordinator({ empty: true });

    const result = await coordinator.requestRefresh({
      teamName: 'my-team',
      trigger: 'user-refresh',
    });

    expect(result).toMatchObject({ accepted: true, mode: 'initial-scan' });
    expect(notifyLead).toHaveBeenCalledTimes(1);
    const [teamName, summary, text] = notifyLead.mock.calls[0];
    expect(teamName).toBe('my-team');
    expect(summary).toBe('Scan the case folder');
    expect(text).toContain('INITIAL SCAN');
  });

  it('asks for an update when the dashboard already has content', async () => {
    const { coordinator, notifyLead } = createCoordinator({ empty: false });

    const result = await coordinator.requestRefresh({
      teamName: 'my-team',
      trigger: 'job-wrap-up',
      completedTaskLabel: 'Task 4 "File the motion"',
    });

    expect(result.mode).toBe('update');
    expect(notifyLead.mock.calls[0][2]).toContain('Task 4 "File the motion"');
    // The sole linked matter is named so the lead targets it explicitly.
    expect(notifyLead.mock.calls[0][2]).toContain('matterId: m-1');
  });

  it('tells a multi-matter team to pick the matter via matter_get', async () => {
    const { coordinator, notifyLead } = createCoordinator({
      matters: [
        { id: 'm-1', caption: 'First v. Case', status: 'Active' },
        { id: 'm-2', caption: 'Second v. Case', status: 'Active' },
      ],
    });

    await coordinator.requestRefresh({ teamName: 'my-team', trigger: 'job-wrap-up' });
    expect(notifyLead.mock.calls[0][2]).toContain('pick the matter this work belongs to');

    // An explicit matterId from the dashboard pins the target instead.
    await coordinator.requestRefresh({
      teamName: 'my-team',
      trigger: 'user-refresh',
      matterId: 'm-2',
    });
    expect(notifyLead.mock.calls[1][2]).toContain('matterId: m-2');
    expect(notifyLead.mock.calls[1][2]).toContain('"Second v. Case"');
  });

  it('tells a matterless team its proposal will create the matter', async () => {
    const { coordinator, notifyLead } = createCoordinator({
      matters: [],
      linkedMatterIds: [],
    });

    const result = await coordinator.requestRefresh({
      teamName: 'my-team',
      trigger: 'user-refresh',
    });

    expect(result.mode).toBe('initial-scan');
    expect(notifyLead.mock.calls[0][2]).toContain('your matter_propose will create one');
  });

  it("points the lead at this team's own copy of the skill", async () => {
    const { coordinator, notifyLead } = createCoordinator({});

    const result = await coordinator.requestRefresh({
      teamName: 'my-team',
      trigger: 'user-refresh',
    });

    expect(result.usedInstalledSkill).toBe(true);
    expect(notifyLead.mock.calls[0][2]).toContain(`Skill file: ${TEAM_SKILL_FILE}`);
    // Referenced, not pasted: the team's copy stays the authoritative text.
    expect(notifyLead.mock.calls[0][2]).not.toContain('--- matter-dashboard skill ---');
  });

  it("appends the current schema when the team's copy has drifted", async () => {
    const edited = `${MATTER_SKILL_MARKDOWN}\n\n## Firm house rules\nAlways cite the docket.\n`;
    const { coordinator, notifyLead } = createCoordinator({
      ensuredSkill: { ...teamSkill(edited), source: 'team' },
    });

    await coordinator.requestRefresh({ teamName: 'my-team', trigger: 'user-refresh' });

    expect(notifyLead.mock.calls[0][2]).toContain(
      'Authoritative section schema for this app version'
    );
  });

  it('explains an undeliverable request instead of throwing at the dashboard', async () => {
    const { coordinator } = createCoordinator({
      deliveryError: new Error('Unknown to: team-lead. Use a configured team member name.'),
    });

    const result = await coordinator.requestRefresh({
      teamName: 'never-launched',
      trigger: 'user-refresh',
    });

    expect(result.accepted).toBe(false);
    expect(result.message).toContain('Launch the team first');
  });

  it("inlines the bundled skill when the team's copy could not be prepared", async () => {
    const { coordinator, notifyLead } = createCoordinator({ ensuredSkill: null });

    const result = await coordinator.requestRefresh({
      teamName: 'my-team',
      trigger: 'user-refresh',
    });

    expect(result.usedInstalledSkill).toBe(false);
    expect(notifyLead.mock.calls[0][2]).not.toContain('Skill file:');
    expect(notifyLead.mock.calls[0][2]).toContain(
      MATTER_SKILL_MARKDOWN.split('\n').find((line) => line.startsWith('# Matter dashboard'))!
    );
  });
});
