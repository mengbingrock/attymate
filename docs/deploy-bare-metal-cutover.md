# Bare-metal cutover runbook (Lightsail VPS)

Move the AttyMate server off Docker and onto a host **systemd** service, because the
1.9 GB VPS OOMs during in-container builds. Postgres stays in Docker; only the Node
server moves to bare metal. Build artifacts and a linux-x64 production `node_modules`
were produced on the VPS at `~/attymate-build` (server `dist`, `ui/dist`, native deps
all verified present).

- Host: `ubuntu@44.240.150.216` (key `~/.ssh/lightsail.pem`)
- App dir: `~/attymate-build`  ·  Node: v20.20.2
- Docker: container `paperclip` (server, publishes :3100) + `paperclip-pg` (Postgres)
- Compose: `/opt/paperclip/docker-compose.yml`  ·  secrets: `/opt/paperclip/.env`
- Old data volume: `paperclip-data` (container `PAPERCLIP_HOME=/paperclip`)
- Edge: Caddy → `paperclip.attymate.com`

Run everything **on the VPS** (`ssh -i ~/.ssh/lightsail.pem ubuntu@44.240.150.216`).
Phases 0–2 are non-disruptive (prep). Phase 3 is the brief maintenance window.

---

## Phase 0 — Link tsx (runtime dep skipped by --prod)

```bash
cd ~/attymate-build
ln -sfn ../../node_modules/.pnpm/tsx@4.21.0/node_modules/tsx server/node_modules/tsx
node --import ./server/node_modules/tsx/dist/loader.mjs -e 'console.log("tsx loader OK")'
```
Expect `tsx loader OK`. (If the tsx version differs, `ls ~/attymate-build/node_modules/.pnpm | grep '^tsx@'` and use that path.)

## Phase 1 — Publish Postgres to the host

The bare-metal server reaches Postgres on `127.0.0.1:5432` (the old container used the
docker network alias `postgres`). Add a host port publish to the `postgres` service.

In `/opt/paperclip/docker-compose.yml`, under the `postgres:` service add:
```yaml
    ports:
      - "127.0.0.1:5432:5432"
```
Then recreate just Postgres (data persists in the named volume):
```bash
cd /opt/paperclip && sudo docker compose up -d postgres
ss -ltnp | grep 5432    # expect 127.0.0.1:5432 LISTEN
```

## Phase 2 — Snapshot PAPERCLIP_HOME to a host dir

The container's `/paperclip` (config.json with instance secrets, plugins, skill files)
lives in the `paperclip-data` volume. Copy it to a host dir the `ubuntu` user owns.
(uid 1000 == ubuntu, so ownership maps cleanly.)

```bash
VOL=$(docker volume inspect paperclip-data --format '{{.Mountpoint}}')
echo "volume at: $VOL"
sudo rsync -a "$VOL"/ ~/paperclip-home/
sudo chown -R ubuntu:ubuntu ~/paperclip-home
ls ~/paperclip-home/instances/default/config.json   # sanity: instance config present
```

## Phase 3 — Cutover (maintenance window)

### 3a. Build the systemd env file from the existing secrets
Prerequisite: the Azure Document Intelligence key must live in `/opt/paperclip/.env`
(it is NOT in git). Add it once (the endpoint is non-secret and is hard-coded below):
```bash
grep -q AZURE_DOCUMENT_INTELLIGENCE_KEY /opt/paperclip/.env \
  || echo "AZURE_DOCUMENT_INTELLIGENCE_KEY=<paste-the-azure-key>" | sudo tee -a /opt/paperclip/.env
```
```bash
set -a; . /opt/paperclip/.env; set +a
NODE_BIN=$(which node)
sudo tee /etc/paperclip-server.env >/dev/null <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=3100
SERVE_UI=true
PAPERCLIP_HOME=/home/ubuntu/paperclip-home
HOME=/home/ubuntu
PAPERCLIP_INSTANCE_ID=default
PAPERCLIP_CONFIG=/home/ubuntu/paperclip-home/instances/default/config.json
PAPERCLIP_DEPLOYMENT_MODE=authenticated
PAPERCLIP_DEPLOYMENT_EXPOSURE=private
OPENCODE_ALLOW_ALL_MODELS=true
DATABASE_URL=postgres://paperclip:${POSTGRES_PASSWORD}@127.0.0.1:5432/paperclip
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
PAPERCLIP_RUNNER_TOKEN=${PAPERCLIP_RUNNER_TOKEN}
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://pdf-instance.cognitiveservices.azure.com/
AZURE_DOCUMENT_INTELLIGENCE_KEY=${AZURE_DOCUMENT_INTELLIGENCE_KEY}
EOF
sudo chmod 600 /etc/paperclip-server.env
echo "node bin: $NODE_BIN"   # used in the unit below
```

