# Lawyer-Facing Output Standard

Use this standard for task reports, task artifacts, monitor reports, and specialist handoffs. The audience is a busy solo or small-firm lawyer who wants to know what happened, what matters, and what happens next.

## Default Shape

Lead with the useful answer:

```md
## Summary

[1-2 plain-English sentences.]

## What Matters

| Item | Source | Next action |
| --- | --- | --- |
| [Finding / work product / blocker] | [link or safe source reference] | [owner + next step] |

## Audit Details

- Scope, hard gates, tool limits, and technical details only as needed.
```

## Style Rules

- Put the lawyer-facing summary first.
- Keep routine reports short; link to detailed artifacts instead of replaying them.
- Use tables for coverage, findings, deadlines, and follow-ups.
- Say directly whether the lawyer needs to act.
- Batch questions into one decision whenever possible.
- Do not lead with run IDs, API details, local paths, tool stack, full safety contracts, or long forbidden-source lists.
- Keep technical scope and safety details in `Audit Details`.

## Handoff Budget

Routine specialist handoffs should fit on one screen:

- result;
- latest artifact link;
- source or confidence note;
- next action / owner;
- blocker, if any.

Do not repeat full Matter Safety Contracts, sibling task histories, or approval boilerplate unless they change the next action.

## Safety Language

Use hard-gate language only when it changes the next action. Routine local/source-bound work, task updates, Matter Dashboard updates, local draft recommendations, QA notes, and internal routing do not need repeated approval boilerplate.

Hard gates still require visible approval before action:

- external side effects, including email sends/replies, calendar writes/invites/notifications, filings, service, signatures, external uploads/shares, or public posting;
- authentication, MFA, CAPTCHA, payment, paid retrieval, new external legal research, new legal authorities, or external downloads;
- destructive or protected mutation, including deleting, overwriting, renaming, mutating original sources, final/signed/filed/served/user-edited materials, or active Word/Google Docs in place unless exactly approved.
