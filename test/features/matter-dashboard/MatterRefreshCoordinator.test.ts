import { MATTER_SKILL_MARKDOWN } from '@features/matter-dashboard/core/domain/matterSkillDefinition';
import { MatterRefreshCoordinator } from '@features/matter-dashboard/main';
import { describe, expect, it, vi } from 'vitest';

function createCoordinator(overrides: {
  empty?: boolean;
  installedMarkdown?: string | null;
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
    readInstalledSkillMarkdown: vi
      .fn()
      .mockResolvedValue(
        overrides.installedMarkdown === undefined ? null : overrides.installedMarkdown
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

  it('sends the user edited skill file when one is installed', async () => {
    const installedMarkdown =
      '---\nname: matter-dashboard\ndescription: mine\n---\n\nFIRM HOUSE RULES\n';
    const { coordinator, notifyLead } = createCoordinator({ installedMarkdown });

    const result = await coordinator.requestRefresh({
      teamName: 'my-team',
      trigger: 'user-refresh',
    });

    expect(result.usedInstalledSkill).toBe(true);
    expect(notifyLead.mock.calls[0][2]).toContain('FIRM HOUSE RULES');
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

  it('falls back to the bundled skill when the file is missing or unreadable', async () => {
    const { coordinator, notifyLead } = createCoordinator({ installedMarkdown: null });

    const result = await coordinator.requestRefresh({
      teamName: 'my-team',
      trigger: 'user-refresh',
    });

    expect(result.usedInstalledSkill).toBe(false);
    expect(notifyLead.mock.calls[0][2]).toContain(
      MATTER_SKILL_MARKDOWN.split('\n').find((line) => line.startsWith('# Matter dashboard'))!
    );
  });
});
