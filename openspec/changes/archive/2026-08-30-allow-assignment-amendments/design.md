## Context

See `proposal.md` for the motivation. A commitment currently lives only on the immutable
`corrective_action` row, and creation immediately appends both `open` and `in_progress`. The change
crosses contracts, PostgreSQL, NestJS and the findings route. It touches the immutable corrective
action model and therefore follows ADR-002, ADR-004 and ADR-008; it revises the frozen-deadline
consequence of ADR-014 and the creation behavior introduced with ADR-017.

## Goals / Non-Goals

**Goals:**

- Preserve every promised value while exposing one unambiguous current commitment.
- Make `assigned` a real editing window with one explicit boundary: `Start work`.
- Keep authorization, site isolation and mutation guards enforceable on the server and database.

**Non-Goals:**

- Editing an action in `in_progress`, `awaiting_verification` or `closed`.
- Reopening an action or deleting a mistaken commitment.
- Adding an independent corrective-actions route.

## Decisions

### Store replacements in an append-only amendment stream

`corrective_action` remains the immutable original. A new
`corrective_action_commitment_amendment` table stores complete replacement snapshots with a
per-action position, actor and occurrence time. Reads select the highest position, falling back to
the original row. Complete snapshots avoid reconstructing partial patches and make each promise
independently auditable. Updating the original row was rejected because it violates ADR-002.

### Serialize amendment and transition decisions on the action

The service takes the same transaction-scoped advisory lock for an amendment and a state
transition. It then reads the latest action state and accepts an amendment only for `open`. A unique
`(action_id, position)` is the final fork barrier. This prevents `Edit assignment` and `Start work`
from both committing against an obsolete state.

### Keep the existing transition machine

Creation stops after the initial `open` event. The existing `open` to `in_progress` transition and
its authorization become the explicit `Start work` decision. No state or finding-state schema
change is needed because migration 0040 already maps `open` to `assigned`.

### Expose one amendment command rather than PATCH

`POST /actions/:id/commitment-amendments` names the append-only fact and accepts all three fields.
It cannot be confused with rewriting `corrective_action`. Authorization mirrors creation for the
parent: coordinators, plus `reported_by` for finding actions. Investigation actions remain
coordinator-only.

### Project effective values at repository boundaries

Action summaries and details use the latest amendment through a lateral join. Escalation reads the
same effective deadline, and transition authorization uses the effective assignee. Details also
return the ordered commitment history so the Assigned stage can render it without extra requests.

## Risks / Trade-offs

- [Existing code assumes creation starts work] -> Update contract, integration and route tests to
  assert `open`/`assigned` and exercise the explicit transition.
- [A due-date amendment can change escalation timing] -> Always calculate future escalations from
  the effective deadline while preserving already emitted escalation rows.
- [Reassignment can race with Start work] -> Serialize both commands on the action before checking
  state.
- [Historical person names can later change] -> Preserve person identity as today; this change does
  not introduce name snapshots.

## Migration Plan

1. Deploy the new table, policies, audit function and grants before exposing the command.
2. Existing actions need no backfill: their base row is position zero conceptually and remains the
   effective commitment until an amendment exists.
3. Deploy API and web together because newly created actions now remain `open`.
4. Rollback may remove application exposure but must not drop or rewrite committed amendment rows.
