import { MATTER_SKILL_MARKDOWN } from '@features/matter-dashboard/core/domain/matterSkillDefinition';
import { MatterRefreshCoordinator } from '@features/matter-dashboard/main';
import { describe, expect, it, vi } from 'vitest';

function createCoordinator(overrides: {
  empty?: boolean;
  installedMarkdown?: string | null;
  hasTeammates?: boolean;
  canSpawnTeammates?: boolean;
  deliveryError?: Error;
}) {
  const notifyLead = overrides.deliveryError
    ? vi.fn().mockRejectedValue(overrides.deliveryError)
    : vi.fn().mockResolvedValue(undefined);
  const coordinator = new MatterRefreshCoordinator({
    isMatterEmpty: vi.fn().mockResolvedValue(overrides.empty ?? false),
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
