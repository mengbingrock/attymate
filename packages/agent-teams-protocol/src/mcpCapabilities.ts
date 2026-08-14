import type { McpCapabilityProfile, McpSessionContext } from './sessionContext';

const ownerControlTools = [
  'agent_context',
  'worker_status',
  'worker_enable',
  'worker_disable',
  'worker_restart',
  'agenda_get',
  'assignment_list',
  'assignment_get',
  'assignment_accept',
  'assignment_reject',
  'assignment_defer',
  'assignment_status',
  'assignment_pause',
  'assignment_resume',
  'assignment_cancel',
  'assignment_steer',
  'assignment_activity_get',
  'progress_get',
  'result_get',
  'message_list',
  'message_send',
  'support_request',
  'review_request',
  'review_get',
  'review_approve',
  'review_request_changes',
  'approval_list',
  'approval_get',
  'approval_respond',
  'worker_policy_get',
  'worker_policy_update',
  'remote_start_history',
  'personal_task_list',
  'personal_task_create',
  'personal_task_update',
  'personal_task_complete',
  'calendar_list',
  'calendar_event_list',
  'calendar_event_get',
  'calendar_event_create',
  'calendar_event_update',
  'calendar_event_delete',
] as const;

const runtimeTools = [
  'runtime_context',
  'task_list',
  'task_get',
  'task_start',
  'task_set_status',
  'task_add_comment',
  'task_complete',
  'message_send',
  'progress_report',
  'result_submit',
  'support_request',
  'review_request',
  'review_start',
  'review_approve',
  'review_request_changes',
  'calendar_list',
  'calendar_event_list',
  'calendar_event_get',
  'calendar_change_request',
] as const;

const managerOnlyTools = [
  'team_launch',
  'team_stop',
  'team_member_start',
  'team_member_stop',
  'team_member_status',
  'team_placement_get',
  'team_placement_update',
  'team_membership_list',
  'team_membership_update',
  'team_migration_plan',
  'team_migration_execute',
] as const;

const internalProtocolOperations = [
  'runtime_bootstrap_checkin',
  'runtime_deliver_message',
  'runtime_task_event',
  'runtime_heartbeat',
] as const;

export type OwnerControlToolName = (typeof ownerControlTools)[number];
export type RuntimeToolName = (typeof runtimeTools)[number];
export type ManagerOnlyToolName = (typeof managerOnlyTools)[number];
export type InternalProtocolOperation = (typeof internalProtocolOperations)[number];
export type PublicMcpToolName = OwnerControlToolName | RuntimeToolName | ManagerOnlyToolName;

const publicToolsByProfile: Readonly<Record<McpCapabilityProfile, ReadonlySet<string>>> = {
  'agent-teams-control': new Set(ownerControlTools),
  'agent-teams-runtime': new Set(runtimeTools),
  'agent-teams-manager': new Set([...ownerControlTools, ...managerOnlyTools]),
};

const internalOperations = new Set<string>(internalProtocolOperations);

export class McpCapabilityError extends Error {
  readonly code = 'MCP_CAPABILITY_DENIED';

  constructor(
    readonly profile: McpCapabilityProfile,
    readonly toolName: string
  ) {
    super(`MCP profile ${profile} cannot invoke ${toolName}`);
    this.name = 'McpCapabilityError';
  }
}

export const listToolsForProfile = (profile: McpCapabilityProfile): readonly string[] =>
  Object.freeze([...publicToolsByProfile[profile]].sort());

export const canProfileInvokeTool = (
  profile: McpCapabilityProfile,
  toolName: string
): toolName is PublicMcpToolName => publicToolsByProfile[profile].has(toolName);

export const assertSessionCanInvokeTool = (
  context: McpSessionContext,
  toolName: string
): void => {
  if (!canProfileInvokeTool(context.profile, toolName)) {
    throw new McpCapabilityError(context.profile, toolName);
  }
};

export const isInternalProtocolOperation = (
  operation: string
): operation is InternalProtocolOperation => internalOperations.has(operation);
