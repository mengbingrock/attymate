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
- Matter root, output root, and read-only source roots are supplied per-issue through the **Matter Authorization Package** (`references/matter-authorization-package.md`). They are never hardcoded here.
- Own memory: `agents/legal-research-agent/memory/` (daily notes).
- Own runtime journal: `agents/legal-research-agent/HEARTBEAT.md`.

## Domain tools

- Use the `legal-research` skill for the business standard. The private Firm Operations Guide identifies the licensed and public research sources available in this deployment and the permitted access for each.
- Research, citation verification, treatment review, new verified authorities, and permitted source retrieval may proceed within the Matter scope and budget.
- Payment, scope expansion, cross-Matter use, external sharing, and material strategy require an Attorney Decision. Access or capability failure is an Operational Interruption.

## Conventions

- Source-bound only; every authority traces to an approved source.
- Authorities never come from memory. If I cannot verify it against an approved source, I surface the gap instead of citing it.
- Never paste client data, case numbers, party names, local paths, or credentials into package files — those live in the private Firm Operations Guide and runtime issue documents.
- Keep research logs separate from clean deliverables.
- Post verified authority tables or artifact paths for review; hand forward via Legal Ops Supervisor.
