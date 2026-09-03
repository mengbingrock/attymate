import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';

import { buildDistributedTeamDetail } from './adapters/buildDistributedTeamDetail';
import { useDistributedAgentTeams } from './hooks/useDistributedAgentTeams';
import { useDistributedRuntimeSession } from './hooks/useDistributedRuntimeSession';
import { DistributedTeamDetailView } from './ui/DistributedTeamDetailView';
import { selectDistributedRuntimeAssignment } from './utils/selectDistributedRuntimeAssignment';

import type {
  CreateRemoteAssignmentRequest,
  JoinDistributedTeamMemberRequest,
  LeaveDistributedTeamMemberRequest,
} from '../contracts';

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
  const [reconnectingLead, setReconnectingLead] = useState(false);
  const [reconnectLeadMessage, setReconnectLeadMessage] = useState<string | null>(null);
  const [membershipMutation, setMembershipMutation] = useState<string | null>(null);
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
      selectDistributedRuntimeAssignment(model.assignments, model.leases, selectedRuntimeNodeId),
    [model.assignments, model.leases, selectedRuntimeNodeId]
  );
  useEffect(() => {
    if (selectedRuntimeNodeId === null && activeRuntimeAssignment !== undefined) {
      setSelectedRuntimeNodeId(activeRuntimeAssignment.targetNodeId);
    }
  }, [activeRuntimeAssignment, selectedRuntimeNodeId]);
  useEffect(() => {
    if (
      selectedRuntimeNodeId !== null &&
      model.members.length > 0 &&
      !model.members.some((member) => member.route.nodeId === selectedRuntimeNodeId)
    ) {
      setSelectedRuntimeNodeId(null);
    }
  }, [model.members, selectedRuntimeNodeId]);
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
  const runtimeUnavailableDescription = useMemo(() => {
    if (selectedRuntimeNodeId === null || activeRuntimeAssignment !== undefined) return undefined;
    const worker = model.workers.find((candidate) => candidate.nodeId === selectedRuntimeNodeId);
    const workerLabel = worker?.label ?? selectedRuntimeNodeId;
    return `${workerLabel} has no active execution lease. Select a worker with an active lease, or create and start an assignment for this worker.`;
  }, [activeRuntimeAssignment, model.workers, selectedRuntimeNodeId]);
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

  const reconnectLead = useCallback(async (): Promise<void> => {
    setReconnectingLead(true);
    setReconnectLeadMessage(null);
    setMutationError(null);
    try {
      const receipt = await api.distributedAgentTeams.reconnectLead({ teamId });
      setReconnectLeadMessage(
        receipt.status === 'already-connected'
          ? 'Lead is already connected.'
          : receipt.status === 'already-running'
            ? 'Lead process is already running and reconnecting.'
            : 'Lead reconnect started. Waiting for its Relay heartbeat.'
      );
      await refresh();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Unable to reconnect the lead.');
    } finally {
      setReconnectingLead(false);
    }
  }, [refresh, teamId]);

  const joinTeamMember = useCallback(
    async (request: JoinDistributedTeamMemberRequest): Promise<void> => {
      setMembershipMutation(request.targetNodeId);
      setMutationError(null);
      try {
        await api.distributedAgentTeams.joinTeamMember(request);
        await refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to join the team member.';
        setMutationError(message);
        throw error;
      } finally {
        setMembershipMutation(null);
      }
    },
    [refresh]
  );

  const leaveTeamMember = useCallback(
    async (request: LeaveDistributedTeamMemberRequest): Promise<void> => {
      setMembershipMutation(request.membershipId);
      setMutationError(null);
      try {
        await api.distributedAgentTeams.leaveTeamMember(request);
        await refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to remove the team member.';
        setMutationError(message);
        throw error;
      } finally {
        setMembershipMutation(null);
      }
    },
    [refresh]
  );

  return (
    <DistributedTeamDetailView
      model={model}
      relayUrl={state.topology?.relayUrl ?? 'Relay unavailable'}
      loading={state.loading}
      refreshing={state.refreshing}
      error={state.error ?? state.debugSnapshot?.warning ?? null}
      mutationError={mutationError}
      reconnectLeadMessage={reconnectLeadMessage}
      creatingAssignment={creatingAssignment}
      startingTeam={startingTeam}
      reconnectingLead={reconnectingLead}
      membershipMutation={membershipMutation}
      insecureLanMode={state.topology?.insecureLanMode ?? true}
      selectedRuntimeNodeId={selectedRuntimeNodeId}
      runtimeUnavailableDescription={runtimeUnavailableDescription}
      runtimeSession={runtime.session}
      runtimeLoading={runtime.loading}
      runtimeSending={runtime.sending}
      runtimeError={runtime.error}
      onRefresh={() => void refresh()}
      onSelectRuntimeNode={setSelectedRuntimeNodeId}
      onRuntimeControl={runtime.sendControl}
      onCreateAssignment={createAssignment}
      onStartTeam={() => void startTeam()}
      onReconnectLead={() => void reconnectLead()}
      onJoinTeamMember={joinTeamMember}
      onLeaveTeamMember={leaveTeamMember}
    />
  );
};
