## Context

See proposal.md — Why.

The state that shapes everything here: `sites.service.ts::deactivate` writes `deactivated_at`
and unlinks the plant's physical locations, and deliberately leaves `user_site_scope` alone.
That is not an oversight — the header of `sites.service.ts` argues it at length, and
`list` returns deactivated plants on purpose so that a rule or an inspection belonging to a
closed plant still resolves to a name. The cost is that every consumer of the scope has to
decide for itself whether it is *naming* a plant or *offering* one, and the template builder
is the one place that got it wrong.

The relevant precedents already in the tree:

- `LocationsRoute/index.tsx` filters `deactivated_at === null` before rendering columns.
- `components/SitePicker.tsx` takes the other route: it shows closed plants and marks them
  `(closed)`, because a scheduling or roster console has to be able to look at history.
- `roster/apply-roster.ts` validates declared site ids with
  `SELECT id, code FROM site WHERE id = ANY($1::uuid[]) AND deactivated_at IS NULL` — the same
  read this change needs, in a module that is not `catalog`.

This change touches no table and no migration. `site` is already immutable except for the
`name`/`deactivated_at` grant of migration 0023; `template_draft` is unchanged. ADR-002 and
ADR-004 are therefore not in play beyond the fact that nothing here deletes anything.

## Goals / Non-Goals

**Goals:**

- Stop the builder from offering a plant that cannot be inspected.
- Stop `createDraft` from seeding a scope that names one.
- Make the server the authority on that refusal rather than the screen.

**Non-Goals:**

- Reconciling how the whole application treats a deactivated plant. `SitePicker` marking
  `(closed)` and `LocationsRoute` hiding are two different answers to the same question, and
  both are right for their screen. Splitting `session.siteIds` into "scope" and "active scope"
  is a bigger change with a bigger blast radius and is not attempted here.
- Removing a retired plant from `user_site_scope`. That would break the naming path this
  change depends on.
- Rewriting stored drafts. Explicitly refused in the proposal.
- Publication. A published `template` is out of this change's reach; only drafts have a
  `site_ids` an author edits.

## Decisions

**The web filter goes in `scopeOptions` and nowhere else.**

`presentation.ts` holds five functions over the same `sites` array, and only one of them is a
menu. `scopeOptions` builds the choices; `scopeLabel`, `scopeNotice`, `sectionAppliesTo` and
the per-plant rows in `TemplateSummary`/`SectionCard` all *name*. Filtering at the route
boundary — in `index.tsx`, where `sites` is already narrowed to the account scope — was the
obvious alternative and is wrong: it would make a stored `site_ids` naming a removed plant
resolve to `No plants` in `scopeLabel`, and would silently change the meaning of
`named.length === sites.length` (the `Both plants` branch) for every draft in the system.

A useful consequence falls out for free. `scopeLabel` is called from inside `scopeOptions`
with the *filtered* list, so when a two-plant organisation loses one, the surviving plant's
label is `Glencoe` and not `Glencoe only` — which is correct, because that plant now *is* the
organisation. And `scopeOptions` returning a single option makes `ScopePicker` return `null`
at its existing `options.length < 2` guard, so the control disappears on the same grounds that
file already documents for a one-plant organisation. No new branch is added to `ScopePicker`.

**The API check is a repository read, not a call into `catalog`.**

`templates` needs to know which of a set of ids are active plants. Calling
`SitesService.list` would create a module dependency ADR-008 does not declare, for the sake of
a single-column predicate. Reading `site` directly from `templates.repository.ts` is what
`roster`, `reporting`, `inspections` and `actions` all already do for exactly this predicate;
the read is against a table with no RLS policy (0004), so nothing about isolation changes.
Layering stays `controller → service → repository`.

**A new error code rather than widening `template_draft_site_out_of_scope`.**

Both are `422` and both are refusals about `site_ids`, so reusing the existing code was
tempting. It would tell the author the wrong thing: `..._out_of_scope` means "ask for scope on
that plant", and there is no scope to ask for on a plant that no longer exists. The module
already argues in `templates.errors.ts` that the code goes in the body precisely so the screen
can say different things, and this is a case where it must.

**`createDraft` seeds from the same read.**

`createDraft` currently passes `session.siteIds` straight through with a comment explaining why
it seeds the whole account scope. The reasoning survives intact — asking the author "is this
for both plants?" before they have written a question is still the wrong first question — only
the input narrows. The seeding read runs inside the same `withSessionClient` transaction as
the insert.

**The check runs on save, not on read.**

`getDraft` and `listDrafts` keep returning whatever `site_ids` is stored, including a removed
plant. Refusing to *read* a draft because the world changed under it would lock the author out
of the very document they need to fix.

## Risks / Trade-offs

- **A draft saved before this change stays scoped to a removed plant, and now cannot be saved
  at all until the author changes the scope.** → This is the intended shape of the refusal, but
  it means the author's first save after the removal is rejected. The builder does not lose
  their work — `TemplateDraftRoute` keeps the document in local state on rejection, by design —
  and the surviving scope choices are right there. Accepted; the alternative was pruning the
  stored scope, which the user explicitly rejected.
- **With every plant in an account's scope removed, `createDraft` would seed an empty
  `site_ids` and hit the `CHECK` of migration 0020 §3 as a `500`.** → Only reachable by removing
  every plant an organisation has, which the Locations console cannot produce without also
  emptying itself. Not defended against; noted so the next person does not read the `500` as a
  mystery.
- **Two screens now disagree about closed plants — `SitePicker` shows them marked, the template
  builder hides them.** → Deliberate and stated in Non-Goals: scheduling looks at history,
  authoring writes the future. The divergence is documented in `presentation.ts` so it reads as
  a decision rather than an inconsistency.
- **The web filter and the server refusal can drift.** → They are checked by tests on both sides
  (`presentation.test.ts`, `template-drafts.int-spec.ts`), and unlike `draftIssues` this is not
  a rule that must be one implementation: the screen is an affordance and the server is the
  authority, which is the same relationship `src/permissions/` already documents.
