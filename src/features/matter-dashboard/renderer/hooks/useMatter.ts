import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@renderer/api';

import type { MatterDto, MatterProposalDto, MatterSnapshotDto } from '../../contracts';

const LIVE_RELOAD_DEBOUNCE_MS = 300;

const EMPTY_SNAPSHOT: MatterSnapshotDto = { matter: null, proposal: null };

export interface UseMatterResult {
  matter: MatterDto | null;
  proposal: MatterProposalDto | null;
  loading: boolean;
  /** True while a user approve/reject action is in flight. */
  acting: boolean;
  error: string | null;
  applyProposal: () => Promise<void>;
  rejectProposal: (reason?: string) => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * Live matter dashboard state for a team: initial fetch plus refetch on
 * `team-change` events of type `matter` (matter.json / matter-proposal.json
 * writes). Without a team name it stays inert and the view renders its demo
 * fixture.
 */
export function useMatter(teamName?: string): UseMatterResult {
  const [snapshot, setSnapshot] = useState<MatterSnapshotDto>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(Boolean(teamName));
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    if (!teamName) return;
    const seq = ++requestSeqRef.current;
    try {
      const next = await api.matter.get(teamName);
      if (requestSeqRef.current !== seq) return;
      setSnapshot(next ?? EMPTY_SNAPSHOT);
      setError(null);
    } catch (loadError) {
      if (requestSeqRef.current !== seq) return;
      setError(String(loadError));
    } finally {
      if (requestSeqRef.current === seq) setLoading(false);
    }
  }, [teamName]);

  useEffect(() => {
    requestSeqRef.current += 1;
    setSnapshot(EMPTY_SNAPSHOT);
    setError(null);
    setLoading(Boolean(teamName));
    if (teamName) {
      void load();
    }
  }, [teamName, load]);

  useEffect(() => {
    if (!teamName) return;

    const scheduleReload = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        void load();
      }, LIVE_RELOAD_DEBOUNCE_MS);
    };

    const unsubscribe = api.teams.onTeamChange?.((_event, event) => {
      if (event.type !== 'matter' || event.teamName !== teamName) return;
      scheduleReload();
    });

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') scheduleReload();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [teamName, load]);

  const applyProposal = useCallback(async (): Promise<void> => {
    if (!teamName) return;
    setActing(true);
    try {
      const next = await api.matter.applyProposal(teamName);
      setSnapshot(next ?? EMPTY_SNAPSHOT);
      setError(null);
    } catch (actionError) {
      setError(String(actionError));
    } finally {
      setActing(false);
    }
  }, [teamName]);

  const rejectProposal = useCallback(
    async (reason?: string): Promise<void> => {
      if (!teamName) return;
      setActing(true);
      try {
        const next = await api.matter.rejectProposal(teamName, reason);
        setSnapshot(next ?? EMPTY_SNAPSHOT);
        setError(null);
      } catch (actionError) {
        setError(String(actionError));
      } finally {
        setActing(false);
      }
    },
    [teamName]
  );

  return {
    matter: snapshot.matter,
    proposal: snapshot.proposal,
    loading,
    acting,
    error,
    applyProposal,
    rejectProposal,
    reload: load,
  };
}
