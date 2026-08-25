import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { useDistributedRuntimeSession } from '@features/distributed-agent-teams/renderer/hooks/useDistributedRuntimeSession';
import { api } from '@renderer/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DistributedRuntimeSessionDto,
  GetDistributedRuntimeSessionRequest,
} from '@features/distributed-agent-teams/contracts';

vi.mock('@renderer/api', () => ({
  api: {
    distributedAgentTeams: {
      getRuntimeSession: vi.fn(),
      sendRuntimeControl: vi.fn(),
    },
  },
}));

const scope: GetDistributedRuntimeSessionRequest = {
  teamId: '00000000-0000-4000-8000-000000000001',
  nodeId: '00000000-0000-4000-8000-000000000002',
  assignmentId: '00000000-0000-4000-8000-000000000003',
  attemptId: '00000000-0000-4000-8000-000000000004',
  leaseEpoch: 1,
};

const Harness = ({
  renderVersion,
  request = scope,
}: {
  renderVersion: number;
  request?: GetDistributedRuntimeSessionRequest;
}): React.JSX.Element => {
  const state = useDistributedRuntimeSession({ ...request }, true);
  return <div data-version={renderVersion}>{state.session?.sessionId ?? 'empty'}</div>;
};

const RefreshHarness = (): React.JSX.Element => {
  const state = useDistributedRuntimeSession({ ...scope }, true);
  return (
    <div>
      <span>
        {state.session?.sessionId ?? 'empty'}:{state.session?.nextCursor ?? 0}:
        {state.session?.events.length ?? 0}
      </span>
      <button type="button" onClick={() => void state.refresh()}>
        Poll
      </button>
    </div>
  );
};

const sessionFor = (
  request: GetDistributedRuntimeSessionRequest,
  sessionId: string
): DistributedRuntimeSessionDto => ({
  sessionId,
  scope: { ...request, leaseId: '00000000-0000-4000-8000-000000000005' },
  capabilities: ['events.read'],
  expiresAt: '2099-08-24T09:00:00.000Z',
  events: [],
  truncated: false,
  nextCursor: 0,
});

describe('useDistributedRuntimeSession', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.mocked(api.distributedAgentTeams.getRuntimeSession).mockResolvedValue({
      sessionId: '00000000-0000-4000-8000-000000000006',
      scope: { ...scope, leaseId: '00000000-0000-4000-8000-000000000005' },
      capabilities: ['events.read'],
      expiresAt: '2099-08-24T09:00:00.000Z',
      events: [],
      truncated: false,
      nextCursor: 0,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the session mounted when polling rebuilds an equivalent lease request', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Harness renderVersion={1} />);
      await Promise.resolve();
    });
    expect(host.textContent).toBe('00000000-0000-4000-8000-000000000006');
    expect(api.distributedAgentTeams.getRuntimeSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<Harness renderVersion={2} />);
      await Promise.resolve();
    });
    expect(host.textContent).toBe('00000000-0000-4000-8000-000000000006');
    expect(api.distributedAgentTeams.getRuntimeSession).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    host.remove();
  });

  it('ignores a previous worker poll that resolves after the selected scope changes', async () => {
    const nextScope: GetDistributedRuntimeSessionRequest = {
      ...scope,
      nodeId: '00000000-0000-4000-8000-000000000012',
      assignmentId: '00000000-0000-4000-8000-000000000013',
      attemptId: '00000000-0000-4000-8000-000000000014',
    };
    let resolvePrevious!: (value: DistributedRuntimeSessionDto) => void;
    let resolveNext!: (value: DistributedRuntimeSessionDto) => void;
    vi.mocked(api.distributedAgentTeams.getRuntimeSession).mockImplementation(
      (request) =>
        new Promise((resolve) => {
          if (request.nodeId === nextScope.nodeId) resolveNext = resolve;
          else resolvePrevious = resolve;
        })
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness renderVersion={1} request={scope} />);
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<Harness renderVersion={2} request={nextScope} />);
      await Promise.resolve();
    });
    await act(async () => {
      resolveNext(sessionFor(nextScope, '00000000-0000-4000-8000-000000000016'));
      await Promise.resolve();
    });
    expect(host.textContent).toBe('00000000-0000-4000-8000-000000000016');

    await act(async () => {
      resolvePrevious(sessionFor(scope, '00000000-0000-4000-8000-000000000006'));
      await Promise.resolve();
    });
    expect(host.textContent).toBe('00000000-0000-4000-8000-000000000016');

    await act(async () => root.unmount());
    host.remove();
  });

  it('restarts the event cursor when the Relay rotates the runtime session', async () => {
    const firstSessionId = '00000000-0000-4000-8000-000000000006';
    const nextSessionId = '00000000-0000-4000-8000-000000000026';
    const rotatedEvent: DistributedRuntimeSessionDto['events'][number] = {
      cursor: 1,
      eventId: '00000000-0000-4000-8000-000000000027',
      sequence: 1,
      scope: {
        ...scope,
        leaseId: '00000000-0000-4000-8000-000000000005',
      },
      sessionId: nextSessionId,
      occurredAt: '2026-08-24T08:00:00.000Z',
      receivedAt: '2026-08-24T08:00:00.001Z',
      event: {
        kind: 'control.result',
        payload: { controlId: '00000000-0000-4000-8000-000000000028', ok: true },
      },
    };
    vi.mocked(api.distributedAgentTeams.getRuntimeSession)
      .mockReset()
      .mockResolvedValueOnce({ ...sessionFor(scope, firstSessionId), nextCursor: 8 })
      .mockResolvedValueOnce({ ...sessionFor(scope, nextSessionId), nextCursor: 1 })
      .mockResolvedValueOnce({
        ...sessionFor(scope, nextSessionId),
        events: [rotatedEvent],
        nextCursor: 1,
      });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<RefreshHarness />);
      await Promise.resolve();
    });
    expect(host.textContent).toContain(`${firstSessionId}:8:0`);

    const pollButton = host.querySelector('button');
    await act(async () => {
      pollButton?.click();
      await Promise.resolve();
    });
    expect(api.distributedAgentTeams.getRuntimeSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ afterCursor: 8 })
    );
    expect(host.textContent).toContain(`${nextSessionId}:0:0`);

    await act(async () => {
      pollButton?.click();
      await Promise.resolve();
    });
    expect(api.distributedAgentTeams.getRuntimeSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ afterCursor: 0 })
    );
    expect(host.textContent).toContain(`${nextSessionId}:1:1`);

    await act(async () => root.unmount());
    host.remove();
  });
});
