import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { RemoteRuntimeConsole } from '@features/distributed-agent-teams/renderer/ui/RemoteRuntimeConsole';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DistributedRuntimeSessionDto } from '@features/distributed-agent-teams/contracts';

const scope = {
  teamId: '00000000-0000-4000-8000-000000000001',
  nodeId: '00000000-0000-4000-8000-000000000002',
  assignmentId: '00000000-0000-4000-8000-000000000003',
  attemptId: '00000000-0000-4000-8000-000000000004',
  leaseId: '00000000-0000-4000-8000-000000000005',
  leaseEpoch: 1,
};

const session: DistributedRuntimeSessionDto = {
  sessionId: '00000000-0000-4000-8000-000000000006',
  scope,
  capabilities: ['events.read', 'turn.steer', 'approval.resolve', 'filesystem.read'],
  expiresAt: '2026-08-24T09:00:00.000Z',
  truncated: false,
  nextCursor: 4,
  events: [
    {
      cursor: 1,
      eventId: '00000000-0000-4000-8000-000000000007',
      sequence: 1,
      scope,
      occurredAt: '2026-08-24T08:00:00.000Z',
      receivedAt: '2026-08-24T08:00:00.001Z',
      event: {
        kind: 'runtime.snapshot',
        payload: {
          binding: {
            state: 'active',
            threadId: 'thr_remote',
            turnId: 'turn_remote',
            appServerGeneration: 2,
          },
        },
      },
    },
    {
      cursor: 2,
      eventId: '00000000-0000-4000-8000-000000000008',
      sequence: 2,
      scope,
      occurredAt: '2026-08-24T08:00:01.000Z',
      receivedAt: '2026-08-24T08:00:01.001Z',
      event: {
        kind: 'app-server.notification',
        payload: { method: 'item/agentMessage/delta', params: { delta: 'Remote answer' } },
      },
    },
    {
      cursor: 3,
      eventId: '00000000-0000-4000-8000-000000000009',
      sequence: 3,
      scope,
      occurredAt: '2026-08-24T08:00:02.000Z',
      receivedAt: '2026-08-24T08:00:02.001Z',
      event: {
        kind: 'app-server.request',
        payload: {
          id: 42,
          method: 'item/commandExecution/requestApproval',
          params: { command: 'pnpm test' },
        },
      },
    },
    {
      cursor: 4,
      eventId: '00000000-0000-4000-8000-000000000010',
      sequence: 4,
      scope,
      occurredAt: '2026-08-24T08:00:02.000Z',
      receivedAt: '2026-08-24T08:00:02.002Z',
      event: {
        kind: 'app-server.request',
        payload: {
          id: 42,
          method: 'item/commandExecution/requestApproval',
          params: { command: 'pnpm test' },
        },
      },
    },
  ],
};

