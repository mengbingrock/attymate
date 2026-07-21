# @attymate/legal-team

The California Litigation Legal Team, rebuilt natively on the [pi coding agent](../coding-agent/) SDK — no Paperclip. One Node process orchestrates a supervisor session plus ephemeral specialist sessions, with a file-backed task store, Matter Safety Contract enforcement, human approval gates for external side effects, and read-only Gmail/Calendar monitors.

## Team

| Agent | Role | Default model |
|---|---|---|
| legal-ops-supervisor | lawyer-facing front door, intake, delegation, gates | gpt-5.5 (high) |
| source-intake-agent | source-bound pleading intake, OCR | gpt-5.5 (medium) |
| facts-evidence-agent | fact/evidence tables tied to sources | gpt-5.5 (medium) |
| legal-research-agent | supplied-authority workup (no live browser) | gpt-5.5 (medium) |
| drafting-assembly-agent | source-bound drafting under the output root | gpt-5.5 (high) |
| legal-qa-agent | confidentiality/source/authority/approval QA | gpt-5.5 (medium) |
| calendar-agent | deadline calcs + proposals; event writes hard-gated; monitor sweeps | gpt-5.5 (medium); sweeps on gpt-5.4-mini |
| email-monitor-agent | read-only mailbox monitor | gpt-5.4-mini (low) |

Deferred from the source company: docket-agent (needs external docket access) and practice-learning-agent (needs an explicit learning contract). The deployment has no browser tooling and no BrowserOS dependency; the source browser-based research skill is replaced by `supplied-authority-legal-research`.

The agent definitions live in `company/` — a mechanical port of `companies/california-litigation-legal-team` from the attymate master branch onto pi vocabulary (`scripts/port-content.mjs` reproduces it). SOUL/AGENTS/TOOLS are appended to pi's own system prompt; COMPANY/OPERATIONS/PROJECT-INVENTORY ride along as context files; skills load through pi's native skill mechanism, filtered per agent.

## Safety model

- **Matter Safety Contract** on every delegated task: matter root (read scope), output root (only writable location), autonomy level, approval profile, forbidden roots, gate state. Write/edit tools are wrapped so every target must canonicalize (symlink-safe) under the output root; reads of forbidden roots are blocked; monitors get read-only tool sets and never receive send/create tools.
- **Hard gates**: `gmail_send` and `calendar_create_event` call the approval broker *inside the tool*, print the full payload, and wait for a y/N on the terminal. Decisions are appended to `runs/<matter>/tasks/<id>.approvals.jsonl`. `approvalMode: "auto-deny"` or `approval_profile: sandbox_autopilot` auto-denies with a simulated result.
- **bash** is only available to agents that need it (intake OCR, drafting) and only at autonomy `supervised-tools` or above — never for monitors or `safe-draft-only` tasks.

## Setup

1. **Build** (from the repo root):
   ```sh
   npm install && npm run build:offline
   npm run build -w @attymate/legal-team
   ```
2. **OpenAI auth** (subscription via ChatGPT OAuth): run `/login` once in the stock pi TUI and pick the OpenAI Codex provider; tokens land in `~/.pi/agent/auth.json` and refresh automatically. Alternative: export `OPENAI_API_KEY` (the team falls back to the `openai` provider).
3. **Google auth**: copy your OAuth client to `~/attymate-workspace/secrets/google/credentials.json` (same file as `gmail-toolkit/credentials.json`), then:
   ```sh
   node dist/cli.js auth google    # loopback consent: gmail.readonly + gmail.send + calendar
   node dist/cli.js auth check
   ```
   The token is stored in the python-compatible `authorized_user` format, so `gmail-toolkit` keeps working against the same token file if you point it there.
4. Optional: copy `legal-team.config.json` next to your working directory and adjust workspace root, models, timeouts, monitor schedules (both monitors default to disabled, matching the source company's paused routines).

Runtime data lives outside the repo under `~/attymate-workspace/`: `runs/<matter>/{matter.json, tasks/, artifacts/, sessions/}` and `monitors/<kind>/{reports/, state.json}`.

## Usage

```sh
legal-team intake "New subpoena arrived in Smith v. Jones; draft a motion-to-compel plan"
legal-team run smith-v-jones-subpoena-mtc "Continue with the QA pass"
legal-team status
legal-team monitor gmail          # one-shot read-only monitor run
legal-team monitors start         # in-process cron (enable monitors in config first)
legal-team print-prompt drafting-assembly-agent
```

`intake`/`run` open the supervisor session (streaming, with a `lawyer>` REPL). The supervisor translates plain-English answers into the Matter Safety Contract (`create_matter`), delegates specialist tasks (`delegate` runs each specialist session synchronously and returns its report), and may ask short questions via `ask_lawyer`. Unrouted monitor reports are prepended to the next intake automatically.

## Verification checklist (live, user-side)

The offline suite (`npm test -w @attymate/legal-team`) covers the content port, prompt assembly, task store, fs-guard, approval broker, and monitor cursor. The live milestones need your credentials:

1. **Model round-trip**: `legal-team auth check` shows `openai-codex: ok`; `legal-team intake "hello"` streams a supervisor reply.
2. **Delegation (M3)**: `legal-team intake "Toy matter: have facts-evidence summarize the file I describe"` → supervisor creates a matter and delegates; `legal-team status` shows the task `completed`; `runs/<matter>/tasks/*.json` contains the report; a write outside the output root fails with a Matter Safety Contract violation.
3. **Gmail read (M4)**: ask the supervisor to search the mailbox (`newer_than:2d`) — real rows return. Calendar tools error cleanly before `auth google`, list events after.
4. **Approval gate (M5)**: ask the supervisor to send yourself a test email — the full email renders in a red gate block; `n` blocks it (nothing in Sent, decision logged in `*.approvals.jsonl`); `y` sends it.
5. **Monitors (M6)**: `legal-team monitor gmail` writes a contract-conforming report under `monitors/gmail/reports/`; a second run only covers the window since the first; the next `intake` surfaces the report to the supervisor.
6. **E2E dry run (M7)**: seed a matter folder with a sample pleading; intake → source-intake → facts-evidence → drafting → QA; artifacts appear under `runs/<matter>/artifacts/`; no red gate crossed unprompted.
