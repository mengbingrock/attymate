/** Opt-in native stock/fork smoke. All models, teams, homes and projects are disposable local fixtures. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readNativeSmokeArgs,
  startNativeServer,
  stopOwnedProcess,
  verifyNativeClient,
} from './nativeCodexFixture';
import { runNativeOrientation } from './nativeCodexTeamScenario';
import { startResponsesFixture } from './nativeResponsesFixture';

const { stockBinary, forkBinary, bundle, deliveryModes } = readNativeSmokeArgs(process.argv);
// macOS's default temp directory can exceed the Unix control socket path limit.
const root = await mkdtemp(
  join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'agt-native-')
);
console.log(JSON.stringify({ stage: 'starting', root }));
const responses = await startResponsesFixture();
const engines: Awaited<ReturnType<typeof startNativeServer>>[] = [];
const evidence: Record<string, unknown>[] = [];
const emit = (stage: string, detail: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ stage, ...detail }));

try {
  engines.push(await startNativeServer(root, 'stock', stockBinary, responses.url));
  engines.push(await startNativeServer(root, 'fork', forkBinary, responses.url));
  emit('servers-ready', {
    engines: engines.map(({ kind, version, sha256 }) => ({ kind, version, sha256 })),
  });
  for (const mode of deliveryModes) {
    await runNativeOrientation({
      root,
      bundle,
      leadKind: 'stock',
      deliveryMode: mode,
      engines,
      responses,
      evidence,
      emit,
    });
    await runNativeOrientation({
      root,
      bundle,
      leadKind: 'fork',
      deliveryMode: mode,
      engines,
      responses,
      evidence,
      emit,
    });
  }
  for (const engine of engines) evidence.push(await verifyNativeClient(engine));
  assert.ok(responses.requests.length >= 6, 'Native model turns did not reach the local fixture');
  const result = {
    ok: true,
    root,
    engines: engines.map(({ kind, version, sha256 }) => ({ kind, version, sha256 })),
    localModelRequests: responses.requests.length,
    modelMcpCalls: responses.toolCalls,
    evidence,
  };
  await writeFile(join(root, 'evidence.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  emit('complete', result);
} catch (error) {
  await writeFile(
    join(root, 'failure.json'),
    JSON.stringify(
      { message: error instanceof Error ? error.message : String(error), evidence },
      null,
      2
    ),
    { mode: 0o600 }
  );
  throw error;
} finally {
  for (const engine of engines) await stopOwnedProcess(engine.child);
  await responses.close();
}
