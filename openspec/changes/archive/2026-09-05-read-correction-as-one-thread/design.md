## Context

See proposal.md — Why. The split is not a rendering accident: the record picks its events with
`STAGE_BY_ACTION_STATE`, the same table that decides which stage a finding is currently held in.
That table is right for deciding and wrong for reading, and it is the only table there is.

Two earlier decisions are being revised on purpose, both recorded in code comments rather than in
an ADR:

- the record stopped naming each step by its transition, because `Start work` printed over the
  `In progress` stage repeated the stage the stepper already named;
- steps that recorded no reason, note or evidence stopped producing a row, because without a name
  they left a blank gap between separators.

Both hold only while a stage is read alone. Inside one merged thread the step name is what
distinguishes a declaration from a rejection — the work the two tabs used to do — and a named row
is no longer blank.

No table is touched, immutable or otherwise: `GET /actions/:id` already returns the whole stream in
recorded order (ADR-002, design D1 — `position` is the intra-action order). ADR-021 keeps the
assignment values read from the current summary, not from an event, and that stays as it is.

## Goals / Non-Goals

**Goals:**

- One decision thread shared by In progress and Verification, in `position` order.
- Each entry named by the step that recorded it, in the past tense of a record rather than the
  imperative of a button.
- The empty and unreadable cases stay distinguishable, as they are today.

**Non-Goals:**

- Changing the lifecycle stepper: it keeps five segments, driven by `finding.state` from the
  contract.
- Changing which stage a finding is in, or which action blocks it (`blockingActions` untouched).
- Merging Closed into the thread, or showing a timestamp, actor or role per entry.

## Decisions

**A second table, for reading, beside the one that decides.** `STAGE_BY_ACTION_STATE` stays the
single table that maps an action state to a finding stage; a new `STAGES_READ_TOGETHER` says which
stages are read as one. Widening `STAGE_BY_ACTION_STATE` instead — mapping `awaiting_verification`
to `in_progress` — would have collapsed the stages everywhere, including the stepper and the
deadline, which is not what is being asked. Deriving the pair inline in the component was the other
alternative: it would have put a lifecycle rule where it cannot be tested without rendering.

**Two label tables, not one.** The button wording (`Send it back`) and the record wording
(`Sent back`) are different tenses of the same pair: the button promises, the record reports.
Reusing `TRANSITION_LABELS` for the record would print an imperative over something that already
happened; deriving the record wording from the button wording would encode the tense change in
code. Both tables are keyed by the ordered PAIR, for the reason the existing one already documents:
`open → in_progress` and `awaiting_verification → in_progress` reach the same state and are
different acts.

**The record reads no event the stage did not produce.** The thread is still built from the events
of each action of that finding, filtered by stage, sorted by `position` and never by
`occurred_at` — two decisions in the same second cannot be swapped by a clock.

## Risks / Trade-offs

- **Both tabs now show the same list, which can read as a bug.** → The panel keeps naming the
  stage the reader opened, and the stepper keeps marking which one the finding is in; the entries
  themselves name their step, so the list explains why both tabs reach it.
- **The thread grows without bound on an action that bounces many times.** → It is already the
  case per stage, and recorded order is the point; nothing is collapsed on purpose (the spec
  forbids it).
- **Un-annotated steps add rows that carry only a name.** → That is the intent: the thread starts
  where the work started. It is also the reason the "wrote nothing" filter can be deleted rather
  than inverted, which removes one of the two empty branches.
