import type { GetDistributedRuntimeSessionRequest } from '@features/distributed-agent-teams/contracts';

export const finalAgentReply = (
  messages: ReadonlyMap<string, string>,
  phases: ReadonlyMap<string, string>
): string => {
  const entries = [...messages.entries()];
  const final = entries.filter(([id]) => phases.get(id) === 'final_answer');
  // Older runtimes omit phase: use their last answer rather than joining progress updates.
  const selected = final.length > 0 ? final : entries.filter(([id]) => !phases.has(id)).slice(-1);
  return selected
    .map(([, text]) => text)
    .join('\n\n')
    .slice(0, 18_000);
};

export const runtimeReplyKey = (
  scope: GetDistributedRuntimeSessionRequest,
  turnId: string
): string =>
  JSON.stringify([
    scope.teamId,
    scope.nodeId,
    scope.assignmentId,
    scope.attemptId,
    scope.leaseEpoch,
    turnId,
  ]);
