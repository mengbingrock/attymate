# Release process

Agent Teams AI packages the desktop application and terminal-platform support assets. It does not download, stage, or bundle an agent runtime. At runtime, teams use the user's installed stock Claude Code or OpenAI Codex CLI.

Distributed teammate installers have two separate runtime paths. The default `--runtime fork`
artifact embeds an explicitly built forked Codex package. The additive `--runtime stock` artifact
contains Worker/bridge code and uses an installed unmodified Codex binary with its built-in App
Server. The Worker and terminal client share the selected local server. Stock supports managed
startup and explicit connection to an operator-owned server; external mode never stops that server.
See [teammate installer](../packages/agent-teams-worker/installer/README.md). These distributions do
not change the Electron packaging below, and neither path depends on A2A.

Worker archives also include `localWorkerCli.js`, an authenticated loopback relay launcher that
forwards to the AWS relay. Keep its sibling `cli.js` and native runtime files alongside it. Build
the wrapper with `node scripts/build/local-worker-relay.mjs OUTPUT_FILE`.

Keep fork and stock artifacts and catalog entries distinct. Existing requests without a runtime
selection continue receiving the fork. New stock CLI installations default to MCP-inbox delivery;
legacy fork installations retain inline delivery. Both modes need regression coverage. Before
publishing a runtime/platform pair, verify its installer, exact terminal attachment, scoped MCP
communication and support/review requests, restart recovery, and independent stop/uninstall while
the other runtime remains active. Use separate test identities, state, endpoints, and MCP entries.

Current mixed-runtime native evidence covers **darwin-arm64** only. The
[native matrix smoke](../scripts/smoke/stock-forked-codex.ts) records executable versions/hashes and
checks stock/fork lead orientations, both delivery modes, native model-driven MCP reads/receipts,
Worker restarts, and actual terminal clients using disposable homes and a loopback model fixture.
The current [validation record](team-management/stock-fork-validation.md) also covers native task
reporting, lead review receipt, fencing, and isolation from a successor assignment.
Windows contract and fixture checks are not native Windows signoff. Other advertised pairs require
their own native verification. Stock desktop GUI attachment remains a separate capability gate;
a successful terminal smoke does not enable it automatically. Historical fork-only verification
continues to apply to its recorded artifact/version, without certifying new stock distributions.

## Before creating a release

Use the repository-pinned Node and pnpm versions, then run the normal quality gates:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:ci
pnpm build
```

Confirm the worktree contains only the intended release changes and that the branch is pushed:

```bash
git status --short
git push origin <branch>
```

For a production-like package check, stage only the terminal-platform assets and use the normal distribution command for the target platform. Do not add an agent-runtime staging step.

## Create the tag and draft

```bash
git tag v<VERSION>
git push origin v<VERSION>

gh workflow run release.yml \
  --repo 777genius/agent-teams-ai \
  --ref v<VERSION> \
  -f release_tag=v<VERSION> \
  -f publish_release=false
```

The release workflow is manually dispatched. It builds the app, stages terminal-platform assets, packages the supported macOS and Windows targets, and uploads them to a draft GitHub release.

Watch the run and inspect failed jobs before retrying:

```bash
gh run list --repo 777genius/agent-teams-ai --workflow release.yml --limit 3
gh run watch <RUN_ID> --repo 777genius/agent-teams-ai
```

## Release notes

The release body must begin with concise user-facing notes explaining what changed and why it matters. Include a downloads table whose links and filenames match the assets uploaded for `v<VERSION>`.

Test or internal releases must remain drafts, be marked prerelease, or include an updater-suppression marker such as `[test-release]` or `[no-autoupdate]` in the title or notes.

## Publish

After the draft assets and notes have been reviewed, rerun the same workflow for the same tag:

```bash
gh workflow run release.yml \
  --repo 777genius/agent-teams-ai \
  --ref v<VERSION> \
  -f release_tag=v<VERSION> \
  -f publish_release=true
```

Do not delete and recreate a release to repair updater metadata. Rerun the workflow for the same tag.

## Required closeout

Do not call the release finished until all of the following are true:

- The final release workflow succeeded with `publish_release=true`.
- The release targets the intended commit and is no longer a draft.
- The public assets contain every supported installer and updater metadata file.
- `latest.yml`, `latest-mac.yml`, and `latest-linux.yml` are present when required by the supported targets.
- The release notes describe the current version and all download links resolve to its assets.
- A packaged smoke check launches the desktop app without attempting to fetch or resolve any bundled agent runtime.

Use the exact versioned asset when a user asks to download or launch a specific release. Do not substitute an older local file or a stable alias.
