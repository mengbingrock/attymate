---
title: AWS Lightsail (SSH image ship)
summary: Deploy Paperclip to a single Lightsail VPS by building the image locally and shipping it over SSH (no registry)
---

Deploy Paperclip to a single AWS Lightsail VPS using a **build-locally → ship-image-over-SSH → load-and-recreate** flow. There is **no container registry** (no ECR / `docker push`): the image is saved to a gzipped tarball, `rsync`'d to the box, and `docker load`ed there. The VPS runs the stack with Docker Compose behind Caddy for TLS.

This is the lightweight alternative to [AWS ECS Fargate](./aws-ecs.md) for a small single-instance deployment.

## Target

- **Host:** `ubuntu@44.240.150.216` (Lightsail, **x86_64 / linux/amd64**)
- **SSH key:** `~/.ssh/lightsail.pem` (mode `600`)
- **Deploy dir:** `/opt/paperclip` — holds `docker-compose.yml` + `.env`
- **Public URL:** `https://paperclip.attymate.com` (health: `/api/health`)
- **Compose services:**
  - `paperclip` — the server (image `paperclip-server:latest`, port 3100)
  - `paperclip-pg` — Postgres 17 (the database)
  - `paperclip-caddy` — TLS / reverse proxy

```bash
# sanity: connect
ssh -i ~/.ssh/lightsail.pem ubuntu@44.240.150.216 'hostname && docker ps --format "{{.Names}}\t{{.Status}}"'
```

## Prerequisites on the build machine

Docker with **buildx/BuildKit** (the Dockerfile uses `COPY --parents`, which silently no-ops on the legacy builder). On macOS with Colima:

```bash
brew install colima docker docker-buildx
# register buildx as a Docker CLI plugin
mkdir -p ~/.docker/cli-plugins
ln -sfn "$(brew --prefix)/opt/docker-buildx/bin/docker-buildx" ~/.docker/cli-plugins/docker-buildx
# the UI/Vite build OOMs on a small VM — give the VM real memory
colima start --cpu 8 --memory 12
docker buildx version   # should print a version
```

## Deploy (run from the repo root)

```bash
export PATH="/opt/homebrew/bin:$PATH"   # if brew tools aren't on PATH

# 1. Build FOR THE VPS ARCH — must be linux/amd64 (the VPS is x86_64).
#    Plain `docker build` on Apple Silicon produces arm64, which loads fine but
#    will NOT start on the VPS (exec format error). Always cross-build + --load.
docker buildx build --platform linux/amd64 -t paperclip-server:latest --load .

# 1a. Verify arch BEFORE shipping ~1 GB.
docker image inspect paperclip-server:latest --format '{{.Os}}/{{.Architecture}}'   # → linux/amd64

# 2. Save + gzip (~1 GB).
docker save paperclip-server:latest | gzip -1 > /tmp/paperclip-server.tgz

# 3. Ship to the VPS. NOTE: macOS rsync is openrsync — use plain flags only,
#    NOT --info=progress2 (unsupported; it prints the usage text and exits).
rsync -a --partial -e "ssh -i ~/.ssh/lightsail.pem" \
  /tmp/paperclip-server.tgz ubuntu@44.240.150.216:/tmp/paperclip-server.tgz

# 4. Reclaim disk on the VPS BEFORE loading. Each deploy leaves a ~4.5 GB image
#    behind; on a 58 GB disk they pile up fast and `docker load` eventually fails
#    with "no space left on device". `docker image prune -f` removes only
#    dangling/untagged images — never the running container's image, :latest,
#    postgres, or caddy — so it is safe to run on every deploy.
ssh -i ~/.ssh/lightsail.pem ubuntu@44.240.150.216 'docker image prune -f && df -h / | tail -1'

# 5. Load the image + recreate the container on the VPS.
ssh -i ~/.ssh/lightsail.pem ubuntu@44.240.150.216 '
  gunzip -c /tmp/paperclip-server.tgz | docker load &&
  cd /opt/paperclip && docker compose up -d paperclip
'

# 6. Verify.
ssh -i ~/.ssh/lightsail.pem ubuntu@44.240.150.216 'docker inspect -f "{{.State.Health.Status}}" paperclip'
curl -sf -o /dev/null -w "%{http_code}\n" https://paperclip.attymate.com/api/health   # → 200
```

## Verify the new image actually rolled

`docker load` moves the `:latest` tag to the new image id; confirm it changed and the
container was recreated on it:

```bash
ssh -i ~/.ssh/lightsail.pem ubuntu@44.240.150.216 \
  'docker images paperclip-server:latest --format "id={{.ID}} created={{.CreatedSince}}"'
```

## Migrations

The container starts non-TTY, so the server **auto-applies pending DB migrations on
boot** — no manual migrate step. Watch the boot log for the migration line and
`Server listening`:

```bash
ssh -i ~/.ssh/lightsail.pem ubuntu@44.240.150.216 \
  'cd /opt/paperclip && docker compose logs --tail=120 paperclip' \
  | grep -iE "migrat|pending|listening|stale schema|error"
```

If you ever see *"Refusing to start against a stale schema"*, the env needs
`PAPERCLIP_MIGRATION_AUTO_APPLY=true` in `/opt/paperclip/.env` (it should already be
effectively on via the non-TTY path).

## Gotchas (all hit in practice)

- **Architecture:** the image **must** be `linux/amd64`. An arm64 image loads but the
  container won't start. Always run the arch check in step 1a before rsync.
- **Local build OOM:** the UI/Vite build aborts with exit code 134 / "JavaScript heap
  out of memory" on a small Docker VM. Use ≥12 GiB (`colima start --memory 12`).
- **buildx required:** without the buildx plugin, `DOCKER_BUILDKIT=1` errors and the
  legacy builder silently drops the `COPY --parents` files. Register the plugin (see
  Prerequisites).
- **openrsync flags:** macOS ships openrsync; `--info=progress2` is unsupported. Stick
  to `-a --partial`.
- **Tarball path collision:** the tarball lands at `/tmp/paperclip-server.tgz` on the
  VPS. If two people deploy at once they will clobber that file and race
  `docker compose up -d paperclip`. **Coordinate — only one deploy at a time.**
- **Disk fills up → `docker load` fails with "no space left on device":** each deploy
  loads a fresh ~4.5 GB image and leaves the previous one behind. On the 58 GB root
  disk these accumulate until a load aborts mid-unpack (leaving the old image still
  running). Step 4 (`docker image prune -f`) prevents this; if you skipped it and hit
  the error, run the prune and re-run the load. Check headroom with `df -h /` and
  `docker system df` (look at RECLAIMABLE).

## Rollback

`docker load` does not delete the previous image; it just moves the `:latest` tag.
To roll back, re-tag a prior image id and recreate:

```bash
ssh -i ~/.ssh/lightsail.pem ubuntu@44.240.150.216 '
  docker images paperclip-server --format "{{.ID}} {{.CreatedSince}}"   # find the previous id
  docker tag <PREVIOUS_ID> paperclip-server:latest &&
  cd /opt/paperclip && docker compose up -d paperclip
'
```

Keep one known-good tarball around (e.g. `/tmp/paperclip-server.prev.tgz`) for a clean
re-`docker load` if the previous image has already been pruned.
