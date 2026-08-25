export interface DistributedWorkerDto {
  organizationId: string;
  personId: string;
  nodeId: string;
  workerInstanceId: string;
  workerGeneration: number;
  label: string;
  connectedAt: string;
  lastHeartbeatAt: string;
  lastHeartbeatSequence: number;
  status: 'connected' | 'stale';
  runtimeCapabilities?: RuntimeSessionCapability[];
}

export interface DistributedTopologyDto {
  relayUrl: string;
  insecureLanMode: boolean;
  workers: DistributedWorkerDto[];
  fetchedAt: string;
  degraded: boolean;
  warning?: string;
}

export interface CreateRemoteAssignmentRequest {
  targetNodeId: string;
  title: string;
  description?: string;
  teamId?: string;
  membershipId?: string;
  workspaceId?: string;
}

export interface RemoteAssignmentReceiptDto {
  commandId: string;
  targetNodeId: string;
  cursor: number;
  status: 'pending' | 'delivered' | 'acknowledged' | 'rejected';
  createdAt: string;
}

export interface StartDistributedTeamRequest {
  teamId: string;
}

export interface StartDistributedTeamReceiptDto {
  teamId: string;
  status: 'starting' | 'already-active';
  assignmentCommandIds: string[];
  requestedAt: string;
}

export type DistributedAssignmentState =
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'deferred'
  | 'queued'
  | 'leased'
  | 'preparing_workspace'
  | 'running'
  | 'waiting_local_approval'
  | 'verifying'
  | 'committing'
  | 'awaiting_push'
  | 'reporting'
  | 'ready_review'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'fenced';

export interface DistributedAssignmentEventDto {
  cursor: number;
  eventId: string;
  assignmentId: string;
  sourceNodeId: string;
  workerInstanceId: string;
  teamId?: string;
  occurredAt: string;
  receivedAt: string;
  revision: number;
  fromState: DistributedAssignmentState | null;
  state: DistributedAssignmentState;
  reason: string;
  deferredUntil?: string;
}

export interface DistributedAssignmentEventsDto {
  events: DistributedAssignmentEventDto[];
  fetchedAt: string;
  degraded: boolean;
  warning?: string;
}

export interface DistributedRelayCommandDto {
  cursor: number;
  commandId: string;
  targetNodeId: string;
  sequence: number;
  teamId?: string;
  assignmentId?: string;
  attemptId?: string;
  leaseEpoch?: number;
  type: string;
  payload: unknown;
  status: 'pending' | 'delivered' | 'acknowledged' | 'rejected';
  createdAt: string;
  deliveredAt?: string;
  acknowledgedAt?: string;
  rejectionError?: string;
}

export interface DistributedRelayEventDto {
  cursor: number;
  eventId: string;
  sourceNodeId: string;
  workerInstanceId: string;
  sequence: number;
  teamId?: string;
  assignmentId?: string;
  attemptId?: string;
  leaseEpoch?: number;
  type: string;
  payload: unknown;
  occurredAt: string;
  receivedAt: string;
}

export interface DistributedRelayLeaseDto {
  leaseId: string;
  assignmentId: string;
  attemptId: string;
  nodeId: string;
  teamId?: string;
  leaseEpoch: number;
  assignmentRevision: number;
  status: 'granted' | 'active' | 'expired' | 'released';
  issuedAt: string;
  expiresAt: string;
  updatedAt: string;
}

export interface DistributedMembershipRouteDto {
  membershipId: string;
  teamId: string;
  nodeId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DistributedDebugSnapshotDto {
  relayUrl: string;
  commands: DistributedRelayCommandDto[];
  events: DistributedRelayEventDto[];
  leases: DistributedRelayLeaseDto[];
  membershipRoutes: DistributedMembershipRouteDto[];
  fetchedAt: string;
  degraded: boolean;
  warning?: string;
}

export interface DistributedRuntimeSessionScopeDto {
  teamId: string;
  nodeId: string;
  assignmentId: string;
  attemptId: string;
  leaseId: string;
  leaseEpoch: number;
}

export interface GetDistributedRuntimeSessionRequest {
  teamId: string;
  nodeId: string;
  assignmentId: string;
  attemptId: string;
  leaseEpoch: number;
  afterCursor?: number;
}

export interface DistributedRuntimeSessionEventDto {
  cursor: number;
  eventId: string;
  sequence: number;
  scope: DistributedRuntimeSessionScopeDto;
  sessionId?: string;
  occurredAt: string;
  receivedAt: string;
  event: RuntimeEvent;
}

export interface DistributedRuntimeSessionDto {
  sessionId: string;
  scope: DistributedRuntimeSessionScopeDto;
  capabilities: RuntimeSessionCapability[];
  expiresAt: string;
  events: DistributedRuntimeSessionEventDto[];
  truncated: boolean;
  nextCursor: number;
}

export interface SendDistributedRuntimeControlRequest {
  session: GetDistributedRuntimeSessionRequest;
  control: RuntimeControl;
}

export interface DistributedRuntimeControlReceiptDto {
  controlId: string;
  accepted: true;
}
import type {
  RuntimeControl,
  RuntimeEvent,
  RuntimeSessionCapability,
} from '@claude-teams/agent-teams-protocol';
