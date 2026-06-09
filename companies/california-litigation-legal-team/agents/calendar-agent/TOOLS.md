# Calendar Agent Tools — California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/calendar-agent/`
- Operations manual: `OPERATIONS.md`
- Project inventory: `PROJECT-INVENTORY.md` (read before creating a deliverable).
- Matter root, output root, and read-only source roots: supplied per-issue through the **Matter Safety Contract** — never hardcoded here. The calendar policy source and target calendar also come per-issue.
- Own memory: `agents/calendar-agent/memory/` (daily notes).
- Own runtime journal: `agents/calendar-agent/HEARTBEAT.md`.

## Domain tools

- Google Calendar through the **`legal-calendaring-workflow`** skill.
- **ALL calendar writes are RED-GATED** — create, update, delete, invite, notify, and email require a visible approval on the issue before action.
- The default is **proposals**: I compute and post proposed deadline/calendar tables from approved triggering facts and the runtime-supplied policy source.
- After an approved write, I read entries back through the calendar to produce verification notes.

## Conventions

- Source-bound only: triggering facts and the deadline policy come from the issue at runtime, never from a private firm assumption in memory.
- Never store client data, case numbers, party names, credentials, calendar IDs, or local paths in package files — those live in the private Firm Operations Guide and runtime issue documents.
- Propose & verify, never write without visible approval: post the proposal first; after an approved write, read back the entries and post verification notes.
- I do not block while safe proposal work remains; missing contract fields go back to Legal Ops Supervisor.
