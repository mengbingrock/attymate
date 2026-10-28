# Stock and fork runtime validation

Validation date: 2026-10-27. The two runtime paths remain supported concurrently. The current
native mixed-runtime evidence covers macOS arm64, stock Codex `0.165.0` and the tested fork
`0.0.0` artifact. Exact executable hashes and sanitized results are in the
[evidence record](validation/stock-fork-darwin-arm64-2026-10-27.json).

The complete distributed-agent regression suite passed after the desktop/login update:
**81 suites, 336 tests**. `pnpm typecheck`,
scoped fast lint across the 71 touched TypeScript files, and `pnpm exec electron-vite build` passed.
The production compile ran directly, avoiding the unrelated prebuild pricing refresh. Full root
lint was run and has the existing-source failures listed below; a complete repository-wide test
run and release packaging were not performed.

| Check | Evidence |
| --- | --- |
| Both lead orientations × inline and MCP-inbox delivery | Four native cases passed |
| Bidirectional membership messaging and idle wake-up | Eight directions passed |
| Persistent membership threads and MCP after Worker restart | Four restarts passed |
| Assignment offer/accept, progress, review request and result candidate | Four native task flows passed; lead model observed each review |
| Wrong lease, interruption and fencing | Rejected unauthorized calls in all four cases |
| Old task thread during an active successor assignment | Old context/result calls denied; successor context succeeded |
| Stock and fork terminal clients alongside App Server observers | Both actual PTY clients attached |
| Stock installer without a fork archive | Native install, private home, connected Worker and terminal passed |
| Stop/uninstall and external-server ownership | Installer regression fixtures cover independent cleanup and retention of an external server |
| Reinstall while running | Unix fixtures cover automatic stock/fork shutdown, preserved installation identity, another installation staying live, and refusing unrelated PIDs before unpacking. Native Mac stock reinstall also passed with an inert cached login, zero model turns, and desktop transport checks. |
| Control registration, durable delivery, reply association, portal compatibility | Covered by the distributed regression suite |

The native matrix used 68 deterministic loopback Responses requests and 32 model-issued MCP
calls. Homes, teams, projects and credentials were disposable fixtures. This verifies runtime
and tool integration; it does not test provider authentication or model quality. Result submission
means a persisted candidate, not review approval, artifact verification, or Git publication.

Reproduce with explicit binaries and a freshly compiled Worker bundle:

```bash
node scripts/build/distributed-worker-bundle.mjs /path/to/test-worker-kit
pnpm exec tsx scripts/smoke/stock-forked-codex.ts \
  --stock /absolute/path/to/official/codex \
  --fork /absolute/path/to/fork/codex \
  --worker-bundle /path/to/test-worker-kit --delivery-mode both
```

Run only in disposable projects. The harness creates private homes and a local Relay/provider,
records hashes and results, and stops only its own processes. The installer smoke additionally
supports `--runtime stock --codex-binary PATH`; its default remains the existing fork path.

Release limits remain explicit:

- Model-free native probes returned valid `configRequirements/read` responses for installed
  stock `0.165.0`, the desktop-bundled official `0.163.0-alpha.11`, and the installed fork.
  The desktop launcher now validates this response before opening the GUI. Installer regression
  tests use fake apps or explicit missing paths, including the old stock-desktop rejection test
  that could otherwise discover and open a real app against its fake server.
- The Mac stock installer also passed with the desktop-bundled official `0.163.0-alpha.11`
  server and a pre-existing inert login fixture. It reused that home, connected through the local
  relay, rendered the optional terminal client, and passed the compiled desktop bridge's
  requirements/config checks. No GUI or model turn was started in this installer check.

- Stock desktop startup and cached-login reuse were additionally verified with stock `0.165.0`
  and ChatGPT desktop `26.1016.51333`. The isolated profile reached first-run work preferences;
  that check does not claim completed onboarding or team-chat navigation.
- Windows has contract and installer-fixture coverage, without native stock signoff.
- Linux mixed verification remains incomplete. An amd64 container under QEMU on an ARM host
  started stock App Server, but the fork exited with code 139 before opening its socket. The
  cause is unresolved; this is neither a native Linux pass nor proof of a native Linux failure.
- Configure and publish only runtime/platform pairs with their own native verification.
- Full repository lint reports 45 errors and 1,822 warnings in unchanged `src/` files. None of
  its error files were changed by this work. This remains a repository release gate; the touched
  TypeScript files pass scoped fast lint.

The [implementation plan](stock-and-forked-codex-runtime-plan.md) and
[installer instructions](../../packages/agent-teams-worker/installer/README.md) describe runtime
selection, managed/external ownership, coexistence and rollback.
