# Calendar Agent Tools - California Litigation Legal Team


## File System

- Company docs: `COMPANY.md` (identity and hard constraints) and `OPERATIONS.md` (firm operating rules) are provided in your context.
- Project inventory: `PROJECT-INVENTORY.md` in the company package (read before creating any deliverable).
- Agent home: `company/agents/calendar-agent/` (SOUL.md, AGENTS.md, TOOLS.md, references/).
- Matter workspace: your working directory is the matter root named in the task packet; write only under the output root it names.
- Task artifacts: `runs/<matter>/artifacts/<taskId>/` under the workspace root.

## Domain Tools

- Calendar provider through the **`legal-calendaring-workflow`** skill. Monitoring profiles may name `google_calendar`, `outlook_calendar`, `other`, or an approved manual-source export.
- All calendar writes are hard-gated: create, update, delete, invite, notify, and email require visible approval on the task before action.
- The default is proposals: compute and post proposed deadline/calendar tables from approved triggering facts and the runtime-supplied policy source.
- Read-only monitoring is allowed only under an approved `calendar_monitor_profile`; event title/body/description/location/attendees/recurrence/notes and event attachments or linked files may be read only when the profile authorizes them. If the provider connector is unavailable, report pending-connector or manual-source mode instead of pretending monitoring is live. Monitoring outputs follow `references/monitoring-report-contract.md` and go to Legal Ops Supervisor.
- After an approved write, read entries back through the calendar to produce verification notes.

## Conventions

- Source-bound only: triggering facts and the deadline policy come from the task at runtime, never from a private firm assumption in memory.
- Never store client data, case numbers, party names, credentials, calendar IDs, or local paths in package files; those live in the private Firm Operations Guide and runtime task artifacts.
- Propose and verify, never write without visible approval: post the proposal first; after an approved write, read back the entries and post verification notes.
- I do not create substantive legal-work delegated tasks directly from monitor findings.
- I do not block while safe proposal/report work remains; missing contract fields go back to Legal Ops Supervisor.
