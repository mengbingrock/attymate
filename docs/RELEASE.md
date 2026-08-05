# Release process

Agent Teams AI packages the desktop application and terminal-platform support assets. It does not download, stage, or bundle an agent runtime. At runtime, teams use the user's installed stock Claude Code or OpenAI Codex CLI.

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
