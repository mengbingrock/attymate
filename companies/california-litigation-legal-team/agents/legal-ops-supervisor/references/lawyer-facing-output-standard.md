# Attorney-Facing Output Standard

Use this standard for every lawyer-visible comment, Matter Dashboard update, issue document, work product, monitor finding, and run result. Write in concise U.S. litigation language. Lead with the legal or practical answer, not the agent process.

## One Source Of Truth

Write substantive analysis once in the appropriate issue document or work product. Link to it from the Matter Dashboard and any notification comment. Never paste the same analysis into a comment, document, dashboard, and run result.

- **Matter Dashboard:** the only routine status surface for the lawyer.
- **Issue document or work product:** the substantive analysis, draft, table, or report.
- **Comment:** a short notification only when review, action, risk, or completion matters.
- **Run result:** no more than two lines stating disposition and linking the controlling artifact or decision.
- **Internal audit:** tool output, run state, detailed manifests, contract fields, and process notes stay in the child issue or `_paperclip_issues` unless they affect reliability or the next lawyer action.

## Comment Contract

Keep lawyer-visible comments to about 120 words or fewer:

```md
**Status:** Ready for review | Decision needed | Material update | Complete

**Bottom line:** [One or two sentences stating the legal/practical result.]

**Next:** [Owner, action, and deadline if one exists.]
**Review:** [Direct link to the controlling artifact or decision.]
```

Post a comment only when:

- a substantive deliverable is ready for review;
- a material risk, deadline, or legal posture changes;
- a lawyer decision is required;
- the lawyer owns the only remaining blocker; or
- the requested work is complete.

Do not comment merely because an agent started, delegated, checked a tool, updated internal state, continued authorized work, or found no change.

## Writing Rules

- Use the vocabulary a California litigator would use: issue, authority, evidentiary support, procedural posture, requested relief, filing deadline, and recommended action.
- Distinguish confirmed facts, analysis, and unresolved questions.
- State the recommendation and the reason without narrating how the agent reached the screen.
- Use `Decision needed` for lawyer choices. Do not expose `hard gate`, `yellow escalation`, runtime, pipeline, tool-call, contract-field, or manifest jargon.
- Put the most consequential item first. Omit immaterial completeness language and repeated safety disclaimers.
- Tables are optional and limited to information the lawyer must compare. Do not create tables for one or two simple facts.
- Default to professional U.S. legal English. Use another language only when requested.

## Role Summaries

- **Intake / PDF:** reviewed scope, usable coverage, exceptions that affect legal review, and next action.
- **Facts / research:** question, short answer, key evidentiary or controlling support, material counterpoint, and recommendation.
- **Drafting:** artifact ready for review, material revisions, unresolved legal choices, and next action.
- **QA:** `Ready`, `Ready with revisions`, or `Not ready`, followed only by material issues in the primary report.
- **Calendar / docket:** event or date, reliable source, practical consequence, and recommended action.

## Examples

### Deliverable ready

```md
**Status:** Ready for review

**Bottom line:** The opposition draft is complete and supported by the approved declarations and exhibits. The principal vulnerability is the absence of a declaration authenticating Exhibit 4.

**Next:** Attorney to review the draft and decide whether to obtain a supplemental declaration before filing.
**Review:** [Opposition draft](...)
```

### Material strategy decision

```md
**Status:** Decision needed

**Bottom line:** The present record supports compelling further responses, but a sanctions request would depend on how the court views the meet-and-confer history. I recommend filing without sanctions unless additional correspondence shows continued noncompliance.

**Next:** Choose: (1) omit sanctions (recommended), (2) seek sanctions, or (3) supplement the record first. Decision requested by May 8.
**Review:** [Motion analysis](...)
```

### Evidence gap

```md
**Status:** Material update

**Bottom line:** The production establishes notice but does not establish when the defendant received the demand. That date should not be stated as an undisputed fact on the current record.

**Next:** Facts Agent will continue with supported facts; attorney action is needed only if another service record exists.
**Review:** [Fact-to-source map](...)
```

### Actionable monitor finding

```md
**Status:** Material update

**Bottom line:** The court moved the case management conference to June 14 at 8:30 a.m. The docket does not reflect a new filing deadline.

**Next:** Calendar Agent will prepare a proposed calendar update; no lawyer action is needed until the proposal is ready.
**Review:** [Docket finding](...)
```
