## Why

A submitted inspection is the record the plant defends to a regulator, and today **nobody
can read one back**. The answers are written once and never selected again: grepping
`apps/api/src` for `inspection_answer` finds exactly one `INSERT` and no `SELECT`. There
is no `GET` that returns a submission's content, and the only way an inspector sees what
they sent is a draft that happens to still be on their phone — which ADR-010 budgets for
seven days, not forever.

The previous change (`2026-08-16-inspector-home-next-and-recent`) built the screen that
lists what each inspector has completed and dated each row, and drew a **deliberately
inert** "View report" control on every one of them, because the destination did not
exist. This change builds the destination and makes that control real.

This change closes **no etapa of §7** — etapas 0 through 7 are archived and only etapa 8,
the visual builder, remains. It exists to close a gap the shipped code names out loud:
`RecentInspections` carried a comment that the server exposes neither the closing date nor
the report; the first half shipped the date, this is the second half. The strongest
in-scope precedent is the Form 7 screen (`incidents` spec): a read-only view of a frozen
record, mapped through the version it was written under, is a v1 requirement.

## What Changes

- A submitted inspection can be **read back from the server**: the frozen template
  document it was answered against, its answers keyed by `item_key`, the findings it
  derived, who signed it and when, and when the server received it.
- The reading is mapped through the inspection's **own** `template_version_id`, so an
  inspection submitted under version 2 is read with the questions of version 2 even after
  version 5 is published.
- A screen renders it read-only: sections and questions in document order, each with the
  answer that was given, and the findings that a negative answer opened.
- The inert "View report" control in the completed-inspections table becomes a real link.

## Lo que este change NO es

- **No shows photos or the signature image.** Answers of type `photo` and `signature`
  carry object keys, and there is no presigned-GET route in the system for inspection or
  finding photos — only `presignComplianceGet`, which is PDF-specific. Building one is a
  decision about who may read stored images and for how long a URL lives; it deserves its
  own change rather than riding along in this one. The screen says how many photos an
  answer or a finding carries, so their absence is visible rather than silent.
- **No PDF, and no new compliance artifact.** `reporting` owns the frozen, hashed,
  site-level compliance report (§7 / R5). This is a screen that reads a record, not a
  document that gets generated, digested and stored.
- **No offline availability.** The screen reads from the server. ADR-010 budgets the
  device for work in flight, not for an archive of closed inspections.
- **It does not make anything editable.** Every table it touches is immutable, and it
  touches them with `SELECT` only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `inspections`: the capability already guarantees that a submission freezes what was
  inspected, by whom and against which version, but says nothing about reading that record
  back. It gains the obligation to return a submitted inspection's content to an
  authorised reader, mapped through the template version the inspection itself froze, and
  to say what it is not returning where photo and signature answers exist.

## Impact

- `apps/api/src/inspections/`: a new read path — controller route, service query, and the
  pure assembly of document + answers + findings into one response shape. It reads
  `finding` through `apps/api/src/findings/`, which is the dependency direction ADR-008
  already declares and `submissions.service.ts` already uses.
- `packages/contracts/src/inspections.ts` (or a sibling module): the response schema. It
  reuses `answerValueSchema` from `submissions.ts` and `findingSchema` from `findings.ts`
  rather than restating either.
- `apps/web/src/routes/`: a new route for the screen, plus the link from
  `apps/web/src/components/CompletedInspectionsTable.tsx`, which already carries
  `inspection_id` — the previous change shipped that field for exactly this.
- `apps/api`: **no migration**. `hs_app` already holds `SELECT` on `inspection`,
  `inspection_answer`, `finding` and `finding_photo` (migrations 0009 and 0010), and
  `hs_apply_site_isolation` is applied to all of them, so the site cut is RLS as usual.
- ADR-002/004 (immutability and RLS), ADR-007 (the shared forms engine walks the document
  on both sides) and ADR-010 (the device storage budget) constrain the design and are not
  modified.
