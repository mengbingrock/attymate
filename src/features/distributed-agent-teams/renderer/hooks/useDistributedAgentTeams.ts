import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@renderer/api';

import type {
  DistributedAssignmentEventsDto,
  DistributedDebugSnapshotDto,
  DistributedTopologyDto,
} from '../../contracts';

const POLL_INTERVAL_MS = 2_000;

interface DistributedAgentTeamsState {
  topology: DistributedTopologyDto | null;
  assignmentEvents: DistributedAssignmentEventsDto | null;
  debugSnapshot: DistributedDebugSnapshotDto | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useDistributedAgentTeams(
  isActive: boolean,
  options: { includeDebug?: boolean } = {}
): DistributedAgentTeamsState {
  const [topology, setTopology] = useState<DistributedTopologyDto | null>(null);
  const [assignmentEvents, setAssignmentEvents] = useState<DistributedAssignmentEventsDto | null>(
    null
  );
  const [debugSnapshot, setDebugSnapshot] = useState<DistributedDebugSnapshotDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const requestSequence = ++requestSequenceRef.current;
    setRefreshing(true);

    try {
      const [nextTopology, nextAssignmentEvents, nextDebugSnapshot] = await Promise.all([
        api.distributedAgentTeams.getTopology(),
        api.distributedAgentTeams.getAssignmentEvents(),
        options.includeDebug
          ? api.distributedAgentTeams.getDebugSnapshot()
          : Promise.resolve<DistributedDebugSnapshotDto | null>(null),
      ]);

      if (requestSequence !== requestSequenceRef.current) return;
      setTopology(nextTopology);
      setAssignmentEvents(nextAssignmentEvents);
      if (options.includeDebug) setDebugSnapshot(nextDebugSnapshot);
      setError(null);
    } catch (requestError) {
      if (requestSequence !== requestSequenceRef.current) return;
      setError(
        requestError instanceof Error ? requestError.message : 'Unable to load relay state.'
      );
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [options.includeDebug]);

  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;
    let timeout: number | undefined;
    const poll = async (): Promise<void> => {
      await refresh();
      if (!cancelled) timeout = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    void poll();

    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
      requestSequenceRef.current += 1;
      setRefreshing(false);
    };
  }, [isActive, refresh]);

  return {
    topology,
    assignmentEvents,
    debugSnapshot,
    loading,
    refreshing,
    error,
    refresh,
  };
}
