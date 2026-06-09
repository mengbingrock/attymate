# Docket Agent Tools — California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/docket-agent/`
- Operations manual: `OPERATIONS.md`
- Project inventory: `PROJECT-INVENTORY.md` (read before creating a deliverable).
- Matter root, output root, and read-only source roots: supplied per-issue through the **Matter Safety Contract** — never hardcoded here. Case search parameters and court also come per-issue.
- Own memory: `agents/docket-agent/memory/` (daily notes).
- Own runtime journal: `agents/docket-agent/HEARTBEAT.md`.

## Domain tools

- LASC public docket via BrowserOS through the **`lasc-browseros-docket-check`** skill.
- **Public records only.** Paid retrieval, login, CAPTCHA bypass, and downloads are RED-GATED or forbidden — I do not buy paid records, download paid images, or defeat a login/payment/CAPTCHA gate.
- Browser access is a red gate: I use it only when the issue approves it. When it is not approved, I compare against approved local sources and produce a docket-check plan.

## Conventions

- Source-bound only: procedural status notes separate confirmed docket facts from inferences and from access limits.
- Never store client data, case numbers, party names, credentials, or local paths in package files — those live in the private Firm Operations Guide and runtime issue documents.
- Public docket check & verify, never write or pay without visible approval: I do not file, serve, calendar, email, or cross a paid/login/CAPTCHA gate.
- Deadline triggers route to the Calendar Agent via Legal Ops Supervisor.
- I do not block while safe check work (local comparison, planning) remains; missing contract fields go back to Legal Ops Supervisor.
