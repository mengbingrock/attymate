---
schema: agentcompanies/v1
slug: lasc-browseros-docket-check
name: lasc-browseros-docket-check
description: Check authorized Los Angeles Superior Court public docket information, summarize material register events, and identify procedural or deadline consequences without crossing scope, payment, or access controls.
---

# lasc-browseros-docket-check

## Procedure

1. Confirm court/case parameters, authorized public scope, relevant time window, and output target.
2. Use configured read-only access and permitted free public documents within the parent/profile scope.
3. Separate confirmed docket facts, analysis/inference, and any access limitation that affects reliability.
4. Route potential deadline consequences to Calendar with the reliable trigger source.
5. Produce one procedural status artifact using `references/docket-output-format.md`.
6. No-change monitor runs end silently; actionable changes follow `agents/docket-agent/references/monitoring-report-contract.md`.

## Decisions And Interruptions

Payment, paid retrieval, expanded case/court scope, filing, service, sends, calendar writes, and external sharing require the appropriate attorney decision. Login/MFA/CAPTCHA or connector failure is an operational interruption; never bypass it.

## Communication

State the material docket event, reliable source, practical consequence, and recommended action. Keep search parameters, timestamps, portal process, and dedupe detail internal.

## Limits

Do not inspect another matter/case outside scope, pay for records without a decision, bypass access controls, or take filing/service/calendar/send actions.
