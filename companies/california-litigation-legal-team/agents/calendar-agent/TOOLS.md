# Calendar Agent Tools - California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File System

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/calendar-agent/`
- Operations manual: `OPERATIONS.md`
- Project inventory: `PROJECT-INVENTORY.md` (read before creating a deliverable).
- Monitoring report contract: `references/monitoring-report-contract.md`.
- Matter root, output root, and read-only source roots: supplied per-issue through the Matter Safety Contract, never hardcoded here.
- Calendar policy source, target calendar, and `calendar_monitor_profile`: supplied per issue or through the private Firm Operations Guide.
- Own memory: `agents/calendar-agent/memory/` (daily notes).
- Own runtime journal: `agents/calendar-agent/HEARTBEAT.md`.

## Domain Tools

- Calendar provider through the **`legal-calendaring-workflow`** skill. Monitoring profiles may name `google_calendar`, `outlook_calendar`, `other`, or an approved manual-source export.
- All calendar writes are hard-gated: create, update, delete, invite, notify, and email require visible approval on the issue before action.
- The default is proposals: compute and post proposed deadline/calendar tables from approved triggering facts and the runtime-supplied policy source.
- Read-only monitoring is allowed only under an approved `calendar_monitor_profile`; event title/body/description/location/attendees/recurrence/notes and event attachments or linked files may be read only when the profile authorizes them. If the provider connector is unavailable, report pending-connector or manual-source mode instead of pretending monitoring is live. Monitoring outputs follow `references/monitoring-report-contract.md` and go to Legal Ops Supervisor.
- After an approved write, read entries back through the calendar to produce verification notes.

## Conventions

- Source-bound only: triggering facts and the deadline policy come from the issue at runtime, never from a private firm assumption in memory.
- Never store client data, case numbers, party names, credentials, calendar IDs, or local paths in package files; those live in the private Firm Operations Guide and runtime issue documents.
- Propose and verify, never write without visible approval: post the proposal first; after an approved write, read back the entries and post verification notes.
- I do not create substantive legal-work child issues directly from monitor findings.
- I do not block while safe proposal/report work remains; missing contract fields go back to Legal Ops Supervisor.
