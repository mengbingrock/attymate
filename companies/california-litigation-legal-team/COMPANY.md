---
schema: agentcompanies/v1
kind: company
slug: california-litigation-legal-team
name: California Litigation Legal Team
description: Paperclip company for reusable California litigation workflows with supervised issue scope, approvals, and specialist agents.
version: 0.2.0
license: MIT
goals:
  - Coordinate reusable California litigation workflows through Paperclip issues, approvals, budgets, and Codex local agents.
requirements:
  runtime:
    - Paperclip with codex_local adapter support.
    - Authenticated Codex CLI or an approved deployment-specific API-key auth mechanism.
    - Matter and output paths supplied at runtime through issue contracts.
includes:
  - agents/legal-ops-supervisor/AGENTS.md
  - agents/source-intake-agent/AGENTS.md
  - agents/facts-evidence-agent/AGENTS.md
  - agents/legal-research-agent/AGENTS.md
  - agents/drafting-assembly-agent/AGENTS.md
  - agents/docket-agent/AGENTS.md
  - agents/calendar-agent/AGENTS.md
  - agents/notebooklm-kb-agent/AGENTS.md
  - agents/legal-qa-agent/AGENTS.md
  - projects/subpoena-mtc-run/PROJECT.md
  - skills/legal-calendaring-workflow/SKILL.md
  - skills/lexis-browseros-legal-research/SKILL.md
  - skills/ca-litigation-drafting-workflow/SKILL.md
  - skills/ca-pleading-intake-review/SKILL.md
  - skills/docling-pdf-processing/SKILL.md
  - skills/lasc-browseros-docket-check/SKILL.md
  - skills/notebooklm-legal-kb/SKILL.md
  - skills/ca-subpoena-mtc-autonomous-runner/SKILL.md
  - skills/ca-subpoena-mtc-drafting-workflow/SKILL.md
---

# California Litigation Legal Team

This Paperclip company packages reusable California litigation workflows into a legal-team org chart. Paperclip owns coordination: issues, child issues, agent assignment, heartbeats, approvals, and audit trail. The legal skills own domain workflow discipline.

Productized skills in this package must not include client confidentiality, firm-specific procedures, private URLs, credentials, account details, or hardcoded local paths. Deployment-specific behavior belongs in runtime issue contracts, deployment profiles, or local adapter configuration.

The subpoena MTC project remains available as a specialized workflow inside the broader litigation team. It is handled by Legal Ops Supervisor and the unified specialists, not by a separate MTC sub-organization. Live matter runs must begin with user-owned matter selection, explicit source/output scope, and the required approvals before implementation work.
