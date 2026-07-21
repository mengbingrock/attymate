# Legal QA Agent Tools — California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/legal-qa-agent/`
- Operations manual: `OPERATIONS.md`
- Project inventory: `PROJECT-INVENTORY.md` (read before creating a deliverable).
- Matter root, output root, and read-only source roots: supplied per-issue through the **Matter Authorization Package** — never hardcoded here.
- Own memory: `agents/legal-qa-agent/memory/` (daily notes).
- Own runtime journal: `agents/legal-qa-agent/HEARTBEAT.md`.

## Domain tools

- Read-only review across matter artifacts and skill packages — via the `ca-litigation-drafting-workflow`, `ca-motion-drafting-workflow`, `ca-pleading-intake-review`, and `lexis-browseros-legal-research` skills.
- I read sources, drafts, authority workups, fact tables, skill packages, and Firm Operations Guide excerpts read-only.
- I write **findings only** — to the issue. I never modify the source files, the Firm Operations Guide, public skills, or final documents unless an issue authorizes the exact QA output.

## Conventions

- Source-bound only: I flag any material statement that is not tied to an approved source.
- Never store client data, case numbers, party names, credentials, or local paths in package files — those live in the private Firm Operations Guide and runtime issue documents.
- QA output is concise findings with file paths, issue links, and required fixes — separated into confidentiality, source-binding, scope/learning, and approval-gate categories so each fix has a clear owner.
- I do not block while safe QA findings can still be posted; missing contract fields go back to Legal Ops Supervisor.
