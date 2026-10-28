import { z } from 'zod';

import { personIdSchema } from './ids';

export const runtimeOwnerRequestSchema = z
  .object({
    operation: z.enum(['session.open', 'runtime.control']),
    sessionId: z.uuid(),
    scope: z
      .object({
        teamId: z.uuid(),
        nodeId: z.uuid(),
        assignmentId: z.uuid(),
        attemptId: z.uuid(),
        leaseEpoch: z.number().int().positive(),
      })
      .strict(),
    control: z.unknown().optional(),
  })
  .strict();

export const runtimeOwnerKeySchema = z
  .object({
    personId: personIdSchema,
    publicKey: z.string().regex(/^[A-Za-z0-9_-]{40,256}$/),
  })
  .strict();

export const runtimeOwnerProofSchema = runtimeOwnerKeySchema
  .extend({
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    nonce: z.uuid(),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  })
  .strict();

export type RuntimeOwnerKey = z.infer<typeof runtimeOwnerKeySchema>;
export type RuntimeOwnerProof = z.infer<typeof runtimeOwnerProofSchema>;

export interface RuntimeOwnerRequest {
  readonly operation: 'session.open' | 'runtime.control';
  readonly sessionId: string;
  readonly scope: {
    readonly teamId: string;
    readonly nodeId: string;
    readonly assignmentId: string;
    readonly attemptId: string;
    readonly leaseEpoch: number;
  };
  readonly control?: unknown;
}

/** One canonical representation at both independently enforcing boundaries. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)])
    );
  }
  return value;
};

export const runtimeOwnerSignedPayload = (
  request: RuntimeOwnerRequest,
  proof: Omit<RuntimeOwnerProof, 'signature'>
): string =>
  JSON.stringify(
    canonical({
      domain: 'agent-teams-owner-runtime-v1',
      request: {
        operation: request.operation,
        sessionId: request.sessionId,
        scope: {
          teamId: request.scope.teamId,
          nodeId: request.scope.nodeId,
          assignmentId: request.scope.assignmentId,
          attemptId: request.scope.attemptId,
          leaseEpoch: request.scope.leaseEpoch,
        },
        ...(request.control === undefined ? {} : { control: request.control }),
      },
      owner: proof,
    })
  );

export const currentRuntimeOwnerProof = (
  input: unknown,
  keys: readonly RuntimeOwnerKey[],
  now = Date.now()
): RuntimeOwnerProof | undefined => {
  const parsed = runtimeOwnerProofSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const proof = parsed.data;
  if (
    proof.issuedAt > now + 5_000 ||
    proof.expiresAt <= now ||
    proof.expiresAt <= proof.issuedAt ||
    proof.expiresAt - proof.issuedAt > 60_000 ||
    !keys.some((key) => key.personId === proof.personId && key.publicKey === proof.publicKey)
  )
    return undefined;
  return proof;
};
