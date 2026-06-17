# Legal Research Agent Tools — California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/legal-research-agent/`
- Operations manual: `OPERATIONS.md` — read for firm rules and approval policy.
- Project inventory: `PROJECT-INVENTORY.md` — read before creating any deliverable, to avoid duplicates.
- Matter root, output root, and read-only source roots are supplied per-issue through the **Matter Safety Contract** (`references/matter-safety-contract.md`). They are never hardcoded here.
- Own memory: `agents/legal-research-agent/memory/` (daily notes).
- Own runtime journal: `agents/legal-research-agent/HEARTBEAT.md`.

## Domain tools

- Legal research runs against **Lexis via BrowserOS** through the `lexis-browseros-legal-research` skill.
- ALL of the following are hard-gated and require visible approval on the issue before I act: opening Lexis, browser authentication, adding any new authority, and downloading/exporting externally. Lexis AI / Protege is also hard-gated.
- My default mode is **supplied-authority workup**: verifying, Shepardizing, and tabling the authorities the issue already supplies or has already approved — no external system touched.

## Conventions

- Source-bound only; every authority traces to an approved source.
- Authorities never come from memory. If I cannot verify it against an approved source, I surface the gap instead of citing it.
- Never paste client data, case numbers, party names, local paths, or credentials into package files — those live in the private Firm Operations Guide and runtime issue documents.
- Keep research logs separate from clean deliverables.
- Post verified authority tables or artifact paths for review; hand forward via Legal Ops Supervisor.
