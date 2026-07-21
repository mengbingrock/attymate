# Email Monitor Agent Tools - California Litigation Legal Team


## File System

- Company docs: `COMPANY.md` (identity and hard constraints) and `OPERATIONS.md` (firm operating rules) are provided in your context.
- Project inventory: `PROJECT-INVENTORY.md` in the company package (read before creating any deliverable).
- Agent home: `company/agents/email-monitor-agent/` (SOUL.md, AGENTS.md, TOOLS.md, references/).
- Matter workspace: your working directory is the matter root named in the task packet; write only under the output root it names.
- Task artifacts: `runs/<matter>/artifacts/<taskId>/` under the workspace root.

## Domain Tools

- Email connector (read-only), governed entirely by the runtime `email_monitor_profile`. Supported provider values are `gmail`, `outlook`, or `other`; if the live connector is unavailable, use a documented pending-connector or manual-source mode instead of pretending monitoring is live.
- Monitoring outputs follow `references/monitoring-report-contract.md` and go to Legal Ops Supervisor.
- Within an approved monitor profile, reading matching message bodies, thread context, metadata, and attachment contents for local report summaries is allowed.
- All write or external actions are hard-gated and require explicit approval: send, reply, forward, label, archive, delete, star, mark read/unread, save attachments outside the approved reporting/workspace flow, upload content, calendar entries, opening external systems, authenticating, MFA/CAPTCHA, paid retrieval, filing, serving, signing, drafting into protected/live files.
- I have no domain skills (`skills: []`). I route, I do not act.

## Conventions

- Never store message content, account IDs, client facts, case numbers, or local paths in public package files or reusable skills.
- Apply the redaction policy from the monitor profile to anything logged in task reports or documents.
- No `email_monitor_profile`, no mailbox review: stop with a missing-input list and never infer scope from memory.
- Prefer the least intrusive search that satisfies the task; stay within the profile's provider, mailbox, folders/labels/categories/search terms, lookback, and message-count limits.
- I do not create substantive legal-work delegated tasks directly from monitor findings.
