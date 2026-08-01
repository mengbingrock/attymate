import { describe, expect, it, vi } from 'vitest';

import { TeamDataService } from '../../../../src/main/services/team/TeamDataService';

import type { TeamTask } from '../../../../src/shared/types/team';

function makeTask(overrides: Partial<TeamTask> & { id: string }): TeamTask {
  return {
    subject: `Task ${overrides.id}`,
    status: 'completed',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T11:00:00.000Z',
    ...overrides,
  } as TeamTask;
}

const RECENT_TIMESTAMP = new Date(Date.now() - 60_000).toISOString();
const STALE_TIMESTAMP = new Date(Date.now() - 60 * 60_000).toISOString();

function completedTask(id: string, timestamp = RECENT_TIMESTAMP): TeamTask {
  return makeTask({
    id,
    status: 'completed',
    historyEvents: [
      {
        type: 'status_changed',
        from: 'in_progress',
        to: 'completed',
        actor: 'alice',
        timestamp,
      },
    ],
  } as Partial<TeamTask> & { id: string });
}

function createService(
  tasks: TeamTask[],
  configMembers?: { name: string; agentType?: string; role?: string }[]
): TeamDataService {
  const configReader = configMembers
    ? { getConfig: vi.fn().mockResolvedValue({ name: 'my-team', members: configMembers }) }
    : // configReader intentionally empty: resolveLeadName falls back to 'team-lead'.
      {};
  return new TeamDataService(
    configReader as never,
    { getTasks: vi.fn().mockResolvedValue(tasks) } as never,
    {
      listInboxNames: vi.fn().mockResolvedValue([]),
      getMessages: vi.fn().mockResolvedValue([]),
    } as never,
    {} as never,
    {} as never,
    { resolveMembers: vi.fn(() => []) } as never,
    {
      getState: vi.fn().mockResolvedValue({ teamName: 'my-team', reviewers: [], tasks: {} }),
    } as never,
    {} as never,
    { getMembers: vi.fn().mockResolvedValue([]) } as never,
    { readMessages: vi.fn().mockResolvedValue([]) } as never
  );
}

function spyOnSendMessage(service: TeamDataService) {
  return vi
    .spyOn(service, 'sendMessage')
    .mockResolvedValue({ delivered: true } as never);
}

describe('TeamDataService.notifyLeadOnJobWrapUp', () => {
  it('nudges the lead once when the last active task completes', async () => {
    const service = createService([completedTask('t1')]);
    const sendSpy = spyOnSendMessage(service);

    await service.notifyLeadOnJobWrapUp('my-team', 't1');

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [teamName, request] = sendSpy.mock.calls[0];
    expect(teamName).toBe('my-team');
    expect(request.member).toBe('team-lead');
    expect(request.source).toBe('system_notification');
    expect(request.text).toContain('matter dashboard');
    expect(request.text).toContain('matter_get');
    expect(request.text).toContain('matter_propose');
    expect(request.text).toContain('re-scan the project folder');
    // Solo (no config roster): no delegation guidance.
    expect(request.text).not.toContain('calendar specialist');
  });

  it('tells a teamed lead to delegate verification to specialists in parallel', async () => {
    const service = createService(
      [completedTask('t1')],
      [
        { name: 'team-lead', agentType: 'team-lead' },
        { name: 'calendar-agent', role: 'Litigation Calendar Proposal Specialist' },
        { name: 'docket-agent', role: 'Court Docket Review Specialist' },
      ]
    );
    const sendSpy = spyOnSendMessage(service);

    await service.notifyLeadOnJobWrapUp('my-team', 't1');

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, request] = sendSpy.mock.calls[0];
    expect(request.member).toBe('team-lead');
    expect(request.text).toContain('calendar specialist');
    expect(request.text).toContain('docket specialist');
    expect(request.text).toContain('in parallel');
  });

  it('dedups repeated file events for the same completion transition', async () => {
    const service = createService([completedTask('t1')]);
    const sendSpy = spyOnSendMessage(service);

    await service.notifyLeadOnJobWrapUp('my-team', 't1');
    await service.notifyLeadOnJobWrapUp('my-team', 't1');

    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('stays silent while other tasks are still active', async () => {
    const service = createService([
      completedTask('t1'),
      makeTask({ id: 't2', status: 'in_progress' }),
    ]);
    const sendSpy = spyOnSendMessage(service);

    await service.notifyLeadOnJobWrapUp('my-team', 't1');

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('stays silent when pending tasks remain', async () => {
    const service = createService([completedTask('t1'), makeTask({ id: 't2', status: 'pending' })]);
    const sendSpy = spyOnSendMessage(service);

    await service.notifyLeadOnJobWrapUp('my-team', 't1');

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('ignores tasks whose last history event is not a completed transition', async () => {
    const service = createService([
      makeTask({
        id: 't1',
        status: 'in_progress',
        historyEvents: [
          {
            type: 'status_changed',
            from: 'pending',
            to: 'in_progress',
            actor: 'alice',
            timestamp: '2026-08-01T11:00:00.000Z',
          },
        ],
      } as Partial<TeamTask> & { id: string }),
    ]);
    const sendSpy = spyOnSendMessage(service);

    await service.notifyLeadOnJobWrapUp('my-team', 't1');

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('nudges for user-actor completions too (manual UI drag)', async () => {
    const task = makeTask({
      id: 't1',
      status: 'completed',
      historyEvents: [
        {
          type: 'status_changed',
          from: 'in_progress',
          to: 'completed',
          actor: 'user',
          timestamp: RECENT_TIMESTAMP,
        },
      ],
    } as Partial<TeamTask> & { id: string });
    const service = createService([task]);
    const sendSpy = spyOnSendMessage(service);

    await service.notifyLeadOnJobWrapUp('my-team', 't1');

    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('skips stale completions replayed by the boot-time watcher scan', async () => {
    const service = createService([completedTask('t1', STALE_TIMESTAMP)]);
    const sendSpy = spyOnSendMessage(service);

    await service.notifyLeadOnJobWrapUp('my-team', 't1');

    expect(sendSpy).not.toHaveBeenCalled();
  });
});
