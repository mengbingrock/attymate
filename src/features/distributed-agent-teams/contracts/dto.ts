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
}

export interface RemoteAssignmentReceiptDto {
  commandId: string;
  targetNodeId: string;
  cursor: number;
  status: 'pending' | 'delivered' | 'acknowledged' | 'rejected';
  createdAt: string;
}
