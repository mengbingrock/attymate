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
}

export interface DistributedTopologyDto {
  relayUrl: string;
  insecureLanMode: true;
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
