# Matter Context Artifacts

Matter context artifacts are durable, matter-scoped working references that help agents find case context quickly without rereading every source or asking the lawyer for information already organized elsewhere. They live under the approved output root, normally `{approved_output_root}/Matter Context/`, and are private runtime artifacts. Do not commit completed matter context files to this public package.

## Artifact Set

- `00_Matter_Context_Index.md` - routing map for the matter context folder, owner notes, last-updated summary, and which artifacts are authoritative or stale.
- `01_Matter_Overview.md` - short matter summary, current posture, active workstreams, and known open questions.
- `02_Procedural_History.md` - source-cited procedural timeline, filings, orders, service events, hearings, and deadlines that affect posture.
- `03_Parties_Counsel_Court.md` - party names, counsel, court, department, judge, case number, service contacts, and source notes.
- `04_Court_Rules_And_Standing_Orders.md` - approved court/local-rule/standing-order references, effective dates, and use limits.
- `05_Deadline_And_Calendar_Tracker.md` - proposed deadlines, trigger facts, pre-deadline reminders, calendar-write status, and verification notes.
- `06_Discovery_Tracker.md` - discovery served/received, response dates, deficiencies, meet-and-confer status, motions, and source notes.
- `07_Pleadings_And_Service_Index.md` - pleadings, proofs of service, service dates/methods, responsive pleading status, and amendment history.
- `08_Source_Index.md` - approved source sets, file manifests, OCR sidecars, source quality notes, and excluded/forbidden sources.
- `09_Authority_Bank.md` - supplied or approved authorities, treatment notes, jurisdiction limits, and research approvals.
- `10_Strategy_Questions_And_Decisions.md` - lawyer questions, draft recommendations, approved decisions, and items that remain conditional on strategy.
- `11_Drafting_And_Work_Product_Log.md` - drafts created, working-copy locations, QA status, finalization boundary, and user-edited/final/protected file warnings.

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
| Gmail Monitor Agent | Approved monitor profile and `00_Matter_Context_Index.md` only after Legal Ops maps the finding to a matter | Matter-specific artifacts only when Legal Ops assigns a scoped follow-up |
| Practice Learning Agent | Issue-authorized learning sources and do-not-learn list | Matter artifacts only if explicitly allowed by the learning contract |

## Update Rules

- Legal Ops creates or confirms the context folder and index when opening a matter parent issue.
- Specialists may update matter context artifacts within their lane when the issue allows output-root artifacts and the update is source-bound.
- Every substantive update should include a source note, author/agent, date, and unresolved assumptions.
- Do not overwrite, rename, delete, or mutate original sources, final/signed/filed/served documents, user-edited files, or protected drafts without visible hard-gate approval.
- If an artifact is stale or conflicts with a source, preserve both facts, flag the conflict, and route the issue to Legal Ops rather than silently replacing history.
