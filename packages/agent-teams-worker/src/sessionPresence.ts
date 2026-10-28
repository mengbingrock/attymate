import {
  SESSION_EXPIRES_MS,
  type TeamSessionObservation,
} from '@claude-teams/agent-teams-protocol';

type Binding = Pick<TeamSessionObservation, 'teamId' | 'membershipId' | 'threadId'>;

/** Ephemeral, scoped to this Worker process. Saved chat bindings are not liveness. */
export class SessionPresence {
  private readonly connections = new Map<
    string,
    { observedAt: number; attachedAt: number; bindings: Map<string, Binding> }
  >();
  constructor(private readonly now: () => number = () => performance.now()) {}

  attach(connectionId: string, bindingId: string, binding: Binding) {
    this.prune();
    if (!this.connections.has(connectionId) && this.connections.size >= 32)
      throw new Error('Too many live desktop connections');
    const connection = this.connections.get(connectionId) ?? {
      observedAt: -Infinity,
      attachedAt: this.now(),
      bindings: new Map<string, Binding>(),
    };
    if (
      !connection.bindings.has(bindingId) &&
      [...this.connections.values()].reduce((n, c) => n + c.bindings.size, 0) >= 128
    )
      throw new Error('Too many team sessions on this connection');
    connection.bindings.set(bindingId, binding);
    this.connections.set(connectionId, connection);
  }

  renew(connectionId: string, ageMs: number) {
    const connection = this.connections.get(connectionId);
    // A heartbeat can never resurrect a detached connection.
    if (connection) connection.observedAt = this.now() - ageMs;
  }

  detach(connectionId: string, threadId?: string) {
    const connection = this.connections.get(connectionId);
    if (threadId && connection) {
      for (const [id, binding] of connection.bindings)
        if (binding.threadId === threadId) connection.bindings.delete(id);
    } else this.connections.delete(connectionId);
  }

  clear() {
    this.connections.clear();
  }

  private prune() {
    const now = this.now();
    for (const [id, connection] of this.connections)
      if (now - Math.max(connection.observedAt, connection.attachedAt) >= SESSION_EXPIRES_MS)
        this.connections.delete(id);
  }

  snapshot(authorized: (binding: Binding) => boolean): TeamSessionObservation[] {
    this.prune();
    const now = this.now();
    return [...this.connections].flatMap(([connectionId, connection]) => {
      const ageMs = Math.max(0, now - connection.observedAt);
      if (ageMs >= SESSION_EXPIRES_MS) return [];
      return [...connection.bindings.values()]
        .filter(authorized)
        .map((binding) => ({ ...binding, connectionId, ageMs }));
    });
  }
}
