import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';

import type {
  DistributedRuntimeControlReceiptDto,
  DistributedRuntimeSessionDto,
  GetDistributedRuntimeSessionRequest,
  SendDistributedRuntimeControlRequest,
} from '../../contracts';

const POLL_INTERVAL_MS = 750;
const MAX_RENDERER_EVENTS = 500;

export interface DistributedRuntimeSessionState {
  session: DistributedRuntimeSessionDto | null;
  loading: boolean;
  sending: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  sendControl: (
    control: SendDistributedRuntimeControlRequest['control']
  ) => Promise<DistributedRuntimeControlReceiptDto>;
}

export function useDistributedRuntimeSession(
  request: GetDistributedRuntimeSessionRequest | null,
  isActive: boolean
): DistributedRuntimeSessionState {
  const requestTeamId = request?.teamId;
  const requestNodeId = request?.nodeId;
  const requestAssignmentId = request?.assignmentId;
  const requestAttemptId = request?.attemptId;
  const requestLeaseEpoch = request?.leaseEpoch;
  const requestAfterCursor = request?.afterCursor;
  const stableRequest = useMemo<GetDistributedRuntimeSessionRequest | null>(
    () =>
      requestTeamId === undefined ||
      requestNodeId === undefined ||
      requestAssignmentId === undefined ||
      requestAttemptId === undefined ||
      requestLeaseEpoch === undefined
        ? null
        : {
            teamId: requestTeamId,
            nodeId: requestNodeId,
            assignmentId: requestAssignmentId,
            attemptId: requestAttemptId,
            leaseEpoch: requestLeaseEpoch,
            ...(requestAfterCursor === undefined ? {} : { afterCursor: requestAfterCursor }),
          },
    [
      requestAfterCursor,
      requestAssignmentId,
      requestAttemptId,
      requestLeaseEpoch,
      requestNodeId,
      requestTeamId,
    ]
  );
  const [session, setSession] = useState<DistributedRuntimeSessionDto | null>(null);
  const [loading, setLoading] = useState(stableRequest !== null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const runtimeSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    requestGenerationRef.current += 1;
    cursorRef.current = 0;
    runtimeSessionIdRef.current = null;
    setSession(null);
    setLoading(stableRequest !== null);
    setSending(false);
    setError(null);
  }, [stableRequest]);

  const refresh = useCallback(async (): Promise<void> => {
    if (stableRequest === null || !isActive) return;
    const requestGeneration = requestGenerationRef.current;
    const runtimeSessionIdAtStart = runtimeSessionIdRef.current;
    try {
      const next = await api.distributedAgentTeams.getRuntimeSession({
        ...stableRequest,
        afterCursor: cursorRef.current,
      });
      if (requestGeneration !== requestGenerationRef.current) return;
      if (
        runtimeSessionIdRef.current !== null &&
        runtimeSessionIdRef.current !== runtimeSessionIdAtStart &&
        next.sessionId !== runtimeSessionIdRef.current
      ) {
        return;
      }
      if (runtimeSessionIdAtStart !== null && next.sessionId !== runtimeSessionIdAtStart) {
        runtimeSessionIdRef.current = next.sessionId;
        cursorRef.current = 0;
        setSession((current) => ({
          ...next,
          events: current?.events ?? [],
          truncated: next.truncated || current?.truncated === true,
          nextCursor: 0,
        }));
        setError(null);
        return;
      }
      runtimeSessionIdRef.current = next.sessionId;
      cursorRef.current = Math.max(cursorRef.current, next.nextCursor);
      setSession((current) => {
        const events = [...(current?.events ?? []), ...next.events];
        const unique = [...new Map(events.map((event) => [event.eventId, event])).values()].slice(
          -MAX_RENDERER_EVENTS
        );
        return {
          ...next,
          events: unique,
          truncated: next.truncated || current?.truncated === true,
          nextCursor: Math.max(next.nextCursor, current?.nextCursor ?? 0),
        };
      });
      setError(null);
    } catch (requestError) {
      if (requestGeneration !== requestGenerationRef.current) return;
      setError(
        requestError instanceof Error ? requestError.message : 'Remote runtime session failed'
      );
    } finally {
      if (requestGeneration === requestGenerationRef.current) setLoading(false);
    }
  }, [isActive, stableRequest]);

  useEffect(() => {
    if (!isActive || stableRequest === null) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isActive, refresh, stableRequest]);

  const sendControl = useCallback(
    async (
      control: SendDistributedRuntimeControlRequest['control']
    ): Promise<DistributedRuntimeControlReceiptDto> => {
      if (stableRequest === null) {
        throw new Error('No active distributed runtime lease is selected');
      }
      const requestGeneration = requestGenerationRef.current;
      setSending(true);
      setError(null);
      try {
        const receipt = await api.distributedAgentTeams.sendRuntimeControl({
          session: stableRequest,
          control,
        });
        await refresh();
        return receipt;
      } catch (controlError) {
        if (requestGeneration === requestGenerationRef.current) {
          setError(controlError instanceof Error ? controlError.message : 'Remote control failed');
        }
        throw controlError;
      } finally {
        if (requestGeneration === requestGenerationRef.current) setSending(false);
      }
    },
    [refresh, stableRequest]
  );

  return { session, loading, sending, error, refresh, sendControl };
}
