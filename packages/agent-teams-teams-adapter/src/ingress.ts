import { createPilotIngress } from '../../../src/features/microsoft-teams/main';

const server = createPilotIngress({ teamsPort: 3978, relayPort: 43170 });
server.listen(43171, '127.0.0.1', () => {
  console.log('Pilot ingress listening on loopback port 43171.');
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    server.close();
  });
