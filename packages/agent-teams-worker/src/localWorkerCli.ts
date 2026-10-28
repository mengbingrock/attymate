import { startLocalWorkerRelay } from './localWorkerRelay';

// This entrypoint keeps the installed Worker on loopback without replacing its runtime/CLI.
const command = process.argv[2]?.startsWith('--') ? 'start' : (process.argv[2] ?? 'start');
let relay: Awaited<ReturnType<typeof startLocalWorkerRelay>> | undefined;
let workerStarted = false;
if (command === 'start') {
  const index = process.argv.indexOf('--relay');
  const tokenIndex = process.argv.indexOf('--relay-token');
  const upstreamUrl = index >= 0 ? process.argv[index + 1] : undefined;
  const token =
    tokenIndex >= 0 ? process.argv[tokenIndex + 1] : process.env.AGENT_TEAMS_RELAY_WORKER_TOKEN;
  if (!upstreamUrl || !token)
    throw new Error('Local worker relay requires --relay and its worker token');
  relay = await startLocalWorkerRelay({ upstreamUrl, token });
  process.argv[index + 1] = relay.url;
  process.stdout.write(
    `${JSON.stringify({ event: 'local-relay.started', localUrl: relay.url, upstreamUrl })}\n`
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      const gracefulWorkerShutdown = workerStarted && process.listenerCount(signal) > 0;
      void relay?.close().finally(() => {
        // The stock entrypoint installs graceful Worker shutdown after its initial handshake.
        if (!gracefulWorkerShutdown) process.exit(0);
      });
    });
  }
}
try {
  // Keep this sibling external when bundling: native archives retain their existing cli.js.
  await import('./cli.js');
  workerStarted = true;
} catch (error) {
  await relay?.close();
  throw error;
}