### 3b. Write the systemd unit (set ExecStart node path = $NODE_BIN above)
```bash
sudo tee /etc/systemd/system/paperclip.service >/dev/null <<EOF
[Unit]
Description=AttyMate/Paperclip server (bare-metal)
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/attymate-build
EnvironmentFile=/etc/paperclip-server.env
ExecStart=${NODE_BIN} --import ./server/node_modules/tsx/dist/loader.mjs server/dist/index.js
Restart=on-failure
RestartSec=3
StandardOutput=append:/var/log/paperclip-server.log
StandardError=append:/var/log/paperclip-server.log

[Install]
WantedBy=multi-user.target
EOF
sudo touch /var/log/paperclip-server.log && sudo chown ubuntu:ubuntu /var/log/paperclip-server.log
sudo systemctl daemon-reload
```

### 3c. Stop the old container, start the service (frees :3100)
```bash
cd /opt/paperclip && sudo docker compose stop paperclip   # keep postgres running
sudo systemctl enable --now paperclip
sleep 6
tail -n 60 /var/log/paperclip-server.log                  # expect migrations + "listening"
curl -fsS http://127.0.0.1:3100/health || curl -i http://127.0.0.1:3100/
```

### 3d. Caddy
If the Caddy `reverse_proxy` for `paperclip.attymate.com` already targets
`127.0.0.1:3100` (it proxied the container's published port), **no change needed** —
systemd now owns that port. Confirm with:
```bash
sudo grep -n "paperclip.attymate.com" -A4 /etc/caddy/Caddyfile
```
Only if it targets something else (e.g. a container name/IP), repoint it to
`127.0.0.1:3100` and `sudo systemctl reload caddy`.

### 3e. Verify live
```bash
curl -I https://paperclip.attymate.com/        # 200
```
Then in the browser, hard-reload and confirm the three UI changes are live:
1. adapter labels: "(User's Local)" / "(Server's Remote)"
2. new-agent default adapter = "Codex (User's Local)", model "Default"
3. workspace switcher shows only companies you belong to.

---

## Rollback (any failure in Phase 3)
```bash
sudo systemctl disable --now paperclip
cd /opt/paperclip && sudo docker compose start paperclip
curl -I https://paperclip.attymate.com/
```

## Azure Document Intelligence env (docling run-azure stage)

The `docling-pdf-processing` skill's `run-azure` stage reads
`AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` / `AZURE_DOCUMENT_INTELLIGENCE_KEY` from
`os.environ`. The California-litigation agents are all `codex_local` (server-side), and
the adapter spawns Codex with `{ ...process.env, ...bindings }` — so anything in the
**server process env** flows through Codex into the Python subprocess. Putting these in
the deploy env therefore makes the skill work for every agent with **no per-agent
config and no import-time entry** (the manifest declares them `optional`, documentation
only). The key stays out of git, in the deploy env only.

- **Bare-metal (systemd):** handled by Phase 3a above (`/etc/paperclip-server.env`).
- **Current Docker prod (until cutover)** — make it work now:
  ```bash
  # 1. add the key to the env file (endpoint can go here too; both non-committed)
  grep -q AZURE_DOCUMENT_INTELLIGENCE_KEY /opt/paperclip/.env \
    || printf 'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=%s\nAZURE_DOCUMENT_INTELLIGENCE_KEY=%s\n' \
       'https://pdf-instance.cognitiveservices.azure.com/' '<paste-the-azure-key>' \
       | sudo tee -a /opt/paperclip/.env
  # 2. ensure the paperclip service passes them through (docker-compose.yml, paperclip service):
  #      environment:
  #        AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: ${AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT}
  #        AZURE_DOCUMENT_INTELLIGENCE_KEY: ${AZURE_DOCUMENT_INTELLIGENCE_KEY}
  # 3. recreate just the app container:
  cd /opt/paperclip && sudo docker compose up -d paperclip
  # 4. verify inside the container:
  sudo docker compose exec paperclip printenv AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
  ```

> Rotate the key after wiring it up if it was ever shared in plaintext.

## Known follow-ups (not blocking the cutover)
- Global agent CLIs (`@anthropic-ai/claude-code`, `@openai/codex`, `opencode-ai`) were
  installed in the Docker image but are **not** on the host. Server-side ("Server's
  Remote") adapters that shell out to them will fail until installed:
  `sudo npm i -g @anthropic-ai/claude-code @openai/codex opencode-ai`. Runner-based
  ("User's Local") agents are unaffected.
- `tsx` symlink hardcodes `tsx@4.21.0`; re-link if the lockfile bumps it. Better:
  move `tsx` to server `dependencies` so `--prod` keeps it.
```
