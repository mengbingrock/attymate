import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  currentRuntimeOwnerProof,
  runtimeOwnerKeySchema,
  runtimeOwnerSignedPayload,
  type RuntimeOwnerKey,
  type RuntimeOwnerProof,
  type RuntimeOwnerRequest,
} from '@claude-teams/agent-teams-protocol';

export class RuntimeOwnerAuthorizationError extends Error {
  readonly code = 'RUNTIME_OWNER_AUTHORIZATION_REQUIRED';
  constructor() {
    super('Device-owner authorization is required for private runtime access');
  }
}

export const readRuntimeOwnerKeyring = async (
  path: string
): Promise<readonly RuntimeOwnerKey[]> => {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
  )
    throw new Error('Owner keyring must be an owner-only regular file');
  return runtimeOwnerKeySchema
    .array()
    .max(15)
    .parse(JSON.parse(await readFile(path, 'utf8')));
};

/** The signing key stays on the owner's device; Relay/manager credentials cannot mint proofs. */
export class WorkerRuntimeOwnerAuthorization {
  private readonly sessions = new Map<
    string,
    { scope: RuntimeOwnerRequest['scope']; expiresAt: number }
  >();

  private constructor(
    private readonly privateKey: ReturnType<typeof createPrivateKey>,
    readonly key: RuntimeOwnerKey,
    readonly keys: readonly RuntimeOwnerKey[],
    private readonly db: DatabaseSync
  ) {}

  static async open(
    dataDir: string,
    personId: RuntimeOwnerKey['personId'],
    additional: readonly RuntimeOwnerKey[] = []
  ) {
    const path = join(dataDir, 'runtime-owner-key.json');
    let value: { personId: string; privateKey: string };
    try {
      const stat = await lstat(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      )
        throw new Error('Runtime owner key must be an owner-only regular file');
      value = JSON.parse(await readFile(path, 'utf8')) as typeof value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const generated = generateKeyPairSync('ed25519');
      value = {
        personId,
        privateKey: generated.privateKey
          .export({ format: 'der', type: 'pkcs8' })
          .toString('base64url'),
      };
      await writeFile(path, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    }
    if (value.personId !== personId)
      throw new Error(
        'Runtime owner identity changed; enroll a separate Worker instead of reusing owner credentials'
      );
    const privateKey = createPrivateKey({
      key: Buffer.from(value.privateKey, 'base64url'),
      format: 'der',
      type: 'pkcs8',
    });
    if (privateKey.asymmetricKeyType !== 'ed25519')
      throw new Error('Invalid runtime owner signing key');
    const publicKey = createPublicKey(privateKey)
      .export({ format: 'der', type: 'spki' })
      .toString('base64url');
    const key = runtimeOwnerKeySchema.parse({ personId, publicKey });
    const keys = [key, ...additional.map((item) => runtimeOwnerKeySchema.parse(item))];
    if (keys.some((item) => item.personId !== personId) || keys.length > 16)
      throw new Error('Only keys belonging to this device owner may be paired');
    const dbPath = join(dataDir, 'runtime-owner-state.sqlite');
    try {
      const stat = await lstat(dbPath);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      )
        throw new Error('Runtime owner state must be an owner-only regular file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await writeFile(dbPath, '', { flag: 'wx', mode: 0o600 });
    }
    const db = new DatabaseSync(dbPath);
    db.exec(
      'CREATE TABLE IF NOT EXISTS used_proofs (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS owner_policy (id INTEGER PRIMARY KEY CHECK(id=1), not_before INTEGER NOT NULL); INSERT OR IGNORE INTO owner_policy VALUES(1,0);'
    );
    return new WorkerRuntimeOwnerAuthorization(privateKey, key, keys, db);
  }

  /** Only the owner-only local control surface exposes this method. */
  sign(request: RuntimeOwnerRequest): RuntimeOwnerProof {
    const issuedAt = Math.max(Date.now(), this.notBefore());
    const proof = { ...this.key, issuedAt, expiresAt: issuedAt + 30_000, nonce: randomUUID() };
    return {
      ...proof,
      signature: sign(
        null,
        Buffer.from(runtimeOwnerSignedPayload(request, proof)),
        this.privateKey
      ).toString('base64url'),
    };
  }

  authorize(request: RuntimeOwnerRequest, input: unknown, leaseExpiresAt: string): void {
    const now = Date.now();
    this.db.prepare('DELETE FROM used_proofs WHERE expires_at<=?').run(now);
    const proof = currentRuntimeOwnerProof(input, this.keys, now);
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM used_proofs').get() as { n: number };
    if (!proof || proof.issuedAt < this.notBefore() || count.n >= 10_000)
      throw new RuntimeOwnerAuthorizationError();
    const { signature, ...claim } = proof;
    let valid = false;
    try {
      const key = createPublicKey({
        key: Buffer.from(proof.publicKey, 'base64url'),
        format: 'der',
        type: 'spki',
      });
      valid =
        key.asymmetricKeyType === 'ed25519' &&
        verify(
          null,
          Buffer.from(runtimeOwnerSignedPayload(request, claim)),
          key,
          Buffer.from(signature, 'base64url')
        );
    } catch {
      /* Malformed keys and signatures fail closed. */
    }
    const leaseExpiry = Date.parse(leaseExpiresAt);
    if (!valid || !Number.isFinite(leaseExpiry) || leaseExpiry <= now)
      throw new RuntimeOwnerAuthorizationError();
    for (const [id, session] of this.sessions)
      if (session.expiresAt <= now) this.sessions.delete(id);
    if (request.operation === 'session.open' && this.sessions.size >= 128)
      throw new RuntimeOwnerAuthorizationError();
    if (
      request.operation === 'runtime.control' &&
      !this.hasSession(request.sessionId, request.scope)
    )
      throw new RuntimeOwnerAuthorizationError();
    if (
      this.db
        .prepare('INSERT OR IGNORE INTO used_proofs VALUES(?,?)')
        .run(proof.nonce, proof.expiresAt).changes !== 1
    )
      throw new RuntimeOwnerAuthorizationError();
    if (request.operation === 'session.open')
      this.sessions.set(request.sessionId, {
        scope: request.scope,
        expiresAt: Date.parse(leaseExpiresAt),
      });
  }

  hasSession(sessionId: string, scope: RuntimeOwnerRequest['scope']): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return false;
    }
    return (
      session.scope.teamId === scope.teamId &&
      session.scope.nodeId === scope.nodeId &&
      session.scope.assignmentId === scope.assignmentId &&
      session.scope.attemptId === scope.attemptId &&
      session.scope.leaseEpoch === scope.leaseEpoch
    );
  }

  sessionIds(scope: RuntimeOwnerRequest['scope']): readonly string[] {
    return [...this.sessions.keys()].filter((id) => this.hasSession(id, scope));
  }

  private notBefore(): number {
    return (
      this.db.prepare('SELECT not_before FROM owner_policy WHERE id=1').get() as {
        not_before: number;
      }
    ).not_before;
  }

  revoke(): void {
    this.db
      .prepare('UPDATE owner_policy SET not_before=? WHERE id=1')
      .run(Math.max(Date.now() + 1, this.notBefore() + 1));
    this.sessions.clear();
  }

  close(): void {
    this.sessions.clear();
    this.db.close();
  }
}
