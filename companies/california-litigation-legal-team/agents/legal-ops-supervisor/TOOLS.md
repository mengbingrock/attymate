# Legal Ops Supervisor Tools — California Litigation Legal Team

## Paperclip API

Load the **`paperclip` skill** for any Paperclip API interaction. It covers the full API reference, heartbeat procedure, and critical rules.

- Base URL: `http://localhost:3100/api` (or `$PAPERCLIP_API_URL`)
- Agent ID: `<set at runtime>`
- Company ID: `$PAPERCLIP_COMPANY_ID`

## File system

- Company root: `california-litigation-legal-team/` (relative to import location)
- Agent home: `agents/legal-ops-supervisor/`
- Company constitution: `COMPANY.md`
- Operating manual: `OPERATIONS.md`
- Project inventory: `PROJECT-INVENTORY.md` (read before delegating any task)
- References: `references/` — `matter-safety-contract.md`, `workflow-boundaries.md`, `workflow-issue-templates.md`, `firm-operations-guide-template.md`
- Own memory: `agents/legal-ops-supervisor/memory/` (daily notes)
- Own runtime journal: `agents/legal-ops-supervisor/HEARTBEAT.md`

## Firm Operations Guide

The private `firm-operations-guide` Paperclip issue document is owned and maintained by this agent: workspace structure, agent runtime, Python/OCR tools, connector status, Gmail monitor profile, firm SOPs/templates, approval policy, matter mapping, and learning policy. Build it during onboarding and keep it current. Give specialists the guide section or scoped excerpt they need on the issue rather than asking them to rely on hidden memory. Never store its private contents in public package files.

## External tools

BrowserOS, Lexis, LASC, Gmail, Google Calendar, Google Drive, Word / live-draft writes, and filing / service / signing are all RED-GATED and delegated to the relevant specialist under an approved Matter Safety Contract. This agent grants or withholds those gates and routes red-gate requests to the board; it does not operate these tools directly.

## Conventions

- Every child issue carries a complete Matter Safety Contract and sets `parentId` to the Legal Ops parent issue.
- Never store client data, case numbers, party names, credentials, internal URLs, or local paths in package files — those live in the private Firm Operations Guide and scoped issue documents only.
- Hiring a temporary/specialized agent requires a documented scope, manager, skills, budget/time bound, access limits, approval gates, and retirement condition — never to bypass a missing approval, a matter-scope limit, a confidentiality rule, or an external-tool gate.
- Check `PROJECT-INVENTORY.md` before creating or delegating a deliverable so work is not duplicated.
- If a matter or output scope is unclear, create a missing-input or approval issue instead of delegating implementation work.
