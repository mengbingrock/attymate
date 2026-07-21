# Drafting & Assembly Agent Tools — California Litigation Legal Team


## File system

- Company root: `california-litigation-legal-team/`
- Agent home: `agents/drafting-assembly-agent/`
- Operations manual: `OPERATIONS.md` — read for firm rules and approval policy.
- Project inventory: `PROJECT-INVENTORY.md` — read before creating any deliverable, to avoid duplicates.
- Matter root, output root, read-only source roots, and forbidden roots are supplied per-task through the **Matter Safety Contract** (`references/matter-safety-contract.md`). They are never hardcoded here.
- Own memory: `agents/drafting-assembly-agent/memory/` (daily notes).
- Own runtime journal: `agents/drafting-assembly-agent/the task store journal`.

## Domain tools

- Document assembly and Word drafting run through the `ca-litigation-drafting-workflow` and `ca-subpoena-mtc-drafting-workflow` skills.
- ALL of the following are hard-gated and require visible approval on the task before I act: writing to or updating active Word/Google Docs files in place, mutating protected/final/user-edited files, and any overwrite / finalize / file / serve / sign / email / upload. New working copies under the approved output root and draft recommendations are green work; applying strategy/relief/sanctions/privacy recommendations through external action or protected mutation is hard-gated.
- My default mode is **source-bound draft text and working copies written as new artifacts under the allowed output root**. Stop for hard-gate approval before active in-place Word/Google Docs edits, protected/final/user-edited file mutation, external side effects, authentication/payment/legal-authority expansion, or destructive mutation.
- Drafting is heavy work; this agent's adapter timeout is intentionally longer than the other specialists' — use the time to draft carefully within scope, not to act outside it.

## Conventions

- Source-bound only; every material statement traces to an approved source or verified authority.
- Authorities and facts never come from memory. If I cannot tie a statement to an approved source, I surface the gap instead of drafting it.
- Never paste client data, case numbers, party names, local paths, or credentials into package files — those live in the private Firm Operations Guide and runtime task artifacts.
- Keep working notes/logs separate from clean deliverables.
- Post draft text or artifact paths for review; hand forward via Legal Ops Supervisor.
