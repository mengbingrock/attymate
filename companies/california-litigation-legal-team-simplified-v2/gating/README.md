# Gating

Single home for approval-gating logic in this company. Agents and tasks reference these files by company-root path (`gating/<file>.md`) — no per-agent copies.

## Files

- `human-approval-gates.md` — the canonical firm-wide gate matrix (green/yellow/red checkpoints and review packet format).
- `calendar-monitoring-gates.md` — green vs. hard-gate criteria for read-only calendar monitoring.
- `docket-monitoring-gates.md` — green vs. hard-gate criteria for public docket monitoring.
- `email-monitoring-gates.md` — green vs. hard-gate criteria for read-only email monitoring.

## How gating is managed in one place

1. **One canonical matrix.** The firm-wide matrix defines the three hard-gate categories: external side effects; authentication, payment, or legal-authority expansion; and destructive or protected mutation. Everything else that is local, source-bound, and inside approved scope is green.
2. **Channel files specialize, never loosen.** A channel gates file (calendar/docket/email) may only narrow the matrix — enumerate what is green inside an approved monitor profile and add channel-specific hard gates. It may never mark green something the matrix hard-gates.
3. **Approvals live on issues, not here.** A gate opens only through a visible approval on the specific issue. Gating files describe criteria; they never record approvals.
4. **Single-source rule.** Each gating rule exists in exactly one file here. Agent definitions, skills, and tasks reference `gating/` paths instead of restating or copying the rules. (The docket and email gates files previously existed in four per-agent copies; they are consolidated here.)
5. **Change control.** Editing a gating file changes the firm's hard constraints, which is itself hard-gated: board approval required, proposed as a diff on a control-plane issue before merging.
