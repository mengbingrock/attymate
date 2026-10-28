import { createPublicKey, verify } from 'node:crypto';

import {
  currentRuntimeOwnerProof,
  runtimeOwnerSignedPayload,
  type RuntimeOwnerKey,
  type RuntimeOwnerRequest,
} from '@claude-teams/agent-teams-protocol';

/** Relay checks early; the device independently repeats this check before any private action. */
export const verifyRuntimeOwnerAuthorization = (
  request: RuntimeOwnerRequest,
  input: unknown,
  keys: readonly RuntimeOwnerKey[]
): boolean => {
  const proof = currentRuntimeOwnerProof(input, keys);
  if (!proof) return false;
  try {
    const { signature, ...claim } = proof;
    const key = createPublicKey({
      key: Buffer.from(proof.publicKey, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    return (
      key.asymmetricKeyType === 'ed25519' &&
      verify(
        null,
        Buffer.from(runtimeOwnerSignedPayload(request, claim)),
        key,
        Buffer.from(signature, 'base64url')
      )
    );
  } catch {
    return false;
  }
};
