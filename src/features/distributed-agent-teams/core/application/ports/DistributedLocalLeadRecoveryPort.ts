export interface RecoverDistributedLocalLeadRequest {
  readonly teamId: string;
  readonly nodeId: string;
}

export interface RecoverDistributedLocalLeadResult {
  readonly status: 'already-running' | 'started';
}

export interface DistributedLocalLeadRecoveryPort {
  reconnect(
    request: RecoverDistributedLocalLeadRequest
  ): Promise<RecoverDistributedLocalLeadResult>;
}
