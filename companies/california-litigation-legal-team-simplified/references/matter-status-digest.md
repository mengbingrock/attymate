# Matter Status Digest

Use this digest on every active parent matter issue. It is the lawyer-facing summary of the workstream, not the technical dependency log.

Legal Ops Supervisor owns the digest. Update it when:

- a parent matter issue is created;
- child issues are created or materially rerouted;
- a parent issue is marked blocked;
- a blocker changes status;
- a specialist reports a red gate or true missing input;
- the lawyer asks what the issue or subissues are for.

## Required Format

```md
## Matter Status Digest

**What this is:** [One plain-English sentence.]

**Current status:** [Working / waiting on agent / needs your input / ready for review / done.]

**What the team already did:**
- [Short source-bound fact about progress.]

**What is blocking progress:** [Plain-English blocker, or "Nothing right now."]

**Who owns the next step:** [Agent, Legal Ops, or lawyer/board.]

**Do you need to do anything?** [No action needed / yes, one concrete decision.]

**Next expected action:** [What happens after the current step.]
```

## Tone

- Write for a busy lawyer, not for an engineer.
- Keep the first paragraph decisive and short.
- Avoid raw dependency-chain narration unless the lawyer asks for details.
- If no lawyer action is needed, say so directly.
- If lawyer action is needed, ask for one decision and give 2-3 practical choices.

## Blocker Language

When a blocked issue is covered by active agent work:

> No action needed from you right now. The team is working on the dependency.

When a blocked issue needs a lawyer or board decision:

> I need one thing before I can continue: [plain-language decision].

When a tool or connector cannot complete a step:

> The team reached a tool limit: [plain-language limit]. The safe next choices are [choice A] or [choice B].

## Dependency Detail

Technical blocker chains may be linked under a short "Dependency details" note, but they should not be the primary explanation. The digest should name the terminal blocker in normal language, then link to child issues only for audit.
