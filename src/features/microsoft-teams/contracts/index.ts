export interface TeamsBinding {
  tenantId: string;
  aadObjectId: string;
  teamId: string;
  nodeId: string;
  /** Additional devices explicitly owned by this Microsoft identity. Never inferred from team role. */
  ownedNodes?: { nodeId: string; label: string }[];
}

export interface TeamsRequest {
  requestKey: string;
  channelId: string;
  tenantId: string;
  aadObjectId: string;
  conversationType: string;
  text: string;
}

export interface TeamsRuntimePort {
  status(binding: TeamsBinding): Promise<string>;
  exchange(binding: TeamsBinding, text: string): Promise<string>;
  exchangeResponse?(binding: TeamsBinding, text: string): Promise<TeamsResponse>;
}

export interface TeamsResponse {
  text: string;
  deliveryKey?: string;
}

export interface TeamsConversation extends TeamsBinding {
  conversationId: string;
}

export interface TeamsRequestJournal {
  begin(key: string): { fresh: boolean; reply?: string; deliveryKey?: string };
  finish(key: string, reply: string, deliveryKey?: string): void;
}

export interface PendingTeamsDelivery {
  key: string;
  target: TeamsConversation;
  text: string;
}

export interface TeamsDeliveryJournal {
  conversation(binding: TeamsBinding): TeamsConversation | undefined;
  enqueue(key: string, target: TeamsConversation, text: string): void;
  pending(): PendingTeamsDelivery[];
  claim(key: string): boolean;
  settle(key: string, activityId?: string): void;
}

export interface TeamsApprovalRecord {
  id: string;
  key: string;
  target: TeamsConversation;
  nodeLabel: string;
  scope: {
    teamId: string;
    nodeId: string;
    assignmentId: string;
    attemptId: string;
    leaseEpoch: number;
  };
  threadId: string;
  turnId: string;
  appServerGeneration: number;
  request: { id: number | string; method: string; params: Record<string, unknown> };
  createdAt: string;
  expiresAt: string;
  dispatch?: {
    controlId: string;
    decision: 'accept' | 'decline';
    sessionId: string;
    cursor: number;
    submittedAt: string;
    source: 'owner' | 'task';
    grantKey?: string;
    receiptPending?: boolean;
    notifiedState?: 'resolved' | 'expired' | 'unknown';
    coverageLost?: boolean;
  };
  state: 'pending' | 'sending' | 'shown' | 'resolving' | 'resolved' | 'unknown' | 'expired';
}

export interface TeamsApprovalJournal {
  add(value: TeamsApprovalRecord): TeamsApprovalRecord;
  get(id: string): TeamsApprovalRecord | undefined;
  pending(): TeamsApprovalRecord[];
  unconfirmed(): TeamsApprovalRecord[];
  tracked(): TeamsApprovalRecord[];
  hasTaskGrant(key: string): boolean;
  transition(
    id: string,
    from: TeamsApprovalRecord['state'],
    to: TeamsApprovalRecord['state'],
    dispatch?: TeamsApprovalRecord['dispatch']
  ): boolean;
}
