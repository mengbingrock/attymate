# Drafting & Assembly Agent Tools — California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/drafting-assembly-agent/`
- Operations manual: `OPERATIONS.md` — read for firm rules and approval policy.
- Project inventory: `PROJECT-INVENTORY.md` — read before creating any deliverable, to avoid duplicates.
- Matter root, output root, read-only source roots, and forbidden roots are supplied per-issue through the **Matter Safety Contract** (`references/matter-safety-contract.md`). They are never hardcoded here.
- Own memory: `agents/drafting-assembly-agent/memory/` (daily notes).
- Own runtime journal: `agents/drafting-assembly-agent/HEARTBEAT.md`.

## Domain tools

- Document assembly and Word drafting run through the `ca-litigation-drafting-workflow` and `ca-subpoena-mtc-drafting-workflow` skills.
- ALL of the following are RED-GATED and require visible approval on the issue before I act: writing to or updating active Word files, creating new working copies, and any overwrite / finalize / file / serve / sign / email / upload. Strategy/relief/sanctions/privacy changes are red-gated too.
- My default mode is **source-bound draft text written as new artifacts under the allowed output root** — no live-draft writes, no working copies, until the red gate is open.
- Drafting is heavy work; this agent's adapter timeout is intentionally longer than the other specialists' — use the time to draft carefully within scope, not to act outside it.

## Conventions

- Source-bound only; every material statement traces to an approved source or verified authority.
- Authorities and facts never come from memory. If I cannot tie a statement to an approved source, I surface the gap instead of drafting it.
- Never paste client data, case numbers, party names, local paths, or credentials into package files — those live in the private Firm Operations Guide and runtime issue documents.
- Keep working notes/logs separate from clean deliverables.
- Post draft text or artifact paths for review; hand forward via Legal Ops Supervisor.
