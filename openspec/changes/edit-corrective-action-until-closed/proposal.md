## Why

An assignment correction currently appends another complete commitment and presents every version
as a list. That treats an operational mistake as a final decision and makes one corrective action
look like several tasks. Responsible person, work and deadline need to remain correctable until the
action is closed; only the values accepted at closure are the final regulatory record.

This revises the corrective-action behavior delivered in stage 4 of `Requisitos_V1.2.md` §7. It does
not close a new roadmap stage: it corrects the semantics and presentation of R2 before production.

## What Changes

- **BREAKING** Replace append-only commitment amendments with an in-place, full assignment
  replacement while the action is not `closed`.
- Freeze responsible person, description and deadline at `closed`, with database-enforced column and
  state guards; action state remains derived from immutable events.
- Record only stable action identity at creation and include the final assignment snapshot in the
  closing audit entry; intermediate assignment edits do not create audit history.
- Preserve already emitted escalations when a deadline changes and use the replacement deadline only
  for future escalation decisions.
- Withdraw the previous assignee notification from the inbox and notify the effective assignee after
  a replacement.
- Present one current assignment and offer editing in `assigned`, `in_progress` and verification;
  remove editing at `closed`.
- Consolidate development amendment data into the action row and retire the amendment table and API.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `actions`: assignment fields become replaceable until closure, with current-value reads,
  authorization, notification and escalation behavior revised accordingly.
- `findings`: the lifecycle presents and edits only the current assignment until the action closes.
- `audit`: action creation stops recording provisional assignment values and closure records the final
  snapshot.
- `immutability`: `corrective_action` becomes engine-enforced partially mutable until its derived
  state is `closed`, while deletion, truncation and all other column updates remain forbidden.

## Impact

The change affects the action contracts, NestJS action command and repository, PostgreSQL migration
and Drizzle schema, audit triggers, escalation projections, notification inbox queries, and the
inspection findings lifecycle. `POST /actions/:id/commitment-amendments` and the `commitments` detail
field are removed; the web client moves to `PUT /actions/:id/assignment`. No production history needs
conversion; existing development rows are consolidated before the obsolete table is dropped.
