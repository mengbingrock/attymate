/* global process, setTimeout */

import readline from 'node:readline';

const reader = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let initializeParams;

reader.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    initializeParams = message.params;
    send({ id: message.id, result: { userAgent: 'fake-codex-app-server' } });
    return;
  }
  if (message.method === 'initialized') {
    setTimeout(() => {
      send({
        id: 900,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'thr_fixture', turnId: 'turn_fixture' },
      });
    }, 25);
    return;
  }
  if (message.id === 900) {
    send({ method: 'fixture/serverRequestResolved', params: message });
    return;
  }
  if (message.id === 'approval-901') {
    send({ method: 'fixture/serverRequestResolved', params: message });
    return;
  }
  if (message.method === 'fixture/requestStringApproval') {
    send({ id: message.id, result: {} });
    send({
      id: 'approval-901',
      method: 'item/fileChange/requestApproval',
      params: { threadId: 'thr_fixture', turnId: 'turn_fixture' },
    });
    return;
  }
  if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'thr_fixture' } } });
    return;
  }
  if (message.method === 'fixture/getInitializeParams') {
    send({ id: message.id, result: initializeParams });
    return;
  }
  if (message.method === 'fixture/getArgv') {
    send({ id: message.id, result: process.argv.slice(2) });
    return;
  }
  if (message.method === 'fixture/getCodexHome') {
    send({ id: message.id, result: process.env.CODEX_HOME ?? null });
    return;
  }
  if (message.method === 'fixture/crash') {
    process.exit(17);
  }
});
