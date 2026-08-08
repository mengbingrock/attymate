import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@renderer/api';

import type {
  MatterChanges,
  MatterDto,
  MatterEvidenceStatusDto,
  MatterLinkOperation,
  MatterLinkOperationResultDto,
  MatterProposalDto,
  MatterSnapshotDto,
} from '../../contracts';

const LIVE_RELOAD_DEBOUNCE_MS = 300;

const EMPTY_SNAPSHOT: MatterSnapshotDto = { matters: [], linkedMatterIds: [], proposal: null };

export interface UseMatterResult {
  /** Every matter in the app's store; the list view browses all of them. */
  matters: MatterDto[];
  /** Ids of matters linked to this team. */
  linkedMatterIds: string[];
  proposal: MatterProposalDto | null;
  loading: boolean;
  /** True while a user approve/reject action is in flight. */
  acting: boolean;
  error: string | null;
  linkStatus: MatterEvidenceStatusDto | null;
  linkActing: boolean;
  linkMessage: string | null;
  linkError: string | null;
  /** True while the lead is being asked to refresh the dashboard. */
  refreshActing: boolean;
  refreshMessage: string | null;
  refreshError: string | null;
  checkLinkStatus: () => Promise<void>;
  initializeLink: () => Promise<void>;
  requestLinkRefresh: () => Promise<void>;
  requestLinkProposal: (matterId?: string) => Promise<void>;
  /** Ask the team lead to scan the case folder and propose an update. */
  requestRefresh: (matterId?: string) => Promise<void>;
  /** Persist a user-authored edit; returns the fresh snapshot. */
  updateMatter: (matterId: string, changes: MatterChanges) => Promise<MatterSnapshotDto | null>;
  createMatter: (caption?: string) => Promise<MatterDto | null>;
  linkTeam: (matterId: string) => Promise<void>;
  unlinkTeam: (matterId: string) => Promise<void>;
  applyProposal: () => Promise<void>;
  rejectProposal: (reason?: string) => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * Live matters-store state for a team: initial fetch plus refetch on the
 * `matters-changed` push (any store write) and legacy `team-change` matter
 * events. Without a team name it stays inert and the view renders its demo
 * fixture.
 */
export function useMatter(teamName?: string): UseMatterResult {
  const [snapshot, setSnapshot] = useState<MatterSnapshotDto>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(Boolean(teamName));
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState<MatterEvidenceStatusDto | null>(null);
  const [linkActing, setLinkActing] = useState(false);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [refreshActing, setRefreshActing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
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
    setLinkStatus(null);
    setLinkMessage(null);
    setLinkError(null);
    setRefreshMessage(null);
    setRefreshError(null);
    setLoading(Boolean(teamName));
    if (teamName) {
      void load();
    }
  }, [teamName, load]);

  const checkLinkStatus = useCallback(async (): Promise<void> => {
    if (!teamName) return;
    setLinkActing(true);
    try {
      const status = await api.matter.getLinkStatus(teamName);
      setLinkStatus(status);
      setLinkMessage(status.summary);
      setLinkError(null);
    } catch (statusError) {
      setLinkError(String(statusError));
    } finally {
      setLinkActing(false);
    }
  }, [teamName]);

  const runLinkOperation = useCallback(
    async (operation: MatterLinkOperation, matterId?: string): Promise<void> => {
      if (!teamName) return;
      setLinkActing(true);
      setLinkMessage(null);
      try {
        let result: MatterLinkOperationResultDto;
        if (operation === 'initialize') {
          result = await api.matter.initializeLink(teamName);
        } else if (operation === 'refresh-request') {
          result = await api.matter.requestLinkRefresh(teamName);
        } else {
          result = await api.matter.requestLinkProposal(teamName, matterId);
        }
        setLinkStatus(result.status);
        setLinkMessage(result.message);
        setLinkError(result.accepted ? null : result.message);
      } catch (operationError) {
        setLinkError(String(operationError));
      } finally {
        setLinkActing(false);
      }
    },
    [teamName]
  );

