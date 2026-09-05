## Why

The assignment of a corrective action is currently editable through verification. In that state the
edit no longer corrects a commitment: it rewrites the object of a review already under way. Changing
the responsible person after the work was declared done withdraws the executor's notification and
makes the closing audit snapshot name someone who did not do the work; changing the description
rewrites the statement the verifier is comparing the evidence against.

Verification already has a mechanism for saying the work is not acceptable: refusal
(`awaiting_verification` → `in_progress`), which records an event with its reason. Editing in that
state was a second, unrecorded path to the same outcome.

This revises the corrective-action behavior delivered in stage 4 of `Requisitos_V1.2.md` §7. It does
not close a new roadmap stage: it moves one boundary of R2 before production.

## What Changes

- Freeze `assignee_person_id`, `description` and `due_at` when the derived state reaches
  `awaiting_verification` instead of `closed`, enforced by the database guard for every role.
- Refuse the replacement request with `invalid_action_state` from `awaiting_verification` onwards.
- Share the editable-state list as data in `packages/contracts` so the interface and the endpoint
  read the same rule.
- Remove `Edit assignment` from the Verification step; `Send it back` returns the action to
  `in_progress` and restores editing there.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `actions`: the replacement boundary moves from closure to the declaration that the work is done,
  and the deadline is frozen from that same moment.
- `findings`: the lifecycle offers assignment editing only in `assigned` and `in_progress`.
- `immutability`: the engine guard freezes the action row from `awaiting_verification`.

## Impact

The change affects the action contracts, the NestJS replacement command, one PostgreSQL migration
that replaces the guard body, and the inspection findings lifecycle presentation. Grants, RLS
policies, the event-derived state machine, the closing audit snapshot, notification withdrawal and
escalation behavior are unchanged. No data conversion is required.
