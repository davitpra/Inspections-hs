## Context

See `proposal.md` for the missing user path. `ActionsRoute` currently reads only `/actions` and
groups that response by inspection, so it cannot represent a finding until at least one action
exists. The web client already exposes `createAction`, the API already authorizes and validates the
write, and the roster client already reads active people for one site. The findings read contract is
available in `@hs/contracts`, but the web has no client or query key for it.

The action and finding records are immutable under ADR-002 and ADR-004. This change touches their
existing read and create paths but does not alter either table, its grants, RLS, or triggers. The
flow remains online according to ADR-001; it does not enter Dexie or the outbox. The route remains a
thin composition boundary under ADR-008.

## Goals / Non-Goals

**Goals:**

- Give every scoped finding an entry point into the existing action creation operation.
- Keep role, site, validation, loading, success, and failure behavior explicit and testable.
- Reuse the existing actions list as the source of action counts and post-create rendering.

**Non-Goals:**

- Add a finding status or treat one action as completing a finding.
- Create actions offline, batch several findings, or create remediation groups in this form.
- Change action authorization, persistence, notification, escalation, or lifecycle behavior.
- Add an inspection detail request only to label this creation flow.

## Decisions

### D1: Add a findings section above the existing action groups

`ActionsRoute` will query scoped findings and actions independently. A route-local pure function
will join action summaries to findings by `finding_id` to produce the action count, while preserving
all findings in the result. The existing grouped actions table remains the navigation surface for
created obligations.

This is preferred over deriving findings from `/actions`, which necessarily loses zero-action
findings, and over changing the API response, which is unnecessary for the available contracts.

### D2: Keep the creation form in a route-local component

A `FindingsTable` will render the read model and a `CreateActionForm` will own the selected finding,
site-specific roster query, form state, and mutation. They remain in `ActionsRoute/` because no
other route uses this composition. The route `index.tsx` will only coordinate the findings and
actions queries and compose the sections.

The creation control will use a pure `canCreateAction(account)` predicate in
`src/permissions/actions.ts`. This avoids a role literal in the component without pretending that
the client predicate is authorization; the server remains authoritative.

### D3: Load the active roster only for the form's site

Opening a finding's form enables `listPeople(finding.site_id)` under
`queryKeys.roster(finding.site_id)`. The endpoint's default active filter and RLS produce the
choices; the client will not download both rosters or filter a cross-site result itself. Existing
roster cache entries can be reused.

This is preferred over loading a roster per visible row, which would duplicate requests, and over a
single global roster query, which the API deliberately does not expose.

### D4: Validate locally, submit the shared API shape, then invalidate actions

The form collects a person id, description, and browser-local `datetime-local` value. On submit it
converts the date to an offset-bearing ISO instant and validates the request with the shared action
creation schema before calling `createAction`. The minimum accepted instant is also checked at
submit time rather than only through the input attribute, because time can pass while the form is
open.

On success the mutation invalidates `queryKeys.actions()`. The refreshed list is the single source
for both the existing action groups and finding action counts. The findings query is not invalidated
because creating an action does not mutate a finding. Mutation state disables duplicate submission;
failure leaves local fields intact.

This is preferred over inserting a hand-built optimistic `ActionSummary`, whose derived state,
assignee presentation, inspection context, and escalation fields belong to the server response.

### D5: Distinguish independent connection failures

Failure to read findings will leave the existing actions section usable and report that findings
need a connection. Failure to read actions will leave findings visible but action counts
unavailable; creation can still proceed if the finding and site roster are available. A roster
failure is shown inside the open form and blocks only its submission.

This avoids turning three independent online resources into one all-or-nothing page state.

## Risks / Trade-offs

- [Many findings make the page longer] → Use a compact table and preserve the existing grouped
  action section; pagination is deferred until the current API requires it.
- [The same site's roster may be requested from several forms] → Allow only one open creation form
  and rely on the shared site-keyed query cache.
- [Client and server clocks can disagree near the selected deadline] → Treat local validation as
  guidance and preserve the server's `invalid_due_at` response as authoritative.
- [The main `actions` spec is pending synchronization with `retirar-clasificacion-de-riesgo`] → Add
  independent UI requirements rather than restating requirements changed by that earlier change.

## Migration Plan

Deploy the web artifact after the existing findings, roster, and action endpoints. No database or
data migration is required. Rollback consists only of restoring the previous web artifact; actions
already created through the form remain valid immutable records.
