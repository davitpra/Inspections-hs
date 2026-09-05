## Why

The back and forth between the person doing the corrective work and the person verifying it is one
conversation: work is declared done, sent back with a reason, declared done again, sent back again,
and finally accepted. The lifecycle record splits that conversation in two, because it files each
decision under the stage its destination state maps to: rejections read under In progress and
completion declarations under Verification.

Neither half is legible alone. The reasons appear without the declarations that provoked them, the
declarations without the rejections that followed, and the reader has to switch panels to recover
the order in which any of it happened.

This change does not close a stage of `requisitos-v1.2` §7. It repairs the read-back of a stage
already implemented: §7 asks that the corrective cycle be readable after the fact, and a record
that hides half of each exchange does not deliver that.

## What Changes

- Present the same decision thread in In progress and in Verification: every decision recorded in
  either stage, in stream order.
- Name each decision by the step that recorded it — `Work started`, `Work declared done`,
  `Sent back` — so the direction of each entry is legible inside a single list.
- Present a step that recorded no reason, note or evidence as a named entry rather than dropping
  it, so the thread starts where the work started.
- Keep Raised, Assigned and Closed reading their own stage only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `findings`: In progress and Verification present one shared decision thread, each decision named
  by the step that recorded it, including steps that recorded nothing else.

## Impact

- `apps/web/src/presentation/actions.ts`: record wording per transition pair, beside the existing
  button wording.
- `apps/web/src/routes/InspectionFindingsRoute`: which stages a record reads, and the decision
  header of each entry.
- `apps/web/src/index.css`: the class for that header.
- No schema, no migration, no API change: the server already returns the whole stream from
  `GET /actions/:id`.
