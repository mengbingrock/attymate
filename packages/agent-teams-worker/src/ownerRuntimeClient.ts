import { randomUUID } from 'node:crypto';

import {
  runtimeControlSchema,
  runtimeSessionCreatedSchema,
  type RuntimeOwnerRequest,
  type RuntimeControl,
  type RuntimeSessionScope,
} from '@claude-teams/agent-teams-protocol';

import { createLocalRuntimeOwnerAuthorizer, requestWorkerControl } from './workerControlServer';
import type { AgentTeamsWorkerStatus } from './workerDaemon';
import type { WorkerAssignment } from './workerAssignmentStore';

/** Owner-only client; it needs local IPC, never the Relay's global manager credential. */
export const createOwnerRuntimeClient = async (socketPath: string, relayOverride?: string) => {
  if (!relayOverride) {
    const snapshot = await requestWorkerControl<{ scope?: RuntimeSessionScope }>(
      socketPath,
      '/v2/runtime-owner/snapshot'
    );
    return {
      scope: snapshot.scope,
      read: async (_after = 0) =>
        requestWorkerControl<unknown>(socketPath, '/v2/runtime-owner/snapshot'),
      control: async (input: RuntimeControl) =>
        requestWorkerControl<unknown>(socketPath, '/v2/runtime-owner/control', {
          method: 'POST',
          body: runtimeControlSchema.parse(input),
        }),
    };
  }
  const status = await requestWorkerControl<AgentTeamsWorkerStatus>(
    socketPath,
    '/v2/worker-status'
  );
  const { assignments } = await requestWorkerControl<{ assignments: WorkerAssignment[] }>(
    socketPath,
    '/v2/assignments'
  );
  const active = assignments.find(
    (a) =>
      a.teamId &&
      a.attemptId &&
      a.leaseEpoch &&
      a.leaseExpiresAt &&
      Date.parse(a.leaseExpiresAt) > Date.now() &&
      ['leased', 'preparing_workspace', 'running', 'waiting_local_approval', 'verifying'].includes(
        a.state
      )
  );
  if (!active?.teamId || !active.attemptId || !active.leaseEpoch)
    throw new Error('No active local assignment is available for owner runtime access');
  const scope: RuntimeOwnerRequest['scope'] = {
    teamId: active.teamId,
    nodeId: status.nodeId,
    assignmentId: active.assignmentId,
    attemptId: active.attemptId,
    leaseEpoch: active.leaseEpoch,
  };
  const url = new URL(
    relayOverride ?? status.relayUrl.replace(/^ws/, 'http').replace(/\/v2\/worker-stream$/, '')
  );
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Owner runtime requires a plain HTTPS or loopback HTTP Relay URL');
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('Remote owner runtime access requires HTTPS');
  const base = url.href.replace(/\/$/, '');
  const authorize = createLocalRuntimeOwnerAuthorizer(socketPath);
  const sessionId = randomUUID();
  const request = async (path: string, body?: unknown, token?: string): Promise<unknown> => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(`Owner runtime request was denied or unavailable (HTTP ${response.status})`);
    return response.json();
  };
  const ownerAuthorization = await authorize({ operation: 'session.open', sessionId, scope });
  const session = runtimeSessionCreatedSchema.parse(
    await request('/v2/runtime-sessions', { ...scope, sessionId, ownerAuthorization })
  );
  return {
    scope: session.scope,
    read: async (after = 0) =>
      request(
        `/v2/runtime-sessions/${sessionId}/events?after=${after}`,
        undefined,
        session.sessionToken
      ),
    control: async (input: RuntimeControl) => {
      const control = runtimeControlSchema.parse(input);
      const proof = await authorize({ operation: 'runtime.control', sessionId, scope, control });
      return request(
        `/v2/runtime-sessions/${sessionId}/controls`,
        { ...control, ownerAuthorization: proof },
        session.sessionToken
      );
    },
  };
};
