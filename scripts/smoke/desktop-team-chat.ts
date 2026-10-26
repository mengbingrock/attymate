/** Opt-in live smoke: fresh test relay/members/workspaces, existing explicit App Server socket. */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { startAgentTeamsRelay } from '../../packages/agent-teams-relay/src/relayServer';
import { RelayMembershipRouteStore } from '../../packages/agent-teams-relay/src/relayMembershipRouteStore';
import { startAgentTeamsWorker } from '../../packages/agent-teams-worker/src/workerDaemon';
import { CodexAppServerDaemonFactory } from '../../packages/agent-teams-worker/src/codexAppServerClient';
import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '../../packages/agent-teams-protocol/src';

const socketPath = process.env.TEST_APP_SERVER_SOCKET;
const bundle = process.env.TEST_WORKER_BUNDLE;
if (!socketPath || !bundle || !process.env.TEST_CODEX_HOME || !process.env.TEST_CODEX_BINARY)
  throw new Error('Explicit test App Server, home, binary, and worker bundle required');
const root = await mkdtemp('/private/tmp/agent-teams-desktop-live-');
console.log(JSON.stringify({ stage: 'starting', root }));
const managerToken = randomBytes(32).toString('hex'),
  workerToken = randomBytes(32).toString('hex');
const relay = await startAgentTeamsRelay({
  host: '127.0.0.1',
  port: 0,
  dataDir: join(root, 'relay'),
  heartbeatIntervalMs: 1000,
  auth: { managerToken, workerToken },
  joinPortal: { publicUrl: 'http://127.0.0.1' },
});
const factory = new CodexAppServerDaemonFactory({
  binaryPath: process.env.TEST_CODEX_BINARY,
  codexHome: process.env.TEST_CODEX_HOME,
  socketPath,
  ensureDaemon: false,
  requestTimeoutMs: 30000,
});
const routes = new RelayMembershipRouteStore(join(root, 'relay'));
const workerOptions: Parameters<typeof startAgentTeamsWorker>[0][] = [];
const workers: Awaited<ReturnType<typeof startAgentTeamsWorker>>[] = [];
const fixtures: {
  dataDir: string;
  code: string;
  nodeId: string;
  membershipId: string;
  control: string;
  requestId: string;
  threadId?: string;
}[] = [];
const session = await factory.open();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(test: () => Promise<boolean>, message: string, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await wait(300);
  }
  throw new Error(message);
}
let finished = false;
try {
  const created = await relay.app.inject({
    method: 'POST',
    url: '/v2/team-directory',
    headers: { authorization: `Bearer ${managerToken}` },
    payload: { name: 'Desktop chat live test', description: 'Disposable test only' },
  });
  assert.equal(created.statusCode, 201);
  const teamId = created.json().team.teamId as string;
  for (const role of ['lead', 'member'] as const) {
    const dataDir = join(root, role);
    await mkdir(dataDir);
    const nodeId = randomUUID(),
      membershipId = randomUUID();
    routes.register({
      teamId,
      membershipId,
      nodeId,
      workspaceId: randomUUID(),
      role,
      label: `desktop-test-${role}`,
    });
    const control = join(root, `${role}.sock`);
    const options: Parameters<typeof startAgentTeamsWorker>[0] = {
      relayUrl: relay.wsUrl,
      relayToken: workerToken,
      dataDir,
      controlSocketPath: control,
      organizationId: organizationIdSchema.parse(randomUUID()),
      personId: personIdSchema.parse(randomUUID()),
      nodeId: nodeIdSchema.parse(nodeId),
      workerInstanceId: workerInstanceIdSchema.parse(randomUUID()),
      workerGeneration: 1,
      label: `desktop-test-${role}`,
      reconnectDelayMs: 500,
      desktopChat: {
        sessionFactory: factory,
        runtimeMcp: {
          command: process.execPath,
          args: [join(bundle, 'runtimeMcpCli.js'), '--socket', control],
        },
      },
    };
    workerOptions.push(options);
    const worker = await startAgentTeamsWorker(options);
    workers.push(worker);
    await worker.ready;
    fixtures.push({
      dataDir,
      code: (await readFile(join(dataDir, 'desktop-pairing-code'), 'utf8')).trim(),
      nodeId,
      membershipId,
      control,
      requestId: randomUUID(),
    });
  }
  await eventually(
    async () =>
      workers.every((w) =>
        w.listTeamMemberships().some((t) => t.teamId === teamId && t.members.length === 2)
      ),
    'Roster not synchronized',
    20000
  );
  for (const f of fixtures) {
    const response = await relay.app.inject({
      method: 'POST',
      url: '/join/api/desktop',
      payload: { pairingCode: f.code, request: { action: 'open', teamId, requestId: f.requestId } },
    });
    assert.equal(response.statusCode, 200, response.body);
    f.threadId = response.json().result.threadId;
    assert.ok(f.threadId);
  }
  console.log(JSON.stringify({ stage: 'chats-open', threads: fixtures.map((f) => f.threadId) }));
  const lead = fixtures[0]!,
    member = fixtures[1]!;
  const inventory = await session.request<{
    data: { name: string; tools: Record<string, unknown> }[];
  }>('mcpServerStatus/list', { threadId: member.threadId });
  assert.ok(
    inventory.data.some(
      (s) => s.name === 'agent-teams-runtime' && s.tools.runtime_context && s.tools.message_send
    )
  );
  await session.request('turn/start', {
    threadId: member.threadId,
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'readOnly' },
    input: [
      {
        type: 'text',
        text: `This is an authorized team messaging smoke test. Call agent-teams-runtime.runtime_context. Then call agent-teams-runtime.message_send to the lead membership ${lead.membershipId} with exactly: "Please reply using message_send to ${member.membershipId} with exactly DESKTOP_TEAM_ECHO_OK. Use tool discovery or the code execution wrapper if needed to find the team tools. Do not use other integrations or read files." Use tool discovery or the code execution wrapper if necessary to locate and call these tools. Do not use shell/file tools or other integrations. Finish with SENT.`,
      },
    ],
  });
  await eventually(async () => {
    const db = new DatabaseSync(join(member.dataDir, 'desktop-chats.sqlite'), { readOnly: true });
    const row = db.prepare("SELECT payload FROM messages WHERE direction='in'").all() as {
      payload: string;
    }[];
    db.close();
    return row.some(
      (r) => (JSON.parse(r.payload) as { text: string }).text === 'DESKTOP_TEAM_ECHO_OK'
    );
  }, 'Lead did not reply through runtime MCP');
  await eventually(async () => {
    const result = await session.request<{
      thread: { turns: unknown[]; status?: { type: string } };
    }>('thread/read', { threadId: member.threadId, includeTurns: true });
    return (
      result.thread.status?.type !== 'active' &&
      JSON.stringify(result.thread.turns).includes('DESKTOP_TEAM_ECHO_OK')
    );
  }, 'Reply did not appear in persistent member chat');
  await workers[1]!.stop();
  workers[1] = await startAgentTeamsWorker({ ...workerOptions[1]!, workerGeneration: 2 });
  await workers[1]!.ready;
  await eventually(
    async () =>
      workers[1]!.listTeamMemberships().some((t) => t.teamId === teamId && t.members.length === 2),
    'Roster missing after restart',
    20000
  );
  await session.request('turn/start', {
    threadId: member.threadId,
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'readOnly' },
    input: [
      {
        type: 'text',
        text: 'The Worker was restarted. Use tool discovery or the execution wrapper to call agent-teams-runtime.runtime_context. If successful, reply exactly DESKTOP_RESTART_OK. Do not use shell/file tools or other integrations.',
      },
    ],
  });
  await eventually(async () => {
    const result = await session.request<{
      thread: { turns: unknown[]; status?: { type: string } };
    }>('thread/read', { threadId: member.threadId, includeTurns: true });
    return (
      result.thread.status?.type !== 'active' &&
      JSON.stringify(result.thread.turns.at(-1)).includes('DESKTOP_RESTART_OK') &&
      JSON.stringify(result.thread.turns.at(-1)).includes('runtime_context')
    );
  }, 'Runtime MCP did not recover after Worker restart');
  const state = {
    restartVerified: true,
    ok: true,
    root,
    relayUrl: relay.httpUrl,
    teamId,
    fixtures,
    socketPath,
    modelMessageReply: 'DESKTOP_TEAM_ECHO_OK',
  };
  await writeFile(join(root, 'state.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      ok: true,
      root,
      relayUrl: relay.httpUrl,
      teamId,
      memberThread: member.threadId,
      leadThread: lead.threadId,
      reply: 'DESKTOP_TEAM_ECHO_OK',
    })
  );
  finished = true;
  if (process.env.TEST_KEEP_RUNNING === '1')
    await new Promise<void>((resolve) => {
      process.once('SIGTERM', resolve);
      process.once('SIGINT', resolve);
    });
} finally {
  await session.close();
  for (const worker of workers) await worker.stop();
  routes.close();
  await relay.close();
  if (!finished) console.error(`Live test failed; artifacts retained in ${root}`);
}
