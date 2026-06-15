# Docket Agent Tools - California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File System

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/docket-agent/`
- Operations manual: `OPERATIONS.md`
- Project inventory: `PROJECT-INVENTORY.md` (read before creating a deliverable).
- Monitoring report contract: `references/monitoring-report-contract.md`.
- Matter root, output root, and read-only source roots: supplied per-issue through the Matter Safety Contract, never hardcoded here.
- Case search parameters, court, and `docket_monitor_profile`: supplied per issue or through the private Firm Operations Guide.
- Own memory: `agents/docket-agent/memory/` (daily notes).
- Own runtime journal: `agents/docket-agent/HEARTBEAT.md`.

## Domain Tools

- LASC public docket via BrowserOS through the **`lasc-browseros-docket-check`** skill.
- Public records only. Paid retrieval, login to paid systems, CAPTCHA bypass, and paid downloads are out of lane.
- Public docket monitoring runs under a `docket_monitor_profile`; monitoring outputs follow `references/monitoring-report-contract.md` and go to Legal Ops Supervisor.
- I use BrowserOS to read the public docket and authenticate as needed, and also compare against approved local sources and produce a docket-check plan.

## Conventions

- Source-bound only: procedural status notes separate confirmed docket facts from inferences and from access limits.
- Never store client data, case numbers, party names, credentials, or local paths in package files; those live in the private Firm Operations Guide and runtime issue documents.
- Public docket check and verify: I do not file, serve, calendar, email, or cross a paid/login/CAPTCHA gate.
- Deadline triggers route to the Calendar Agent via Legal Ops Supervisor.
- I do not create substantive legal-work child issues directly from monitor findings.
- I do not block while safe check/report work remains; missing contract fields go back to Legal Ops Supervisor.
