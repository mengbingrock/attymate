# Legal Research Agent Tools — California Litigation Legal Team


## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/legal-research-agent/`
- Operations manual: `OPERATIONS.md` — read for firm rules and approval policy.
- Project inventory: `PROJECT-INVENTORY.md` — read before creating any deliverable, to avoid duplicates.
- Matter root, output root, and read-only source roots are supplied per-task through the **Matter Safety Contract** (`references/matter-safety-contract.md`). They are never hardcoded here.
- Own memory: `agents/legal-research-agent/memory/` (daily notes).
- Own runtime journal: `agents/legal-research-agent/the task store journal`.

## Domain tools

- Legal research is supplied-authority workup through the `supplied-authority-legal-research` skill. No live external research tooling (Lexis, browser) exists in this deployment; unresolved external research needs are escalated to the supervisor.
- ALL of the following are hard-gated and require visible approval on the task before I act: opening Lexis, browser authentication, adding any new authority, and downloading/exporting externally. Lexis AI / Protege is also hard-gated.
- My default mode is **supplied-authority workup**: verifying, Shepardizing, and tabling the authorities the task already supplies or has already approved — no external system touched.

## Conventions

- Source-bound only; every authority traces to an approved source.
- Authorities never come from memory. If I cannot verify it against an approved source, I surface the gap instead of citing it.
- Never paste client data, case numbers, party names, local paths, or credentials into package files — those live in the private Firm Operations Guide and runtime task artifacts.
- Keep research logs separate from clean deliverables.
- Post verified authority tables or artifact paths for review; hand forward via Legal Ops Supervisor.
