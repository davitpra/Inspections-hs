## Context

See `proposal.md`. ADR-018 currently models every correction as an immutable snapshot and ADR-014
describes the original deadline as frozen. This change touches the immutable `corrective_action`
table and therefore must retain both database barriers from ADR-002 and site isolation from ADR-004,
while changing which columns the engine permits before closure.

## Goals / Non-Goals

**Goals:**

- Keep exactly one operational assignment on each action.
- Permit complete corrections through verification and freeze them atomically at closure.
- Keep events, evidence, escalations and the final closing snapshot immutable.
- Remove stale assignment notifications from the previous assignee's inbox without deleting rows.

**Non-Goals:**

- Changing the event-derived state machine.
- Erasing escalations or notifications that were already emitted as operational facts.
- Supporting production migration of historical amendment streams; the system is pre-production.

## Decisions

### Make only the three assignment columns conditionally mutable

A migration replaces `corrective_action_forbid_mutation` with a dedicated guard. The application
role receives UPDATE only for `assignee_person_id`, `description` and `due_at`; the guard rejects any
other changed column, every update after the latest event is `closed`, and every DELETE. The existing
truncate guard remains. This preserves ADR-002's engine enforcement without treating provisional
values as immutable records. Application-only checks were rejected because direct SQL would bypass
the closure boundary.

### Serialize replacement and closure on the action row

The replacement service keeps the existing transaction lock. The event transition guard also locks
the parent action row before reading state, so a direct closing insert and an assignment UPDATE
cannot cross. Closure either sees the replacement or wins first and causes the replacement guard to
reject. Relying only on the HTTP advisory lock was rejected because the engine must enforce closure.

### Audit identity at creation and the final snapshot at closure

`action.created` keeps stable identity and creator only. Intermediate updates produce no audit entry.
The database transition audit function joins the action when `to_state = 'closed'` and includes the
three final fields in that single closing entry. Recording updates was rejected because it recreates
the history the domain now defines as provisional.

### Retire amendment projections rather than emulate them

The latest development amendment is copied into its action before the amendment table is dropped.
Every lateral `COALESCE` projection then reads the action row directly. The detail contract removes
`commitments`, and `PUT /actions/:id/assignment` names a complete idempotent replacement rather than
an append command. Compatibility code for the old endpoint is unnecessary before production.

### Withdraw stale inbox items without deleting them

`notification.withdrawn_at` is a partially mutable lifecycle field guarded by the engine. Inbox
reads exclude withdrawn rows. A responsible-person correction withdraws active assignment
notifications for the action and inserts one for the effective assignee. Existing escalation rows
and notifications remain unchanged when the deadline moves.

## Risks / Trade-offs

- [A deadline changes after escalation] -> Preserve emitted escalation facts and apply the new date
  only to levels not yet emitted.
- [Work is reassigned after completion] -> Verifier separation continues to use the actor of the
  completion event, not the current assignee.
- [Closure races with an edit] -> Serialize both through the parent action row and re-read state.
- [Development audit rows mention retired amendments] -> Recreate demo databases after migration;
  no production chain exists to preserve.

## Migration Plan

1. Consolidate the latest amendment values into each action under migration privileges.
2. Remove amendment functions, triggers and table, then update the Drizzle schema.
3. Install the conditional action guard, exact UPDATE grant, closing snapshot audit and notification
   withdrawal support with RLS unchanged.
4. Deploy contracts, API and web together because the endpoint and detail response are breaking.
5. Recreate development/demo data so no obsolete amendment audit payload remains.

Rollback is pre-production only: restore the old schema migration chain and recreate the database.
