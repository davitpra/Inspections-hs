## Context

See proposal.md — Why. What shapes the approach:

- `inspection_answer` is written by `submissions.service.ts` and **read by nothing**: the
  table has an `INSERT` and no `SELECT` anywhere in `apps/api/src`. Its
  `inspection_answer_inspection_idx` already indexes the lookup this change needs.
- `inspection` carries `template_version_id`, copied from the scheduled row and defended by
  the `hs_inspection_freeze_guard` trigger. That column, not the template's current head,
  is what the read-back must resolve the document from (ADR-005).
- The three field-package routes already answer per scheduled inspection through
  `findActiveInspection`, which collapses "not found", "cancelled" and "another site" into
  one `null` on purpose, and relies on RLS rather than a `WHERE site_id` (ADR-002/004).
- `inspections` already imports from `findings` (`deriveFindings`, `insertRecurrenceMarks`
  in `submissions.service.ts`); that is the dependency direction ADR-008 declares.
- `GET /findings` already returns `photo_object_keys` to clients. Object keys are inert
  without a presigned URL, and there is no presigned-GET route for inspection or finding
  images — only `presignComplianceGet`, which is PDF-specific.
- `packages/forms` exposes `sectionsInDocumentOrder` and `evaluateVisibility`, the same pure
  functions the device ran during capture and the server ran on ingest (ADR-007).

## Goals / Non-Goals

**Goals:**

- The read-back is a **projection of what was stored**, assembled from the frozen document
  and the answer rows, with no second opinion about what the inspection said.
- Pairing an answer with its question happens with the **same engine on both sides**: the
  server returns the document and the answers, and the client walks them with `@hs/forms`.
- The refusal surface of the new route is the one the field-package routes already have, so
  a reader cannot probe for inspections at sites they cannot see.

**Non-Goals:**

- No presigned-GET route, no image retrieval, no PDF (see proposal — Lo que este change NO
  es).
- No caching of the read-back on the device.
- No filter, pagination or query parameters. One submission per request.

## Decisions

### The route is keyed by the scheduled inspection, not by the submission

`GET /scheduled-inspections/:id/submission`, a fourth sibling of the three field-package
routes, reusing `findActiveInspection` for the scope check and the collapsed `null`.

The alternative — `GET /inspections/:inspectionId` — was rejected because it would need its
own scope resolution for a second identifier that identifies the same obligation, and
because every web route in this area (`/inspections/$id/capture`, `/inspections/$id/review`)
already takes the scheduled inspection id. The report screen becomes
`/inspections/$id/report` with the same `$id`, and the three read the same way.

**This corrects a claim in the previous change.** `2026-08-16-inspector-home-next-and-recent`
shipped `inspection_id` on the listing calling it "the handle the report change needs to
request the report". It is not the handle — the URL uses the scheduled id. `inspection_id`
earns its place differently and still earns it: non-null is exactly "a submission exists",
which is what decides whether the completed-inspections table renders a link at all, and it
is the only field on that row that says so without re-deriving `status`.

### The server returns the document and the answers separately, not pre-paired

The response carries the frozen `document` and `answers` as a map keyed by `item_key` — the
same shape the device submitted. The client pairs them by walking
`sectionsInDocumentOrder`.

Pre-joining into "one entry per item, with its answer" was rejected because it would put
document traversal in the service, where it would be a **second implementation** of what
`@hs/forms` already does on both sides. ADR-007 exists so that the device and the server
interpret one document with one engine; a report that walked it a third way in SQL would be
the first place the three could disagree, and it would disagree silently, about a record
meant to be evidence.

It also makes the spec's "unanswered is distinguishable from blank" fall out of the shape
instead of needing a sentinel: an item with no answer has no key in the map.

### The screen renders the walk the inspector actually saw

The client runs `evaluateVisibility(document, answers)` with the **real** answers, so a
question that a condition hid during capture is hidden in the report too. Rendering the
full document would show questions that were never asked and mark them unanswered, which
reads as an incomplete inspection rather than a conditional one.

This is the opposite choice from the preview added in the previous change, and deliberately
so: the preview has no answers and shows every item because it is describing a walk that
has not happened; the report has the answers and shows the walk that did.

### The report renders answers as text, not as disabled controls

The preview reuses `ItemRow` with `readOnly`, because it is showing *questions*. The report
is showing *values*, and a disabled radio group is a poor way to read one — the recorded
answer has to be legible at a glance, not inferred from which of five buttons looks pressed.

So the report gets its own small presentational layer that turns an `AnswerValue` into a
sentence per `response_type`, pure and tested without rendering, in the route's
`presentation.ts`.

### Findings are read through the `findings` module, not with SQL written in `inspections`

`inspections` may depend on `findings` (ADR-008, already exercised by
`submissions.service.ts`), so the by-inspection read lives with the table that owns it and
returns the existing `findingSchema`. Writing `SELECT ... FROM finding` inside
`inspections.service.ts` would put a second definition of what a finding is next to the one
in `findings`, and the risk assessment and recurrence shapes would drift first.

### Object keys travel; bytes and URLs do not

`answerValueSchema` and `findingSchema` are reused unchanged, which means photo and
signature answers carry their object keys. That is not a leak and not an oversight: a key is
inert without a presigned URL, and `GET /findings` already returns `photo_object_keys` to
every client today. Reusing the schemas keeps one definition of what an answer is.

Counting them for display is presentation, and lives on the client. The spec's obligation is
that the reader can see the evidence exists — not that the server invent a second answer
shape to express it.

## Risks / Trade-offs

- **A reader assumes the report is complete evidence and it silently omits the photos** →
  the screen states the count wherever an answer or a finding carries object keys, so the
  omission is visible on the record itself, not only in this document. The next change makes
  them retrievable.
- **The response is one payload with a document, its answers and its findings** → a monthly
  walkthrough is ~30 items and a handful of findings; the document is the same one the field
  package already ships to the device in one response. If it ever matters, the fix is
  splitting the findings into their own request, and the client shape does not have to
  change to accept that.
- **Object keys are visible to any reader with site scope** → already true of `GET /findings`
  today; if that becomes a concern it is one decision about object keys across the system,
  not a special case for this route.
- **The screen is online-only, so an inspector without signal cannot read what they sent** →
  accepted. ADR-010 budgets the device for work in flight; the local read-only draft still
  covers the days right after submission, which is the window where it matters.

## Immutable tables

This change reads `inspection`, `inspection_answer`, `finding`, `finding_photo` and
`template_version` — all immutable — **with `SELECT` only**. No `INSERT`, `UPDATE`, `DELETE`,
DDL, policy or `GRANT` change. Site isolation stays with `hs_apply_site_isolation` reached
through `DbService.withSessionClient`; no endpoint in this change filters by `site_id`
(ADR-002/004).

## Migration Plan

No schema migration. `hs_app` already holds `SELECT` on every table involved (migrations
0009 and 0010). The new contract schema is additive — nothing existing changes shape — so
rollback is removing the route and the screen.
