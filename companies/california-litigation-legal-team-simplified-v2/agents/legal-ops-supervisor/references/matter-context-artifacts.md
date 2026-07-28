# Matter Context Artifacts

Matter context artifacts are durable, matter-scoped working references that help agents find case context quickly without rereading every source or asking the lawyer for information already organized elsewhere. They live in the matter's approved Matter Home when one exists; otherwise they live temporarily as parent issue documents until Legal Ops creates or approves a Matter Home. Do not commit completed matter context files to this public package.

## Matter Home Convention

Default lawyer-facing folder:

```text
{workspace}/Matters/{matter-short-name}/
```

Default subfolders:

```text
00_Context/
01_Pleadings/
02_Discovery/
03_Docket/
04_Calendar/
05_Research/
06_Drafts/
07_Service_Filing/
_paperclip_issues/
```

Use this structure as the default for solo/small-firm deployments:

- Human-facing matter work lives in the matter folders above.
- Paperclip audit outputs may live under `_paperclip_issues/{issue-identifier}/`.
- Issue folders such as `{issue-identifier}/` are acceptable temporary execution folders, but Legal Ops should link or move lawyer-facing outputs into the Matter Home once a matter/output root is approved.
- If no Matter Home is approved yet, use parent issue documents and mark the Matter Dashboard as `not yet filed into Matter Home`.
- Never create, move, overwrite, or rename live matter folders unless the parent authorizes the matter/output root and the action affects only designated working material. Protected, final, and source-file mutation is gated by `gating/human-approval-gates.md`.

## Artifact Set

- `00_Context/00_Matter_Context_Index.md` - routing map, owner notes, last-updated summary, and authoritative/stale flags.
- `00_Context/01_Matter_Overview.md` - short matter summary, current posture, active workstreams, and known open questions.
- `00_Context/02_Procedural_History.md` - source-cited procedural timeline, filings, orders, service events, hearings, and deadlines that affect posture.
- `00_Context/03_Parties_Counsel_Court.md` - party names, counsel, court, department, judge, case number, service contacts, and source notes.
- `00_Context/04_Court_Rules_And_Standing_Orders.md` - approved court/local-rule/standing-order references, effective dates, and use limits.
- `04_Calendar/05_Deadline_And_Calendar_Tracker.md` - proposed deadlines, trigger facts, pre-deadline reminders, calendar-write status, and verification notes.
- `02_Discovery/06_Discovery_Tracker.md` - discovery served/received, response dates, deficiencies, meet-and-confer status, motions, and source notes.
- `01_Pleadings/07_Pleadings_And_Service_Index.md` - pleadings, proofs of service, service dates/methods, responsive pleading status, and amendment history.
- `00_Context/08_Source_Index.md` - approved source sets, file manifests, OCR sidecars, source quality notes, and excluded/forbidden sources.
- `05_Research/09_Authority_Bank.md` - supplied or approved authorities, treatment notes, jurisdiction limits, and research approvals.
- `00_Context/10_Strategy_Questions_And_Decisions.md` - lawyer questions, draft recommendations, approved decisions, and items that remain conditional on strategy.
- `06_Drafts/11_Drafting_And_Work_Product_Log.md` - drafts created, working-copy locations, QA status, finalization boundary, and user-edited/final/protected file warnings.

When the matter is still issue-document-only, use the same artifact names as document keys or titles and record the Matter Home status in the Matter Dashboard.

## Tiered Checking Rule

Agents should not read every context artifact on every issue. Use this relevance model:

- **Tier 0: routing check.** For an existing matter, check `00_Matter_Context_Index.md` when it is available. If it is missing, proceed from the issue's Matter Safety Contract and note that the index should be created or updated.
- **Tier 1: role-critical check.** Read the artifacts that are directly relevant to the assigned role and requested deliverable.
- **Tier 2: triggered optional check.** Read optional artifacts only when the issue facts, missing context, cited sources, or likely deadlines make them relevant.
- **Tier 3: skip.** Skip irrelevant artifacts. Do not add boilerplate about every skipped artifact; mention a skipped artifact only when audit clarity matters.

## Role Defaults

| Agent / workflow | Tier 1 context | Tier 2 context |
| --- | --- | --- |
| Legal Ops Supervisor | `00_Matter_Context_Index.md`, `01_Matter_Overview.md`, `10_Strategy_Questions_And_Decisions.md` | `05_Deadline_And_Calendar_Tracker.md`, `08_Source_Index.md`, any artifact needed for the event plan |
| Source Intake Agent | `08_Source_Index.md`, `07_Pleadings_And_Service_Index.md` | `02_Procedural_History.md`, `03_Parties_Counsel_Court.md` when sources affect posture or service |
| Facts & Evidence Agent | `08_Source_Index.md`, `02_Procedural_History.md` | `06_Discovery_Tracker.md`, `07_Pleadings_And_Service_Index.md`, `11_Drafting_And_Work_Product_Log.md` when relied on |
| Calendar Agent | `05_Deadline_And_Calendar_Tracker.md`, policy source from the issue or guide | `02_Procedural_History.md`, `04_Court_Rules_And_Standing_Orders.md`, `07_Pleadings_And_Service_Index.md` when needed for trigger dates |
| Docket Agent | `03_Parties_Counsel_Court.md`, `04_Court_Rules_And_Standing_Orders.md`, `02_Procedural_History.md` | `05_Deadline_And_Calendar_Tracker.md` when docket changes imply deadlines |
| Legal Research Agent | `09_Authority_Bank.md` | `04_Court_Rules_And_Standing_Orders.md`, `10_Strategy_Questions_And_Decisions.md` when jurisdiction, local rules, or strategy scope matter |
| Drafting & Assembly Agent | `01_Matter_Overview.md`, `11_Drafting_And_Work_Product_Log.md` | Pleading, procedural, discovery, authority, and calendar artifacts only as needed for the document type |
| Legal QA Agent | Artifacts cited or relied on by the work product | Source, authority, deadline, and protected-file artifacts when QA scope requires them |
| Email Monitor Agent | Approved monitor profile and `00_Matter_Context_Index.md` only after Legal Ops maps the finding to a matter | Matter-specific artifacts only when Legal Ops assigns a scoped follow-up |

## Update Rules

- Legal Ops creates or confirms the Matter Home, context folder, issue-output subfolder, and context index when opening a matter parent issue whenever a matter/output root is approved.
- Specialists may update matter context artifacts within their lane when the issue allows output-root artifacts and the update is source-bound.
- Every substantive update should include a source note, author/agent, date, and unresolved assumptions.
- Destructive and protected-file mutation is gated by `gating/human-approval-gates.md`; apply that matrix rather than a local copy of it.
- If an artifact is stale or conflicts with a source, preserve both facts, flag the conflict, and route the issue to Legal Ops rather than silently replacing history.
- Keep issue-audit detail under `_paperclip_issues/`; keep lawyer-facing summaries in the matter folders.
