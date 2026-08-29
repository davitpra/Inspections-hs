## Context

See `proposal.md` — Why. What matters for the approach is what each half of the flow costs.

`/findings/$id` already reads the corrective action listing under `queryKeys.actions()`, the
same key `/actions` uses, so state, responsible person, deadline, `overdue` and `escalations`
are **already in memory** — `actionSummarySchema` carries all of them. What is not in the
listing is the event history: the `actions` capability states that the listing omits it and
that an individual read retains it, so anything showing history needs `queryKeys.action(id)`.

The state machine already has one owner. `transitionsFrom` lives in `@hs/contracts` and is the
same table the service consults and the SQL guard of migration 0011 reproduces; `canAttempt`
(`src/permissions/actions.ts`) filters it for the acting account without copying the verifier
rule. Both are already shared. The part that is not shared is the *presentation* of that
machine — the timeline, the "what now" panel and the evidence picker — which today lives inside
`routes/ActionRoute/`.

This change touches no table, no migration and no immutable row: it is `apps/web` only.
ADR-002's rule that an action's state is derived from events and never stored is what makes the
level-1 readout free — the listing already computed it — and ADR-006 is why a transition carries
object keys and never bytes, which is what makes the upload step exist at all.

## Goals / Non-Goals

**Goals:**

- The findings reading answers "is this being handled" without a request and without navigating.
- The corrective action's history and its next step are reachable from the finding, and the
  finding stays on screen while the work moves.
- One implementation of the state machine's presentation, composed by two routes.

**Non-Goals:**

- Replacing `/actions/$id`. It stays as the permalink and keeps its own layout.
- Any offline path for advancing an action (design D15) or for uploading evidence.
- Touching the `actions` capability's server requirements, or the corrective actions workspace.
- Giving a manual finding a screen — that regression is `add-findings-route`'s and stays open.

## Decisions

### D1 — Two tiers: the row grows, the workflow opens in the dialog slot that already exists

The commitment row stops being a bare link and becomes a readout (state, responsible person,
deadline, overdue, escalations). `Update` opens a modal with history and transitions.

*Why the split.* The two tiers have different costs and different readers. The readout is free
and is what a *reader* of the findings screen wants; the history and the transition are a task,
need a second query, and are what a *worker* wants.

*Alternative — expand the action inline inside the finding's `<li>`.* Rejected. This screen is a
document: section → question → answer → finding, and the reader's job is to walk it. An action
worked for months has an event stream of unbounded height; putting it in the list breaks exactly
what the screen offers. The mobile stacking of `.finding__commitments` makes it worse — a file
picker three levels deep in a list item is not a usable target.

*Alternative — a master/detail rail on `/findings/$id`.* Rejected. Two columns fight the
document shape, and on a phone it degrades into the inline case anyway.

*Why a modal is the right container here.* The file already made this choice once, for creation:
one `<dialog>` outside the loop, a `triggerRef` for focus return, invalidation on success. The
update flow is the same shape and reuses the same machinery.

### D2 — One dialog slot, discriminated state

`selectedFinding: Finding | null` becomes one overlay state with two variants — create a
corrective action for a finding, or work an existing one by id. Creation and advancement are
mutually exclusive, so there is one slot, one `onClose`, one focus contract. Two independent
`useState` flags would allow a state the UI has no meaning for.

### D3 — The detail query is mounted on open, never per row

The progress dialog is mounted only while open (the same conditional-mount pattern
`RosterDialogs` uses), so `queryKeys.action(id)` is fetched once for the action being worked, not
once per commitment drawn. A finding with four actions costs zero extra requests until one is
opened.

### D4 — The panel is lifted to `src/components/`, not copied

`ActionTimeline`, `ActionProgressPanel` (the "what now" block plus the terminal `closed` state)
and `EvidencePicker` move out of `routes/ActionRoute/` into `src/components/`. `ActionRoute`
keeps its two-column layout and composes them; the dialog composes the same ones.

This is the rule in CLAUDE.md — a subcomponent that appears in two routes rises to
`src/components/` — and it is the whole point of the change: the risk is not the modal, it is
having two places that decide what buttons the machine offers. ADR-008's "one direction" applies
here in spirit: `transitionsFrom` decides, the components draw, nobody re-decides.

*Alternative — leave the panel in `ActionRoute/` and import across routes.* Rejected: a route
folder that another route imports from is a shared module wearing a route's name, and the next
reader would not know which of the two owns it.

### D5 — The escalation and deadline wording goes to `src/presentation/actions.ts`

It is about to be drawn in two places, and `presentation/` is where the shared vocabulary lives
next to `STATE_LABELS` and `transitionLabel`. Nothing new goes into
`routes/InspectionFindingsRoute/presentation.ts` — `actionsByFinding` and `futureDueAt` are
already this route's own decisions and stay there.

### D6 — Focus returns to the finding's item, not to the trigger button

A successful transition invalidates `queryKeys.actions()`, the commitment row re-renders and the
`Update` button that opened the dialog may be a detached node by the time the dialog closes.
`returnFocusTo.current?.focus()` on a detached element does not throw — it silently does nothing,
and the reader loses their place in a long document. Focus goes to a stable container of the
finding instead.

### D7 — Role handling is unchanged and is still only convenience

`canAttempt` already filters the offered transitions and deliberately does not reproduce the
verifier rule; the server answers `verifier_is_executor` and the dialog shows it. A
`jhsc_member` opening the dialog reads the history and is offered nothing — which is more than
today's link gives them, and still no write.

## Risks / Trade-offs

- **Two screens render the same panel and drift apart.** → The panel is one component composed
  by both, and the transitions come from `transitionsFrom` in contracts. Drift would require
  someone to write a second `if`, which is the thing the lift makes visible.
- **A modal holding an upload, two text areas and several buttons is heavy on a phone.** → It
  reuses the existing `modal` conventions and their mobile stacking; the pending state already
  blocks `onCancel` so an in-flight upload cannot be dismissed. Accepted: the alternative
  (inline) is worse on the same device.
- **The findings screen gains a workflow surface and could stop reading as a frozen record.** →
  The document body is untouched; only the commitments block grows, and everything mutable is
  behind a dialog the reader opens on purpose.
- **`ActionRoute` is refactored while it is the live path for escalation notices.** → Behaviour
  is unchanged and covered by its existing route test, which is kept green before the dialog is
  built.
- **The change is useless applied before `add-findings-route`.** → Declared in the proposal;
  apply order is part of the task list.

## Migration Plan

No data migration, no schema change, no immutable table touched. The steps are ordered so the
refactor lands before the new surface:

1. Lift the three components to `src/components/` and make `ActionRoute` compose them, with its
   route test unchanged and passing. Nothing user-visible changes.
2. Grow the commitment row to the full readout — no new query, no new component.
3. Add the progress dialog and the discriminated overlay state.

Rollback is a revert; there is no state to undo.

## Open Questions

- Whether the row shows each escalation level by name or collapses them into a single
  "Escalated" mark once more than one is reached. Purely visual, resolvable when the row is
  drawn; it changes no requirement and no task.
