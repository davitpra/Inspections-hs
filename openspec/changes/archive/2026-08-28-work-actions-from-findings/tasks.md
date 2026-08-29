## 0. Precondition

- [x] 0.1 Confirm `add-findings-route` is applied: `/findings/$id` exists, renders the finding
  readout and offers the creation dialog. Stop here if it is not — this change grows around
  that surface.

## 1. Lift the action panel to shared components (no user-visible change)

- [x] 1.1 Move `routes/ActionRoute/EvidencePicker.tsx` to `components/EvidencePicker.tsx` and
  update its importer.
- [x] 1.2 Extract the event stream of `ActionRoute/index.tsx` into `components/ActionTimeline.tsx`,
  taking the action's events and rendering state, instant, reason, note and before/after counts.
- [x] 1.3 Extract the "what now" block and the terminal `closed` block into
  `components/ActionProgressPanel.tsx`: it receives the action and the session, derives the
  offered transitions with `transitionsFrom` + `canAttempt`, owns the reason/note/evidence
  fields and the transition mutation, and invalidates `queryKeys.action(id)` and
  `queryKeys.actions()` on success.
- [x] 1.4 Rewrite `ActionRoute/index.tsx` to compose the three components inside its existing
  two-column layout, with no change to what it renders or offers.
- [x] 1.5 Move the escalation and deadline wording used by both surfaces into
  `presentation/actions.ts`, with cases in `presentation/actions.test.ts`.
- [x] 1.6 Run `routes/ActionRoute/index.test.tsx` unchanged and green — the refactor is done when
  the existing test still describes the same screen.

## 2. The commitment row reads as a standing (spec: MODIFIED "Coordinators open a corrective action…")

- [x] 2.1 Extend `FindingCommitments` in `routes/InspectionFindingsRoute/index.tsx` so each
  corrective action shows its description, responsible person, deadline, current state, whether
  it is past that deadline and the escalation levels reached — all read from the
  `ActionSummary` already in memory, with no new query and no new key.
- [x] 2.2 Keep the description linked to `/actions/$id`, and keep the failure message that
  refuses to report "no corrective action yet" when the listing could not be read.
- [x] 2.3 Add the row styles to `index.css` using semantic tokens only, so
  `scripts/check-tokens.mjs` stays green.
- [x] 2.4 Cover in `routes/InspectionFindingsRoute/index.test.tsx`: a late escalated action reads
  as late and escalated; a `jhsc_member` sees the standing and no creation control; an unreadable
  listing is not reported as none.

## 3. The progress dialog (spec: ADDED "A corrective action is advanced from the finding…")

- [x] 3.1 Replace `selectedFinding` in `routes/InspectionFindingsRoute/index.tsx` with a
  discriminated overlay state — `{ kind: 'create'; finding }` or `{ kind: 'progress'; actionId }`
  — keeping one dialog slot outside the loop and one `onClose`.
- [x] 3.2 Add `routes/InspectionFindingsRoute/ActionProgressDialog.tsx`: mounted only while open,
  reads `queryKeys.action(id)`, and composes `ActionTimeline` and `ActionProgressPanel` inside
  the same `modal` conventions the creation dialog uses. It reports its own load failure and
  never claims an empty history.
- [x] 3.3 Add the `Update` control to each commitment row, opening the dialog for that action.
- [x] 3.4 Return focus on close to a stable container of the finding, not to the trigger button —
  a successful transition invalidates `queryKeys.actions()` and can detach it (design D6).
- [x] 3.5 Prevent dismissal while a transition is pending, matching the creation dialog.

## 4. Route tests for the advanced flow

- [x] 4.1 The assignee opens an `open` action from the findings screen, records progress, and the
  inspection reading is still on screen with the action in `in_progress`.
- [x] 4.2 A `jhsc_member` opens an action, reads the events in recorded order, and is offered no
  transition but told the action waits on someone else.
- [x] 4.3 An action whose next transition requires after evidence presents the evidence control
  before the transition can be submitted.
- [x] 4.4 A closed action shows its history and offers no transition and no reopen.
- [x] 4.5 A refused transition shows the server's message and leaves the action in its previous
  state.

## 5. Close out

- [ ] 5.1 `pnpm lint`, `pnpm -r build`, `pnpm typecheck`, `pnpm test` — build before typecheck.
- [x] 5.2 `openspec validate work-actions-from-findings --strict`.
- [x] 5.3 Confirm no API, schema, migration, RLS or contract file was touched by the diff.
