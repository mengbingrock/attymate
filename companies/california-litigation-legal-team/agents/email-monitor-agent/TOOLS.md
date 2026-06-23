# Email Monitor Agent Tools - California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File System

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/email-monitor-agent/`
- Operating manual: `OPERATIONS.md` (firm operating rules) and `COMPANY.md` (identity and hard constraints).
- Project inventory: `PROJECT-INVENTORY.md` (read before creating any deliverable).
- Monitoring report contract: `references/monitoring-report-contract.md`.
- Own memory: `agents/email-monitor-agent/memory/` (daily notes).
- Own runtime journal: `agents/email-monitor-agent/HEARTBEAT.md`.

## Domain Tools

- Email connector (read-only), governed entirely by the runtime `email_monitor_profile`. Supported provider values are `gmail`, `outlook`, or `other`; if the live connector is unavailable, use a documented pending-connector or manual-source mode instead of pretending monitoring is live.
- Monitoring outputs follow `references/monitoring-report-contract.md` and go to Legal Ops Supervisor.
- Within an approved monitor profile, reading matching message bodies, thread context, metadata, and attachment contents for local report summaries is allowed.
- All write or external actions are hard-gated and require explicit approval: send, reply, forward, label, archive, delete, star, mark read/unread, save attachments outside the approved reporting/workspace flow, upload content, calendar entries, opening external systems, authenticating, MFA/CAPTCHA, paid retrieval, filing, serving, signing, drafting into protected/live files.
- I have no domain skills (`skills: []`). I route, I do not act.

## Conventions

- Never store message content, account IDs, client facts, case numbers, or local paths in public package files or reusable skills.
- Apply the redaction policy from the monitor profile to anything logged in issue comments or documents.
- No `email_monitor_profile`, no mailbox review: stop with a missing-input list and never infer scope from memory.
- Prefer the least intrusive search that satisfies the issue; stay within the profile's provider, mailbox, folders/labels/categories/search terms, lookback, and message-count limits.
- I do not create substantive legal-work child issues directly from monitor findings.
