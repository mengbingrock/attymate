// Native Windows installer/supervisor. Never starts a stock daemon or copies a login.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [command, inputDir, ...extra] = process.argv.slice(2);
if (process.platform !== 'win32') throw new Error('This installer requires native Windows.');
const dir = resolve(inputDir);
const worker = join(dir, 'worker');
const self = fileURLToPath(import.meta.url);
const configPath = join(dir, 'config.json');
const psQuote = (value) => "'" + value.replaceAll("'", "''") + "'";
const powershell = (script) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const run = (binary, args, env = process.env) => {
  const result = spawnSync(binary, args, { env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed: ${binary} (exit ${result.status})`);
};
const verify = (root) => {
  const manifest = JSON.parse(readFileSync(join(root, 'runtime-manifest.json'), 'utf8'));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform !== 'win32-x64' ||
    !manifest.revision ||
    !manifest.files?.['bin/codex.exe']
  )
    throw new Error('Invalid Windows runtime manifest');
  const seen = new Set();
  const visit = (path, prefix = '') => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const key = prefix + entry.name;
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file, key + '/');
      else if (!entry.isFile() || lstatSync(file).isSymbolicLink())
        throw new Error('Unsafe runtime entry: ' + key);
      else if (key !== 'runtime-manifest.json') {
        if (createHash('sha256').update(readFileSync(file)).digest('hex') !== manifest.files[key])
          throw new Error('Runtime checksum mismatch: ' + key);
        seen.add(key);
      }
    }
  };
  visit(root);
  if (seen.size !== Object.keys(manifest.files).length) throw new Error('Incomplete runtime');
  console.log(`Verified customized Codex ${manifest.revision} for Windows x64`);
};

if (command === 'install') {
  for (const name of ['data', 'workspace', 'logs', 'bin', 'codex-state', 'desktop-data'])
    mkdirSync(join(dir, name), { recursive: true });
  if (existsSync(join(dir, 'data', 'supervisor.pid')))
    throw new Error('Stop this installation before replacing it.');
  const runtime = join(worker, 'codex-runtime', 'win32-x64');
  verify(runtime);
  const binary = join(runtime, 'bin', 'codex.exe');
  const env = process.env;
  const home = resolve(
    env.AGENT_TEAMS_INSTALL_CODEX_HOME ||
      (env.AGENT_TEAMS_INSTALL_PRIVATE_HOME === 'True'
        ? join(dir, 'codex-home')
        : env.CODEX_HOME || join(homedir(), '.codex'))
  );
  if (existsSync(home) && (!lstatSync(home).isDirectory() || lstatSync(home).isSymbolicLink()))
    throw new Error('Codex home must be a directory, not a link.');
  mkdirSync(home, { recursive: true });
  const loginEnv = { ...env, CODEX_HOME: home };
  if (spawnSync(binary, ['login', 'status'], { env: loginEnv, stdio: 'ignore' }).status !== 0)
    run(binary, ['login', '--device-auth'], loginEnv);
  let config;
  if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'));
  else {
    if (
      !/^wss?:\/\//.test(env.AGENT_TEAMS_INSTALL_RELAY || '') ||
      !env.AGENT_TEAMS_INSTALL_TOKEN ||
      !/^[a-f0-9-]{36}$/.test(env.AGENT_TEAMS_INSTALL_TEAM || '')
    )
      throw new Error('Invalid enrollment');
    const id = randomBytes(12).toString('hex');
    config = {
      node: process.execPath,
      binary,
      home,
      relay: env.AGENT_TEAMS_INSTALL_RELAY,
      token: env.AGENT_TEAMS_INSTALL_TOKEN,
      team: env.AGENT_TEAMS_INSTALL_TEAM,
      label: env.AGENT_TEAMS_INSTALL_LABEL,
      organization: randomUUID(),
      person: randomUUID(),
      nodeId: randomUUID(),
      instance: randomUUID(),
      control: '\\\\.\\pipe\\agent-teams-' + id,
      serverToken: randomBytes(32).toString('hex'),
    };
    save(configPath, config);
  }
  for (const mode of ['start', 'stop', 'status', 'attach', 'desktop']) {
    writeFileSync(
      join(dir, 'bin', mode + '.ps1'),
      '& ' +
        psQuote(process.execPath) +
        ' ' +
        psQuote(self) +
        ' ' +
        mode +
        ' ' +
        psQuote(dir) +
        ' @args\n'
    );
  }
  run(process.execPath, [
    join(worker, 'cli.js'),
    'setup',
    '--control-socket',
    config.control,
    '--codex-config',
    join(home, 'config.toml'),
  ]);
  if (env.AGENT_TEAMS_INSTALL_NO_SERVICE !== 'True') {
    const action =
      '& ' + psQuote(process.execPath) + ' ' + psQuote(self) + ' start ' + psQuote(dir);
    const startup = join(
      process.env.APPDATA,
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup',
      'AgentTeams-' + config.nodeId + '.lnk'
    );
    powershell(
      '$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut(' +
        psQuote(startup) +
        ');$s.TargetPath="powershell.exe";$s.Arguments=' +
        psQuote('-NoProfile -WindowStyle Hidden -Command ' + action) +
        ';$s.WindowStyle=7;$s.Save()'
    );
    console.log('Enabled this installation at user sign-in.');
  }
  console.log('Using existing Codex login at ' + home);
  if (env.AGENT_TEAMS_INSTALL_NO_START !== 'True') {
    run(process.execPath, [self, 'start', dir]);
    let connected = false;
    for (let i = 0; i < 300; i++) {
      try {
        const status = JSON.parse(readFileSync(join(dir, 'data', 'worker-status.json'), 'utf8'));
        if (status.state === 'connected') {
          connected = true;
          break;
        }
      } catch {
        /* waiting for first status */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!connected) throw new Error('Worker did not connect; see logs/supervisor.log');
    console.log(
      'Connected. Private device pairing code: ' +
        readFileSync(join(dir, 'data', 'desktop-pairing-code'), 'utf8').trim()
    );
  }
  console.log('Installed. Open PowerShell and run: & ' + psQuote(join(dir, 'bin', 'desktop.ps1')));
  process.exit(0);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const pidFile = join(dir, 'data', 'supervisor.pid');
const endpointPath = join(dir, 'data', 'app-server.json');
const alive = () => {
  try {
    const pid = +readFileSync(pidFile, 'utf8');
    process.kill(pid, 0);
    return pid;
  } catch {
    return undefined;
  }
};
const childEnv = {
  ...process.env,
  CODEX_HOME: config.home,
  AGENT_TEAMS_APP_SERVER_TOKEN: config.serverToken,
  AGENT_TEAMS_RELAY_WORKER_TOKEN: config.token,
  AGENT_TEAMS_AUTO_JOIN_TEAM_ID: config.team,
};
const endpoint = () => JSON.parse(readFileSync(endpointPath, 'utf8')).url;
if (command === 'start') {
  if (alive()) throw new Error('This installation is already running.');
  for (const path of [pidFile, endpointPath]) {
    try {
      unlinkSync(path);
    } catch {
      /* stale or absent */
    }
  }
  const log = openSync(join(dir, 'logs', 'supervisor.log'), 'a');
  const child = spawn(process.execPath, [self, 'run', dir], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    env: childEnv,
  });
  child.unref();
  closeSync(log);
  for (let i = 0; i < 200; i++) {
    if (existsSync(endpointPath) && alive()) {
      console.log('Customized App Server started.');
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Startup timed out; see logs/supervisor.log');
} else if (command === 'run') {
  let lock;
  try {
    lock = openSync(pidFile, 'wx');
  } catch {
    throw new Error('Supervisor lock exists; stop the installation first.');
  }
  writeFileSync(lock, String(process.pid));
  closeSync(lock);
  const children = [];
  const cleanup = () => {
    for (const child of children) {
      try {
        child.kill();
      } catch {
        /* exited */
      }
    }
    for (const path of [pidFile, endpointPath]) {
      try {
        unlinkSync(path);
      } catch {
        /* absent */
      }
    }
  };
  process.on('exit', cleanup);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const url = 'ws://127.0.0.1:' + port;
  const tokenPath = join(dir, 'data', 'app-server-token');
  writeFileSync(tokenPath, config.serverToken);
  const state = 'sqlite_home=' + JSON.stringify(join(dir, 'codex-state'));
  const serverLog = openSync(join(dir, 'logs', 'app-server.log'), 'a');
  const server = spawn(
    config.binary,
    [
      '-c',
      state,
      'app-server',
      '--listen',
      url,
      '--ws-auth',
      'capability-token',
      '--ws-token-file',
      tokenPath,
    ],
    { env: childEnv, windowsHide: true, stdio: ['ignore', serverLog, serverLog] }
  );
  closeSync(serverLog);
  children.push(server);
  server.on('error', (e) => {
    console.error(e);
    process.exit(1);
  });
  server.on('exit', () => process.exit(1));
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/readyz');
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error('Customized App Server did not become ready.');
  const workerProcess = spawn(
    process.execPath,
    [
      join(worker, 'cli.js'),
      'start',
      '--app-server-mode',
      'shared-daemon',
      '--app-server-connect-only',
      '--app-server-socket',
      url,
      '--relay',
      config.relay,
      '--data-dir',
      join(dir, 'data'),
      '--control-socket',
      config.control,
      '--codex-home',
      config.home,
      '--runtime-cwd',
      join(dir, 'workspace'),
      '--codex-binary',
      config.binary,
      '--label',
      config.label,
      '--organization-id',
      config.organization,
      '--person-id',
      config.person,
      '--node-id',
      config.nodeId,
      '--worker-instance-id',
      config.instance,
    ],
    { env: childEnv, windowsHide: true, stdio: 'inherit' }
  );
  children.push(workerProcess);
  workerProcess.on('error', (e) => {
    console.error(e);
    process.exit(1);
  });
  workerProcess.on('exit', () => process.exit(1));
  save(endpointPath, { url });
} else if (command === 'stop') {
  const pid = alive();
  if (pid) {
    const info = JSON.parse(
      powershell(
        '(Get-CimInstance Win32_Process -Filter ' +
          psQuote('ProcessId=' + pid) +
          ').CommandLine | ConvertTo-Json'
      ).toString()
    );
    if (!info || !info.includes(self) || !info.includes(dir))
      throw new Error('PID does not belong to this installation.');
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'inherit' });
  }
  for (const path of [pidFile, endpointPath]) {
    try {
      unlinkSync(path);
    } catch {
      /* absent */
    }
  }
} else if (command === 'status') {
  console.log(JSON.stringify({ running: !!alive(), nodeId: config.nodeId }));
  if (existsSync(join(dir, 'data', 'worker-status.json')))
    console.log(readFileSync(join(dir, 'data', 'worker-status.json'), 'utf8'));
} else if (command === 'attach') {
  run(
    config.binary,
    [
      '--remote',
      endpoint(),
      '--remote-auth-token-env',
      'AGENT_TEAMS_APP_SERVER_TOKEN',
      'agents',
      ...extra,
    ],
    childEnv
  );
} else if (command === 'desktop') {
  const candidates = [
    extra[0],
    join(process.env.LOCALAPPDATA, 'Programs', 'Codex', 'Codex.exe'),
    join(process.env.LOCALAPPDATA, 'Programs', 'ChatGPT', 'ChatGPT.exe'),
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  if (!executable)
    throw new Error('Pass your installed Codex desktop .exe path as the first argument.');
  run(
    process.execPath,
    [
      join(worker, 'desktopBridgeCli.js'),
      endpoint(),
      config.control,
      config.home,
      join(dir, 'desktop-data'),
      executable,
      '--user-data-dir=' + join(dir, 'desktop-data'),
    ],
    childEnv
  );
} else throw new Error('Unknown installation command: ' + command);