const setTextareaValue = (textarea: HTMLTextAreaElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('HTMLTextAreaElement value setter is unavailable');
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('RemoteRuntimeConsole', () => {
  beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('explains that Start team is required before claiming a live App Server session', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <RemoteRuntimeConsole
          session={null}
          insecureLanMode={false}
          loading={false}
          sending={false}
          error={null}
          onRefresh={vi.fn()}
          onControl={vi.fn()}
        />
      );
    });

    expect(host.textContent).toContain('Worker runtime is not active yet');
    expect(host.textContent).toContain('Start the team');
    expect(host.textContent).not.toContain('Authenticated Codex App Server session');
    await act(async () => root.unmount());
    host.remove();
  });

  it('renders a Codex transcript without protocol noise and sends lease-bound controls', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onControl = vi.fn(async (control) => ({
      accepted: true as const,
      controlId: control.controlId,
    }));
    await act(async () => {
      root.render(
        <RemoteRuntimeConsole
          session={session}
          insecureLanMode={false}
          loading={false}
          sending={false}
          error={null}
          onRefresh={vi.fn()}
          onControl={onControl}
        />
      );
    });

    expect(host.querySelector('[aria-label="Authenticated remote Codex session"]')).not.toBeNull();
    expect(host.textContent).toContain('Remote answer');
    expect(host.textContent).toContain('Run this command?');
    expect(host.textContent).toContain('pnpm test');
    expect(host.textContent).toContain('Files');
    expect(host.textContent).not.toContain('app-server.notification');
    expect(host.textContent).not.toContain('item/agentMessage/delta');
    expect(host.textContent).not.toContain('item/commandExecution/requestApproval');
    expect(
      [...host.querySelectorAll('button')].filter((button) =>
        button.textContent?.includes('Approve once')
      )
    ).toHaveLength(1);

    const textarea = host.querySelector<HTMLTextAreaElement>('textarea');
    await act(async () => {
      if (textarea !== null) {
        setTextareaValue(textarea, 'Continue remotely');
      }
    });
    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    expect(onControl).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'turn.steer',
        payload: expect.objectContaining({
          threadId: 'thr_remote',
          expectedTurnId: 'turn_remote',
          appServerGeneration: 2,
        }),
      })
    );
    expect(host.textContent).toContain('Continue remotely');
    expect(host.textContent).toContain('Waiting for worker…');
    const steerControlId = onControl.mock.calls[0]?.[0].controlId as string;
    await act(async () => {
      root.render(
        <RemoteRuntimeConsole
          session={{
            ...session,
            nextCursor: 5,
            events: [
              ...session.events,
              {
                cursor: 5,
                eventId: '00000000-0000-4000-8000-000000000017',
                sequence: 5,
                scope,
                sessionId: session.sessionId,
                occurredAt: '2026-08-24T08:00:03.000Z',
                receivedAt: '2026-08-24T08:00:03.001Z',
                event: {
                  kind: 'control.result',
                  payload: { controlId: steerControlId, ok: true },
                },
              },
            ],
          }}
          insecureLanMode={false}
          loading={false}
          sending={false}
          error={null}
          onRefresh={vi.fn()}
          onControl={onControl}
        />
      );
    });
    expect(host.textContent).not.toContain('Waiting for worker…');
    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(textarea?.value).toBe('Continue remotely');
    expect(host.textContent).toContain('Enter sends · Shift+Enter adds a line · ↑/↓ recalls input');

    const approveButton = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Approve once')
    );
    await act(async () => approveButton?.click());
    expect(onControl).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'approval.resolve',
        payload: { approvalRequestId: 42, decision: 'accept' },
      })
    );
    await act(async () => root.unmount());
    host.remove();
  });

  it('disables controls that the negotiated runtime capability does not grant', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <RemoteRuntimeConsole
          session={{ ...session, capabilities: ['events.read'] }}
          insecureLanMode={false}
          loading={false}
          sending={false}
          error={null}
          onRefresh={vi.fn()}
          onControl={vi.fn()}
        />
      );
    });

    const expectDisabledButton = (label: string): void => {
      const button = [...host.querySelectorAll('button')].find(
        (candidate) =>
          candidate.textContent?.includes(label) || candidate.getAttribute('aria-label') === label
      );
      expect(button, label).toBeDefined();
      expect(button?.disabled, label).toBe(true);
    };
    for (const label of ['Approve once', 'Deny', 'Interrupt', 'Send input']) {
      expectDisabledButton(label);
    }

    const changesTab = [...host.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Changes')
    );
    await act(async () =>
      changesTab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    );
    expectDisabledButton('Review uncommitted changes');

    const filesTab = [...host.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes('Files')
    );
    await act(async () =>
      filesTab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    );
    expectDisabledButton('Open');
    expectDisabledButton('Save');

    await act(async () => root.unmount());
    host.remove();
  });

  it('starts a continuation turn when the previous turn has completed', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onControl = vi.fn(async (control) => ({
      accepted: true as const,
      controlId: control.controlId,
    }));
    const completedSession: DistributedRuntimeSessionDto = {
      ...session,
      capabilities: ['events.read', 'turn.start'],
      events: session.events.map((event) =>
        event.event.kind === 'runtime.snapshot'
          ? {
              ...event,
              event: {
                kind: 'runtime.snapshot' as const,
                payload: {
                  binding: {
                    state: 'completed',
                    threadId: 'thr_remote',
                    turnId: 'turn_remote',
                    appServerGeneration: 2,
                  },
                },
              },
            }
          : event
      ),
    };
    await act(async () => {
      root.render(
        <RemoteRuntimeConsole
          session={completedSession}
          insecureLanMode={false}
          loading={false}
          sending={false}
          error={null}
          onRefresh={vi.fn()}
          onControl={onControl}
        />
      );
    });

    const textarea = host.querySelector<HTMLTextAreaElement>('textarea');
    await act(async () => {
      if (textarea !== null) setTextareaValue(textarea, 'Continue in a new turn');
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    expect(onControl).toHaveBeenCalledWith({
      controlId: expect.any(String),
      type: 'turn.start',
      payload: {
        threadId: 'thr_remote',
        appServerGeneration: 2,
        message: 'Continue in a new turn',
      },
    });

    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps input pending until the worker confirms it and exposes a retry on failure', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onControl = vi.fn(async (control) => ({
      accepted: true as const,
      controlId: control.controlId,
    }));
    const completedSession: DistributedRuntimeSessionDto = {
      ...session,
      capabilities: ['events.read', 'turn.start'],
      events: session.events.map((event) =>
        event.event.kind === 'runtime.snapshot'
          ? {
              ...event,
              event: {
                kind: 'runtime.snapshot' as const,
                payload: {
                  binding: {
                    state: 'completed',
                    threadId: 'thr_remote',
                    turnId: 'turn_remote',
                    appServerGeneration: 2,
                  },
                },
              },
            }
          : event
      ),
    };
    await act(async () => {
      root.render(
        <RemoteRuntimeConsole
          session={completedSession}
          insecureLanMode={false}
          loading={false}
          sending={false}
          error={null}
          onRefresh={vi.fn()}
          onControl={onControl}
        />
      );
    });

    const textarea = host.querySelector<HTMLTextAreaElement>('textarea');
    await act(async () => {
      if (textarea !== null) setTextareaValue(textarea, 'Will the worker answer?');
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Waiting for worker…');
    expect(textarea?.disabled).toBe(true);
    const controlId = onControl.mock.calls[0]?.[0].controlId as string;

    const rejectedSession: DistributedRuntimeSessionDto = {
      ...completedSession,
      nextCursor: 5,
      events: [
        ...completedSession.events,
        {
          cursor: 5,
          eventId: '00000000-0000-4000-8000-000000000015',
          sequence: 5,
          scope,
          sessionId: completedSession.sessionId,
          occurredAt: '2026-08-24T08:00:03.000Z',
          receivedAt: '2026-08-24T08:00:03.001Z',
          event: {
            kind: 'control.result',
            payload: {
              controlId,
              ok: false,
              error: 'Codex runtime start precondition does not match the completed turn',
            },
          },
        },
      ],
    };
    await act(async () => {
      root.render(
        <RemoteRuntimeConsole
          session={rejectedSession}
          insecureLanMode={false}
          loading={false}
          sending={false}
          error={null}
          onRefresh={vi.fn()}
          onControl={onControl}
        />
      );
    });
    expect(host.textContent).toContain(
      'Not delivered — Codex runtime start precondition does not match the completed turn'
    );
    expect(textarea?.disabled).toBe(false);

    const retryButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Retry'
    );
    await act(async () => {
      retryButton?.click();
      await Promise.resolve();
    });
    expect(onControl).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Waiting for worker…');
    expect(host.textContent).not.toContain('Not delivered —');

    await act(async () => root.unmount());
    host.remove();
  });

  it('does not carry locally submitted prompts into another worker scope', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onControl = vi.fn(async (control) => ({
      accepted: true as const,
      controlId: control.controlId,
    }));
    await act(async () => {
      root.render(
        <RemoteRuntimeConsole
          session={session}
          insecureLanMode={false}
          loading={false}
          sending={false}
          error={null}
          onRefresh={vi.fn()}
          onControl={onControl}
        />
      );
    });
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea');
    await act(async () => {
      if (textarea !== null) setTextareaValue(textarea, 'Only Atlas should see this');
      textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });
    expect(host.textContent).toContain('Only Atlas should see this');

    const otherScope = {
      ...scope,
      nodeId: '00000000-0000-4000-8000-000000000022',
      assignmentId: '00000000-0000-4000-8000-000000000023',
      attemptId: '00000000-0000-4000-8000-000000000024',
      leaseId: '00000000-0000-4000-8000-000000000025',
    };
    await act(async () => {
      root.render(
        <RemoteRuntimeConsole
          session={{ ...session, scope: otherScope }}
          insecureLanMode={false}
          loading={false}
          sending={false}
          error={null}
          onRefresh={vi.fn()}
          onControl={onControl}
        />
      );
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain('Only Atlas should see this');

    await act(async () => root.unmount());
    host.remove();
  });
});
