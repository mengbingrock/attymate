import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { useDistributedAgentTeams } from '@features/distributed-agent-teams/renderer/hooks/useDistributedAgentTeams';
import { api } from '@renderer/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/api', () => ({
  api: {
    distributedAgentTeams: {
      getTopology: vi.fn(),
      getAssignmentEvents: vi.fn(),
      getDebugSnapshot: vi.fn(),
    },
  },
}));

const Harness = (): React.JSX.Element => {
  const state = useDistributedAgentTeams(true, { includeDebug: true });
  return <div>{state.refreshing ? 'refreshing' : 'ready'}</div>;
};

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('useDistributedAgentTeams', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for a remote poll to finish before scheduling the next poll', async () => {
    const topology = {
      relayUrl: 'https://relay.example',
      insecureLanMode: false,
      workers: [],
      membershipRoutes: [],
      fetchedAt: '2026-09-03T10:00:00.000Z',
      degraded: false,
    };
    const assignmentEvents = {
      events: [],
      fetchedAt: '2026-09-03T10:00:00.000Z',
      degraded: false,
    };
    const debugSnapshot = {
      relayUrl: 'https://relay.example',
      commands: [],
      events: [],
      leases: [],
      membershipRoutes: [],
      fetchedAt: '2026-09-03T10:00:00.000Z',
      degraded: false,
    };
    const topologyPoll = deferred<typeof topology>();
    const assignmentPoll = deferred<typeof assignmentEvents>();
    const debugPoll = deferred<typeof debugSnapshot>();
    vi.mocked(api.distributedAgentTeams.getTopology)
      .mockReturnValueOnce(topologyPoll.promise)
      .mockResolvedValue(topology);
    vi.mocked(api.distributedAgentTeams.getAssignmentEvents)
      .mockReturnValueOnce(assignmentPoll.promise)
      .mockResolvedValue(assignmentEvents);
    vi.mocked(api.distributedAgentTeams.getDebugSnapshot)
      .mockReturnValueOnce(debugPoll.promise)
      .mockResolvedValue(debugSnapshot);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(api.distributedAgentTeams.getTopology).toHaveBeenCalledTimes(1);
    expect(api.distributedAgentTeams.getAssignmentEvents).toHaveBeenCalledTimes(1);
    expect(api.distributedAgentTeams.getDebugSnapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      topologyPoll.resolve(topology);
      assignmentPoll.resolve(assignmentEvents);
      debugPoll.resolve(debugSnapshot);
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(api.distributedAgentTeams.getTopology).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(api.distributedAgentTeams.getTopology).toHaveBeenCalledTimes(2);
    expect(api.distributedAgentTeams.getAssignmentEvents).toHaveBeenCalledTimes(2);
    expect(api.distributedAgentTeams.getDebugSnapshot).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    host.remove();
  });
});
