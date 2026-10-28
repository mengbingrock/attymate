#!/usr/bin/env python3
"""Test a native stock or staged fork installer in a disposable Unix directory.

The kit contains the compiled Worker, mac-relay-test.mjs, and installer scripts.
Uses an isolated local Relay and no model turns. Existing-login access is opt-in;
the default smoke uses an inert test API key in a private home.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import shlex
import signal
import struct
import subprocess
import termios
import time
import urllib.request
import uuid


def wait_for(callback, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = callback()
        if result:
            return result
        time.sleep(.2)
    raise RuntimeError('Timed out waiting for test-owned process')


def run(command, **kwargs):
    return subprocess.run(command, check=True, text=True, capture_output=True, **kwargs)


def shell_value(script, name):
    line = next(line for line in script.splitlines() if line.startswith(name + '='))
    return shlex.split(line.split('=', 1)[1])[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--node', default='/usr/local/bin/node')
    parser.add_argument('--revision', required=True)
    parser.add_argument('--runtime', choices=['stock', 'fork'], default='fork')
    parser.add_argument('--codex-binary', type=Path)
    parser.add_argument('--existing-login', action='store_true')
    parser.add_argument('--reinstall', action='store_true', help='Rerun the installer while its test-owned installation is running')
    args = parser.parse_args()
    if args.runtime == 'stock' and not args.codex_binary:
        parser.error('Stock smoke requires --codex-binary')
    root = args.root.resolve()
    if root.parent != Path('/private/tmp').resolve() or not root.name.startswith('agent-teams-'):
        raise RuntimeError('Use a new agent-teams-* directory under /private/tmp')
    kit = root / 'kit'
    install = root / 'install with spaces'
    home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) if args.existing_login else install / 'codex-home'
    if not args.existing_login:
        home.mkdir(mode=0o700, parents=True, exist_ok=True)
        auth = home / 'auth.json'
        auth.write_text(json.dumps({'OPENAI_API_KEY': 'sk-test-only-no-provider-calls'}))
        auth.chmod(0o600)
        (home / 'config.toml').write_text('[features]\napps = false\nplugins = false\nremote_plugin = false\n')
    config_before_text = (home / 'config.toml').read_text()
    config_before = hashlib.sha256((home / 'config.toml').read_bytes()).hexdigest()
    env = dict(os.environ, PATH='/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', CODEX_HOME=str(home))
    if args.existing_login: env.pop('OPENAI_API_KEY', None)
    else: env['OPENAI_API_KEY'] = 'sk-test-only-no-provider-calls'
    platform = 'darwin-' + ('arm64' if os.uname().machine == 'arm64' else 'x64')
    stage = kit / 'codex-runtime' / platform
    if args.runtime == 'fork' and not stage.exists():
        run([args.node, str(kit / 'stage-codex-runtime.mjs'), '--source', str(root / 'package'),
             '--bundle-dir', str(kit), '--platform', platform, '--revision', args.revision], env=env)
    worker_token = uuid.uuid4().hex + uuid.uuid4().hex
    manager_token = uuid.uuid4().hex + uuid.uuid4().hex
    relay_env = dict(env, AGENT_TEAMS_RELAY_MANAGER_TOKEN=manager_token,
                     AGENT_TEAMS_RELAY_WORKER_TOKEN=worker_token)
    relay_log = root / 'smoke-relay.log'
    supervisor = None
    client_pid = None
    client_fd = None
    with relay_log.open('w') as output:
        relay = subprocess.Popen([args.node, str(kit / 'mac-relay-test.mjs'), '--host', '127.0.0.1',
                                  '--port', '0', '--data-dir', str(root / 'smoke-relay-data')],
                                 env=relay_env, cwd=root, stdin=subprocess.DEVNULL,
                                 stdout=output, stderr=output)
        try:
            def started():
                if relay.poll() is not None:
                    raise RuntimeError('Test relay exited: ' + relay_log.read_text()[-2000:])
                for line in relay_log.read_text().splitlines():
                    if line.startswith('{'):
                        value = json.loads(line)
                        if value.get('event') == 'relay.started':
                            return value
                return None
            address = wait_for(started)
            installer = root / 'smoke-installer.sh'
            run(['bash', str(kit / 'build-installer.sh'), '--bundle-dir', str(kit),
                 '--relay', address['wsUrl'], '--token', worker_token, '--team', str(uuid.uuid4()),
                 '--out', str(installer), '--runtime', args.runtime], env=env, timeout=180)
            print('Built native installer; testing install and private Node selection', flush=True)
            install_args = ['bash', str(installer), '--dir', str(install), '--label', 'Mac reverse SSH smoke', '--no-service', '--no-desktop']
            if not args.existing_login: install_args.append('--private-codex-home')
            if args.runtime == 'stock':
                install_args.extend(['--codex-binary', str(args.codex_binary.resolve())])
            result = subprocess.run(install_args,
                                    env=env, cwd=root, stdin=subprocess.DEVNULL, text=True,
                                    capture_output=True, timeout=240)
            (root / 'installer-output.log').write_text(result.stdout + result.stderr)
            if result.returncode != 0:
                raise RuntimeError('Installer failed: ' + (result.stdout + result.stderr)[-3500:])
            supervisor = int((install / 'data/supervisor.pid').read_text())
            if args.reinstall:
                previous_supervisor = supervisor
                previous_identity = (install / 'installation.json').read_bytes()
                supervisor = None
                updated = subprocess.run(install_args, env=env, cwd=root, stdin=subprocess.DEVNULL,
                                         text=True, capture_output=True, timeout=240)
                (root / 'reinstaller-output.log').write_text(updated.stdout + updated.stderr)
                if updated.returncode != 0:
                    raise RuntimeError('Reinstall failed: ' + (updated.stdout + updated.stderr)[-3500:])
                supervisor = int((install / 'data/supervisor.pid').read_text())
                if supervisor == previous_supervisor or 'Stopping the existing installation' not in updated.stdout:
                    raise RuntimeError('Reinstall did not replace its running supervisor')
                if previous_identity != (install / 'installation.json').read_bytes():
                    raise RuntimeError('Reinstall changed the installation identity')
            script = (install / 'bin/start.sh').read_text()
            node = shell_value(script, 'NODE')
            binary = shell_value(script, 'CODEX')
            socket = shell_value(script, 'APP_SERVER_SOCK')
            status = json.loads(run([node, str(install / 'worker/cli.js'), 'status', '--data-dir',
                                    str(install / 'data'), '--codex-home', str(home),
                                    '--app-server-mode', 'shared-daemon', '--app-server-connect-only',
                                    '--app-server-socket', socket], env=env, cwd=root).stdout)
            request = urllib.request.Request(address['httpUrl'] + '/v2/workers',
                                             headers={'authorization': 'Bearer ' + manager_token})
            with urllib.request.urlopen(request) as response:
                workers = json.load(response)['workers']
            if len(workers) != 1 or workers[0]['status'] != 'connected':
                raise RuntimeError('Test worker did not connect to isolated relay')
            for resource, field in [('commands', 'commands'), ('leases', 'leases')]:
                request = urllib.request.Request(address['httpUrl'] + '/v2/' + resource,
                                                 headers={'authorization': 'Bearer ' + manager_token})
                with urllib.request.urlopen(request) as response:
                    if json.load(response)[field]:
                        raise RuntimeError('Unexpected workload during connection-only smoke')
            client_pid, client_fd = pty.fork()
            if client_pid == 0:
                os.chdir(install / 'workspace')
                os.execve('/bin/bash', ['bash', str(install / 'bin/attach.sh'), '--no-alt-screen'],
                          dict(env, TERM='xterm-256color'))
            fcntl.ioctl(client_fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
            capture = b''
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                readable, _, _ = select.select([client_fd], [], [], .2)
                if readable:
                    try:
                        data = os.read(client_fd, 65536)
                    except OSError:
                        break
                    if not data:
                        break
                    capture += data
                    if b'\x1b[6n' in data:
                        os.write(client_fd, b'\x1b[1;1R')
            screen = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', capture.decode(errors='replace'))
            (root / 'client-screen.txt').write_text(screen)
            exited, exit_status = os.waitpid(client_pid, os.WNOHANG)
            if exited:
                client_pid = None
                raise RuntimeError('Client exited before interaction: ' + screen[-2500:])
            if not re.search(r'agents|sessions|tasks', screen, re.IGNORECASE):
                raise RuntimeError('Client did not render its session browser: ' + screen[-2500:])
            desktop_probe = root / 'desktop-probe.mjs'
            desktop_probe.write_text('''
const client = new WebSocket(process.env.CODEX_APP_SERVER_WS_URL);
const deadline = setTimeout(() => { console.error('Desktop transport timed out'); process.exit(1); }, 10000);
client.onopen = () => client.send(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'agent-teams-desktop-smoke',version:'1'},capabilities:{experimentalApi:true}}}));
client.onmessage = event => {
  const value = JSON.parse(event.data);
  if (value.error) { console.error(JSON.stringify(value.error)); process.exit(1); }
  if (value.id === 1) {
    client.send(JSON.stringify({method:'initialized',params:{}}));
    client.send(JSON.stringify({id:2,method:'config/read',params:{includeLayers:false}}));
  }
  // The launcher owns transport cleanup when its child exits, just as it does for the GUI.
  if (value.id === 2) { console.log(JSON.stringify({ok:true,configRead:true})); clearTimeout(deadline); process.exit(0); }
};
client.onerror = () => { console.error('Desktop transport failed'); process.exit(1); };
''')
            try:
                (install / 'desktop-data').mkdir(mode=0o700, exist_ok=True)
                desktop = run([node, str(install / 'worker/desktopBridgeCli.js'), socket,
                               shell_value(script, 'CONTROL_SOCK'),
                               str(home), str(install / 'desktop-data'), node, str(desktop_probe)],
                              env=env, cwd=root, timeout=20)
            except subprocess.CalledProcessError as error:
                raise RuntimeError('Desktop transport failed: ' + error.stderr[-2000:]) from error
            if not json.loads(desktop.stdout)['configRead']:
                raise RuntimeError('Desktop transport could not read daemon config')
            descriptor = json.loads((install / 'data/runtime-installation.json').read_text())
            config_after = (home / 'config.toml').read_text()
            if config_before_text.strip() not in config_after:
                raise RuntimeError('Installer changed the unrelated Codex configuration')
            if descriptor['controlMcpName'] not in config_after:
                raise RuntimeError('Installer did not persist its owned MCP registration')
            report = {'ok': True, 'runtime': args.runtime, 'platform': platform, 'binary': binary,
                      'binaryVersion': descriptor['binaryVersion'],
                      'binarySha256': hashlib.sha256(Path(binary).read_bytes()).hexdigest(),
                      'nodeVersion': run([node, '--version'], env=env).stdout.strip(),
                      'connectedWorkers': len(workers), 'connectOnly': status['appServer']['connectOnly'],
                      'clientRendered': True, 'socket': socket, 'providerAuthenticationTested': False,
                      'codexHome': str(home), 'existingHomeUsed': args.existing_login,
                      'configUnchanged': config_before == hashlib.sha256((home / 'config.toml').read_bytes()).hexdigest(),
                      'unrelatedConfigPreserved': True,
                      'modelTurnsStarted': 0, 'testDirectory': str(root)}
            report['desktopTransportTested'] = True
            report['desktopGuiRendered'] = False
            report['runningInstallationUpdated'] = args.reinstall
            (root / 'mac-smoke-result.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report), flush=True)
            if not args.existing_login:
                print('Client screen: ' + screen[-2000:], flush=True)
        finally:
            if client_pid is not None:
                os.kill(client_pid, signal.SIGTERM)
                os.waitpid(client_pid, 0)
            if client_fd is not None:
                os.close(client_fd)
            pid_file = install / 'data/supervisor.pid'
            if supervisor is None and pid_file.exists():
                supervisor = int(pid_file.read_text())
            if supervisor is not None:
                os.kill(supervisor, signal.SIGTERM)
                wait_for(lambda: not pid_file.exists(), timeout=30)
            relay.terminate()
            try:
                relay.wait(timeout=15)
            except subprocess.TimeoutExpired:
                relay.kill()
                relay.wait()


if __name__ == '__main__':
    main()
