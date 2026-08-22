## Why

Removing a site is a logical deactivation that deliberately leaves `user_site_scope` alone, so
that historical records of a retired plant still resolve to a name. The consequence nobody
accounted for is that the retired plant stays inside `session.siteIds` and inside the account
scope the authoring console reads, and template scope is the one place that treats that list as
a menu of choices rather than as a lookup table.

Today the template builder still offers a removed plant under `Template scope`, and a draft
created after the removal is seeded with the account's raw scope — so it is born scoped to a
plant that no longer exists and can never be inspected. This closes that gap between stage 2
(site management) and stage 8 (template authoring) of requirements-v1.2 §7.

## What Changes

- The template builder's scope options SHALL exclude deactivated plants. The functions that only
  *name* a plant keep receiving the full account scope, so a draft whose stored `site_ids` still
  names a removed plant continues to read as a name and not as an identifier.
- A draft created after a removal is seeded with the **active** plants of the account scope
  instead of the raw scope.
- Saving a draft whose `site_ids` names a deactivated plant is refused with a new error code,
  `template_draft_site_deactivated` (`422`), distinct from `template_draft_site_out_of_scope`:
  one means "that plant is not yours", the other means "that plant is gone".
- A draft whose stored `site_ids` already names a removed plant is **not** rewritten. The scope
  travels with the document and is the author's to change; the builder simply stops offering the
  removed plant, and the author reselects when they next edit the scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `templates`: A deactivated plant is neither offered as a scope choice, nor seeded into a new
  draft's scope, nor accepted in a submitted `site_ids`.

## Impact

- `apps/api/src/templates/templates.errors.ts` gains the `template_draft_site_deactivated` code
  and its `422` factory.
- `apps/api/src/templates/templates.repository.ts` gains a read of the active plants among a set
  of ids, mirroring the one `roster/apply-roster.ts` already performs.
- `apps/api/src/templates/templates.service.ts` checks it on save and uses it to seed the scope
  on create.
- `apps/web/src/routes/TemplateDraftRoute/presentation.ts` filters deactivated plants out of
  `scopeOptions` only; `scopeLabel`, `scopeNotice` and `sectionAppliesTo` are untouched.
- No migration, no contract change: the error code is a body field of an existing endpoint and
  the site row already carries `deactivated_at`.
- Integration tests in `apps/api/test/template-drafts.int-spec.ts` and unit tests in
  `apps/web/src/routes/TemplateDraftRoute/presentation.test.ts`.
