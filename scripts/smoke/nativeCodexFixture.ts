/** Native-engine fixtures: loopback Responses only, isolated homes, and owned process cleanup. */
import assert from 'node:assert/strict';
import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { open, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  CodexAppServerDaemonFactory,
  type WorkerCodexAppServerSession,
} from '../../packages/agent-teams-worker/src/codexAppServerClient';
import type { FixtureRequest } from './nativeResponsesFixture';

export const verifyWakeDelivery = (
  requests: { body: FixtureRequest }[],
  message: string,
  mode: 'inline' | 'mcp-inbox'
) => {
  assert.ok(requests.length > 0, 'Wake-up did not reach the local model fixture');
  for (const request of requests) {
    const wake = request.body.input?.filter((item) => item.role === 'user').at(-1);
    assert.equal(
      JSON.stringify(wake).includes(message),
      mode === 'inline',
      'Wake message delivery mode mismatch'
    );
  }
  if (mode === 'mcp-inbox') {
    assert.ok(
      requests.some(({ body }) =>
        body.input?.some(
          (item) =>
            item.type === 'function_call_output' && JSON.stringify(item.output).includes(message)
        )
      ),
      'Model did not receive the message body through an actual native MCP tool result'
    );
  }
};

export const waitFor = async (
  check: () => Promise<boolean>,
  description: string,
  timeoutMs = 30000
) => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(description + (lastError instanceof Error ? ': ' + lastError.message : ''));
};

export const stopOwnedProcess = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await stopped;
  } finally {
    clearTimeout(timer);
  }
};

export const startNativeServer = async (
  root: string,
  kind: string,
  binary: string,
  responsesUrl: string
) => {
  const home = join(root, kind + '-home'),
    project = join(root, kind + '-project');
  await mkdir(home, { mode: 0o700 });
  await mkdir(project, { mode: 0o700 });
  const config = [
    'model_provider = "smoke"',
    'model = "native-smoke-model"',
    'model_context_window = 16000',
    'approval_policy = "on-request"',
    'sandbox_mode = "read-only"',
    '[features]',
    'apps = false',
    'plugins = false',
    'remote_plugin = false',
    '[model_providers.smoke]',
    'name = "Loopback smoke fixture"',
    'base_url = ' + JSON.stringify(responsesUrl),
    'wire_api = "responses"',
    'env_key = "AGENT_TEAMS_SMOKE_MODEL_KEY"',
    'requires_openai_auth = false',
    'supports_websockets = false',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '[projects.' + JSON.stringify(project) + ']',
    'trust_level = "trusted"',
    '',
  ].join('\n');
  await writeFile(join(home, 'config.toml'), config, { mode: 0o600 });
  const socket = join(root, kind + '.sock');
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: home,
    AGENT_TEAMS_SMOKE_MODEL_KEY: 'inert-local-fixture',
    OPENAI_API_KEY: undefined,
    CODEX_API_KEY: undefined,
    CODEX_ACCESS_TOKEN: undefined,
  };
  const version = (await promisify(execFile)(binary, ['--version'], { env })).stdout.trim();
  const sha256 = createHash('sha256')
    .update(await readFile(binary))
    .digest('hex');
  const log = await open(join(root, kind + '-server.log'), 'a', 0o600);
  const child = spawn(binary, ['app-server', '--listen', 'unix://' + socket], {
    cwd: project,
    env,
    stdio: ['ignore', log.fd, log.fd],
  });
  await log.close();
  const factory = new CodexAppServerDaemonFactory({
    binaryPath: binary,
    codexHome: home,
    socketPath: socket,
    ensureDaemon: false,
    env,
    requestTimeoutMs: 30000,
  });
  try {
    await waitFor(async () => {
      assert.equal(child.exitCode, null, kind + ' App Server exited');
      const probe = await factory.open();
      await probe.close();
      return true;
    }, kind + ' App Server did not initialize');
    return { kind, binary, home, project, socket, version, sha256, child, factory };
  } catch (error) {
    await stopOwnedProcess(child);
    throw error;
  }
};

export const callRuntimeTool = async (
  session: WorkerCodexAppServerSession,
  threadId: string,
  name: string,
  arguments_: unknown = {}
) => {
  const result = await session.request<unknown>('mcpServer/tool/call', {
    threadId,
    server: 'agent-teams-runtime',
    tool: name,
    arguments: arguments_,
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('"isError":true'), 'MCP tool failed: ' + serialized);
  return serialized;
};

export const verifyNativeClient = async (engine: Awaited<ReturnType<typeof startNativeServer>>) => {
  const observer = await engine.factory.open();
  try {
    const result = await promisify(execFile)(
      'python3',
      [
        fileURLToPath(new URL('./nativeCodexClient.py', import.meta.url)),
        engine.binary,
        'unix://' + engine.socket,
        engine.project,
        'native-' + engine.kind,
      ],
      {
        env: {
          ...process.env,
          HOME: engine.home,
          USERPROFILE: engine.home,
          CODEX_HOME: engine.home,
          AGENT_TEAMS_SMOKE_MODEL_KEY: 'inert-local-fixture',
          OPENAI_API_KEY: undefined,
          CODEX_API_KEY: undefined,
          CODEX_ACCESS_TOKEN: undefined,
        },
        timeout: 20000,
      }
    );
    const attached = JSON.parse(result.stdout) as { attached: boolean };
    assert.equal(attached.attached, true);
    const threads = await observer.request('thread/list', {});
    assert.ok(JSON.stringify(threads).includes('native-' + engine.kind));
    return { kind: engine.kind, nativeTerminalAttached: true, simultaneousClients: true };
  } finally {
    await observer.close();
  }
};

export const readNativeSmokeArgs = (args: readonly string[]) => {
  const arg = (name: string) => args[args.indexOf(name) + 1];
  const stockBinary = args.includes('--stock') ? arg('--stock') : undefined;
  const forkBinary = args.includes('--fork') ? arg('--fork') : undefined;
  const bundle = args.includes('--worker-bundle') ? arg('--worker-bundle') : undefined;
  if (!stockBinary || !forkBinary || !bundle)
    throw new Error(
      'Required: --stock /official/codex --fork /fork/codex --worker-bundle /compiled/worker-kit'
    );

  const mode = args.includes('--delivery-mode') ? arg('--delivery-mode') : 'both';
  if (mode !== 'both' && mode !== 'inline' && mode !== 'mcp-inbox')
    throw new Error('Unsupported --delivery-mode');
  const deliveryModes: ('inline' | 'mcp-inbox')[] =
    mode === 'both' ? ['inline', 'mcp-inbox'] : [mode];
  return { stockBinary, forkBinary, bundle, deliveryModes };
};
