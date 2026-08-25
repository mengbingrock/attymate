import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';

import { buildDistributedTeamDetail } from './adapters/buildDistributedTeamDetail';
import { useDistributedAgentTeams } from './hooks/useDistributedAgentTeams';
import { useDistributedRuntimeSession } from './hooks/useDistributedRuntimeSession';
import { DistributedTeamDetailView } from './ui/DistributedTeamDetailView';

import type { CreateRemoteAssignmentRequest } from '../contracts';

interface DistributedTeamDetailScreenProps {
  teamId: string;
  isActive: boolean;
}

export const DistributedTeamDetailScreen = ({
  teamId,
  isActive,
}: DistributedTeamDetailScreenProps): React.JSX.Element => {
  const state = useDistributedAgentTeams(isActive, { includeDebug: true });
  const refresh = state.refresh;
  const [creatingAssignment, setCreatingAssignment] = useState(false);
  const [startingTeam, setStartingTeam] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [selectedRuntimeNodeId, setSelectedRuntimeNodeId] = useState<string | null>(null);
  const model = useMemo(
    () =>
      buildDistributedTeamDetail(
        teamId,
        state.topology,
        state.assignmentEvents,
        state.debugSnapshot
      ),
    [state.assignmentEvents, state.debugSnapshot, state.topology, teamId]
  );
  const activeRuntimeAssignment = useMemo(
    () =>
      model.assignments.find(
        (assignment) =>
          assignment.targetNodeId === selectedRuntimeNodeId &&
          assignment.attemptId !== undefined &&
          assignment.leaseEpoch !== undefined &&
          model.leases.some(
            (lease) =>
              lease.assignmentId === assignment.assignmentId &&
              ['granted', 'active'].includes(lease.status)
          )
      ) ??
      model.assignments.find(
        (assignment) =>
          assignment.attemptId !== undefined &&
          assignment.leaseEpoch !== undefined &&
          model.leases.some(
            (lease) =>
              lease.assignmentId === assignment.assignmentId &&
              ['granted', 'active'].includes(lease.status)
          )
      ),
    [model.assignments, model.leases, selectedRuntimeNodeId]
  );
  useEffect(() => {
    if (selectedRuntimeNodeId === null && activeRuntimeAssignment !== undefined) {
      setSelectedRuntimeNodeId(activeRuntimeAssignment.targetNodeId);
    }
  }, [activeRuntimeAssignment, selectedRuntimeNodeId]);
  const runtimeRequest = useMemo(
    () =>
      state.topology?.insecureLanMode !== false ||
      activeRuntimeAssignment?.attemptId === undefined ||
      activeRuntimeAssignment.leaseEpoch === undefined
        ? null
        : {
            teamId,
            nodeId: activeRuntimeAssignment.targetNodeId,
            assignmentId: activeRuntimeAssignment.assignmentId,
            attemptId: activeRuntimeAssignment.attemptId,
            leaseEpoch: activeRuntimeAssignment.leaseEpoch,
          },
    [activeRuntimeAssignment, state.topology?.insecureLanMode, teamId]
  );
  const runtime = useDistributedRuntimeSession(runtimeRequest, isActive);

  const createAssignment = useCallback(
    async (request: CreateRemoteAssignmentRequest): Promise<void> => {
      setCreatingAssignment(true);
      setMutationError(null);
      try {
        await api.distributedAgentTeams.createRemoteAssignment(request);
        await refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to create the remote assignment.';
        setMutationError(message);
        throw error;
      } finally {
        setCreatingAssignment(false);
      }
    },
    [refresh]
  );

  const startTeam = useCallback(async (): Promise<void> => {
    setStartingTeam(true);
    setMutationError(null);
    try {
      await api.distributedAgentTeams.startTeam({ teamId });
      await refresh();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Unable to start the team.');
    } finally {
      setStartingTeam(false);
    }
  }, [refresh, teamId]);

  return (
    <DistributedTeamDetailView
      model={model}
      relayUrl={state.topology?.relayUrl ?? 'Relay unavailable'}
      loading={state.loading}
      refreshing={state.refreshing}
      error={state.error ?? state.debugSnapshot?.warning ?? null}
      mutationError={mutationError}
      creatingAssignment={creatingAssignment}
      startingTeam={startingTeam}
      insecureLanMode={state.topology?.insecureLanMode ?? true}
      selectedRuntimeNodeId={selectedRuntimeNodeId}
      runtimeSession={runtime.session}
      runtimeLoading={runtime.loading}
      runtimeSending={runtime.sending}
      runtimeError={runtime.error}
      onRefresh={() => void refresh()}
      onSelectRuntimeNode={setSelectedRuntimeNodeId}
      onRuntimeControl={runtime.sendControl}
      onCreateAssignment={createAssignment}
      onStartTeam={() => void startTeam()}
    />
  );
};
