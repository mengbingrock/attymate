import { z } from 'zod';

export const SESSION_HEARTBEAT_MS = 5_000;
export const SESSION_EXPIRES_MS = 15_000;
export const PRESENCE_HEADER = 'x-agent-teams-presence';

export const teamSessionObservationSchema = z
  .object({
    connectionId: z.uuid(),
    teamId: z.uuid(),
    membershipId: z.uuid(),
    threadId: z.string().min(1).max(100),
    // Age of actual local transport evidence, not the age of the Worker heartbeat.
    ageMs: z.number().finite().nonnegative().max(SESSION_EXPIRES_MS),
  })
  .strict();
export type TeamSessionObservation = z.infer<typeof teamSessionObservationSchema>;

export interface TeamPresence {
  readonly online: boolean;
  readonly computerConnected: boolean;
  readonly state: 'online' | 'offline' | 'unavailable';
  readonly reason:
    | 'connected'
    | 'computer_disconnected'
    | 'session_disconnected'
    | 'session_status_unavailable';
  readonly lastVerifiedAt: string | null;
  readonly validForMs: number;
  readonly computerValidForMs: number;
}

/** Pure projection. Callers supply current authorization and monotonic deadlines. */
export const projectTeamPresence = (input: {
  now: number;
  workerExpiresAt: number;
  sessionExpiresAt?: number;
  supported: boolean;
  authorized: boolean;
  lastVerifiedAt?: string;
}): TeamPresence => {
  const computerConnected = input.authorized && input.now < input.workerExpiresAt;
  const online = computerConnected && input.supported && input.now < (input.sessionExpiresAt ?? 0);
  return {
    online,
    computerConnected,
    state: online ? 'online' : computerConnected && !input.supported ? 'unavailable' : 'offline',
    reason: !computerConnected
      ? 'computer_disconnected'
      : !input.supported
        ? 'session_status_unavailable'
        : online
          ? 'connected'
          : 'session_disconnected',
    lastVerifiedAt: input.lastVerifiedAt ?? null,
    computerValidForMs: Math.max(0, computerConnected ? input.workerExpiresAt - input.now : 0),
    validForMs: Math.max(
      0,
      computerConnected
        ? Math.min(
            input.workerExpiresAt,
            online ? input.sessionExpiresAt! : input.workerExpiresAt
          ) - input.now
        : 0
    ),
  };
};