  const requestRefresh = useCallback(
    async (matterId?: string): Promise<void> => {
      if (!teamName) return;
      setRefreshActing(true);
      setRefreshMessage(null);
      setRefreshError(null);
      try {
        const result = await api.matter.requestRefresh(teamName, matterId);
        setRefreshMessage(result.message);
        if (!result.accepted) setRefreshError(result.message);
      } catch (refreshFailure) {
        setRefreshError(String(refreshFailure));
      } finally {
        setRefreshActing(false);
      }
    },
    [teamName]
  );

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

    // Store writes broadcast matters-changed; legacy proposal/team events
    // still arrive as team-change 'matter'.
    const unsubscribeMatters = api.matter.onMattersChanged?.(scheduleReload);
    const unsubscribeTeam = api.teams.onTeamChange?.((_event, event) => {
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
      if (typeof unsubscribeMatters === 'function') unsubscribeMatters();
      if (typeof unsubscribeTeam === 'function') unsubscribeTeam();
    };
  }, [teamName, load]);

  const adoptSnapshot = useCallback((next: MatterSnapshotDto | null): void => {
    requestSeqRef.current += 1;
    setSnapshot(next ?? EMPTY_SNAPSHOT);
    setError(null);
  }, []);

  const updateMatter = useCallback(
    async (matterId: string, changes: MatterChanges): Promise<MatterSnapshotDto | null> => {
      if (!teamName) return null;
      const next = await api.matter.update(teamName, matterId, changes);
      adoptSnapshot(next);
      return next;
    },
    [teamName, adoptSnapshot]
  );

  const createMatter = useCallback(
    async (caption?: string): Promise<MatterDto | null> => {
      if (!teamName) return null;
      try {
        const before = new Set(snapshot.matters.map((matter) => matter.id));
        const next = await api.matter.create(teamName, caption ? { caption } : undefined);
        adoptSnapshot(next);
        return next?.matters.find((matter) => !before.has(matter.id)) ?? null;
      } catch (createError) {
        setError(String(createError));
        return null;
      }
    },
    [teamName, snapshot.matters, adoptSnapshot]
  );

  const linkTeam = useCallback(
    async (matterId: string): Promise<void> => {
      if (!teamName) return;
      try {
        adoptSnapshot(await api.matter.linkTeam(teamName, matterId));
      } catch (linkFailure) {
        setError(String(linkFailure));
      }
    },
    [teamName, adoptSnapshot]
  );

  const unlinkTeam = useCallback(
    async (matterId: string): Promise<void> => {
      if (!teamName) return;
      try {
        adoptSnapshot(await api.matter.unlinkTeam(teamName, matterId));
      } catch (unlinkFailure) {
        setError(String(unlinkFailure));
      }
    },
    [teamName, adoptSnapshot]
  );

  const applyProposal = useCallback(async (): Promise<void> => {
    if (!teamName) return;
    setActing(true);
    try {
      adoptSnapshot(await api.matter.applyProposal(teamName));
    } catch (actionError) {
      setError(String(actionError));
    } finally {
      setActing(false);
    }
  }, [teamName, adoptSnapshot]);

  const rejectProposal = useCallback(
    async (reason?: string): Promise<void> => {
      if (!teamName) return;
      setActing(true);
      try {
        adoptSnapshot(await api.matter.rejectProposal(teamName, reason));
      } catch (actionError) {
        setError(String(actionError));
      } finally {
        setActing(false);
      }
    },
    [teamName, adoptSnapshot]
  );

  return {
    matters: snapshot.matters,
    linkedMatterIds: snapshot.linkedMatterIds,
    proposal: snapshot.proposal,
    loading,
    acting,
    error,
    linkStatus,
    linkActing,
    linkMessage,
    linkError,
    refreshActing,
    refreshMessage,
    refreshError,
    checkLinkStatus,
    initializeLink: () => runLinkOperation('initialize'),
    requestLinkRefresh: () => runLinkOperation('refresh-request'),
    requestLinkProposal: (matterId?: string) => runLinkOperation('proposal-request', matterId),
    requestRefresh,
    updateMatter,
    createMatter,
    linkTeam,
    unlinkTeam,
    applyProposal,
    rejectProposal,
    reload: load,
  };
}
