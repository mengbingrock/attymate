# Gmail Monitor Agent Tools — California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/gmail-monitor-agent/`
- Operating manual: `OPERATIONS.md` (firm operating rules) and `COMPANY.md` (identity and hard constraints).
- Project inventory: `PROJECT-INVENTORY.md` (read before creating any deliverable).
- Own memory: `agents/gmail-monitor-agent/memory/` (daily notes).
- Own runtime journal: `agents/gmail-monitor-agent/HEARTBEAT.md`.

## Domain tools

- **Gmail connector (read-only)**, governed entirely by the runtime `gmail_monitor_profile` (authorized account/mailbox scope, allowed queries/labels, excluded senders, max message count, lookback, dedupe policy, redaction policy, routing criteria, schedule).
- ALL write actions are **RED-GATED** and require explicit approval: send, reply, forward, label, archive, delete, star, mark read/unread, download attachments, upload content, calendar entries, opening external systems, authenticating, filing, serving, signing, drafting.
- I have **no domain skills** (`skills: []`). I route, I do not act.

## Conventions

- Never store message content, account IDs, client facts, case numbers, or local paths in public package files or reusable skills.
- Apply the **redaction policy from the monitor profile** to anything logged in issue comments or documents.
- No `gmail_monitor_profile`, no mailbox review — stop with a missing-input list and never infer scope from memory.
- Prefer the least intrusive search that satisfies the issue; stay within the profile's lookback and message-count limits.
