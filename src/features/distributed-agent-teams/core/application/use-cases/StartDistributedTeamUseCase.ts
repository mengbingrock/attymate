import type {
  DistributedAssignmentEventDto,
  StartDistributedTeamReceiptDto,
  StartDistributedTeamRequest,
} from '../../../contracts';
import type { DistributedRelayPort } from '../ports/DistributedRelayPort';

const STARTABLE_STATES = new Set(['proposed', 'deferred']);

export class StartDistributedTeamUseCase {
  constructor(private readonly relay: DistributedRelayPort) {}

  async execute(request: StartDistributedTeamRequest): Promise<StartDistributedTeamReceiptDto> {
    if (this.relay.insecureLanMode) {
      throw new Error('Starting a distributed team requires authenticated Relay credentials');
    }

    const [workers, events, commands] = await Promise.all([
      this.relay.listWorkers(),
      this.relay.listAssignmentEvents(),
      this.relay.listCommands(),
    ]);
    const connectedWorkers = new Map(
      workers
        .filter((worker) => worker.status === 'connected')
        .map((worker) => [worker.nodeId, worker] as const)
    );
    const latestByAssignment = new Map<string, DistributedAssignmentEventDto>();
    for (const event of events) {
      if (event.teamId !== request.teamId) continue;
      const previous = latestByAssignment.get(event.assignmentId);
      if (previous === undefined || event.revision > previous.revision) {
        latestByAssignment.set(event.assignmentId, event);
      }
    }

    const startable = commands.flatMap((command) => {
      if (
        command.type !== 'assignment.offer' ||
        command.teamId !== request.teamId ||
        command.assignmentId === undefined
      ) {
        return [];
      }
      const event = latestByAssignment.get(command.assignmentId);
      if (event === undefined || !STARTABLE_STATES.has(event.state)) return [];
      const worker = connectedWorkers.get(command.targetNodeId);
      if (worker === undefined) {
        throw new Error(`Worker ${command.targetNodeId} is not connected`);
      }
      if (!worker.runtimeCapabilities?.includes('turn.steer')) {
        throw new Error(`Worker ${worker.label} does not expose a controllable Codex runtime`);
      }
      return [{ command, event }];
    });

    if (startable.length === 0) {
      return {
        teamId: request.teamId,
        status: 'already-active',
        assignmentCommandIds: [],
        requestedAt: new Date().toISOString(),
      };
    }

    const receipts = await Promise.all(
      startable.map(({ command, event }) =>
        this.relay.acceptRemoteAssignment({
          teamId: request.teamId,
          targetNodeId: command.targetNodeId,
          assignmentId: event.assignmentId,
          expectedRevision: event.revision,
        })
      )
    );
    return {
      teamId: request.teamId,
      status: 'starting',
      assignmentCommandIds: receipts.map((receipt) => receipt.commandId),
      requestedAt: new Date().toISOString(),
    };
  }
}
