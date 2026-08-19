# Template draft authoring

## Why

**Etapa 8 is the only stage of §7 still open**, and it is the one the coordinator feels every
month. A template enters the system exactly one way today: an SQL seed run by `hs_migrator`
(`apps/api/seeds/001_monthly_general_inspection.sql`). `apps/api/src/templates/` exposes a single
endpoint, `GET /templates`, whose own comment says "no para editarlas: el builder visual es la
etapa 8". `apps/web` has no template route at all. `hs_app` does not even hold `INSERT` on
`template`, `template_item` or `template_version` — revoked on purpose in `0003_template_model.sql`
§9, with the note that etapa 8 will grant it.

The consequence is the one `2026-08-07-template-versioning-item-identity` wrote down when it built
the model: *"Las primeras plantillas las carga el desarrollador; el coordinador deja de depender de
él en la etapa 8."* Rewording one question is a code change, a migration review and a deploy.

This change is **the first half of etapa 8**: authoring a template as a draft. Publishing it is the
second half and a separate change, because the two halves have opposite natures — a draft is
rewritten a hundred times, a published version is frozen forever — and mixing them would put a
mutable table and a `GRANT INSERT` on the immutable model into one review.

## Lo que este change NO es

- **It is not publishing.** No row is written to `template`, `template_item` or `template_version`,
  no `item_key` is registered, and the `GRANT INSERT` that `0003` §9 announces does not happen here.
  The immutable model is not touched at all — not one privilege, not one trigger.
- **It is not a new version of an existing template.** A draft starts empty. Seeding a draft from
  the latest published version — v2 out of v1, preserving `item_key` — is the natural next step and
  belongs with publishing, because preserving an identifier only means something once there is a
  version to preserve it into.
- **It is not a conditional-logic editor.** `visible_when` is preserved by the draft schema so a
  round trip never loses it, but no control writes it. Its rule — a referenced `item_key` must
  appear *strictly earlier* in document order — interacts with reordering in a way that deserves
  its own change rather than a checkbox in this one.
- **It is not weighted scoring.** Out of scope in v1, and an item still carries no weight.
- **It is not a second copy of the document schema.** The shape of a template document is
  `packages/forms`' and stays there (ADR-007). What this change adds there is the *draft* of that
  document and the pure function that says what still stands between a draft and a publishable
  version.

## What Changes

- **A draft is a new, mutable, standalone record.** `template_draft` carries a `name`, a `key`
  derived from it, and a `document` JSONB. It is not a `template_version` and it does not hang off a
  `template` row: nothing about it can reach the immutable model. It is discarded with
  `discarded_at`, never deleted.
- **The name is the identity; the key is a consequence.** Starting a template is one field. The
  author names it and the server derives the key — the identifier seeds reference and the published
  template will carry. Two live drafts cannot share a name, which is what makes the derivation safe:
  with free-text names the key would have to disambiguate itself, and two rows the list cannot tell
  apart would still exist, only invisibly. Renaming does not move the key, so the editor shows it
  read-only rather than hiding it.
- **A draft in progress is invalid on purpose, and saves anyway.** A section just created has no
  items, and `templateSectionSchema` requires `min(1)`. So a draft is validated against a *lax*
  schema on save, and a pure `draftIssues` reports — in the same shape on the device and on the
  server — everything that still stands between it and a publishable document.
- **Order is the array, not `position`.** The draft document has no `position` field; it is derived
  from array index when the draft is normalised. Reordering is moving an element. "Two items share
  the same position" stops being a reachable state instead of being an error message.
- **Five endpoints under `/templates/drafts`** — list, create, read, save, discard — all of them the
  HS coordinator's. `GET /templates` is untouched: it answers a different question, for a different
  reader, about published templates only.
- **Saving is explicit and takes a lock.** No autosave and no optimistic update, as everywhere else
  in this client. Each save bumps `revision`; a save that carries a stale `revision` is refused
  rather than allowed to overwrite what another tab wrote.
- **Two new screens.** `/templates` lists the drafts and creates one; `/templates/drafts/$id` is the
  editor — sections, items, response types with the configuration each one needs, and up/down
  reordering. Reordering is buttons, not drag and drop: no new dependency, reachable from the
  keyboard, and usable with gloves on a tablet (ADR-010).

## Capabilities

### New Capabilities

None. Authoring a template is `templates`' own subject; it has simply never been specified because
it never existed.

### Modified Capabilities

- `templates`: the capability gains the draft — a record that is explicitly *not* a version, that is
  mutable, that may be incomplete, and whose order is positional by construction. It also amends
  the existing requirement *"Templates are loaded from versioned seed files"*: the seed stops being
  the **only** way a template gets into the system, while remaining a valid one and remaining
  sufficient on its own, which is what that requirement actually guarantees. No requirement about a
  published version changes, because no published version is written.

## Impact

- **Two migrations, `0016_template_drafts.sql` and `0017_template_draft_name_identity.sql`**, and
  neither touches an immutable table. The second is one partial unique index on
  `lower(btrim(name))`; the first does the rest. It creates
  `template_draft` with `GRANT UPDATE` by column — the shape `0008` uses for `inspection_schedule` —
  and a `BEFORE DELETE OR TRUNCATE` trigger on `hs_forbid_mutation()`. No `hs_make_immutable`. No
  `hs_apply_site_isolation`, for the same reason `template` has none: a template is organisation
  reference content, not site data. Authorisation is by role, in the service, as `roster` and
  `actions` already do.
- `packages/forms`: a new `document/draft.ts` — the lax schema, `normalizeDraft`, `draftIssues`,
  `emptyDraftDocument`. Pure, no Node built-ins, no clock: it ships inside the service worker and
  the lint rule enforces it (ADR-007).
- `packages/contracts/src/templates.ts`: the draft DTOs alongside `templateOptionSchema`, which does
  not change. `template-document.ts` re-exports the new draft types, as it already does for the
  document.
- `apps/api/src/templates/`: a `templates.errors.ts` and a `templates.repository.ts` where the module
  had neither, and five methods on the service. ADR-008 holds: `templates` still calls no other
  module and is still `controller → service → repository`.
- `apps/api/src/db/schema/templates.ts`: the Drizzle mirror of the new table, written by hand —
  `drizzle-kit generate` is not used in this repo.
- `apps/web`: a new `api/templates.ts` and two query keys, `canAuthorTemplates` in `permissions/`,
  `presentation/templates.ts` for the response-type labels, and two route folders. The editor's pure
  document operations live in `TemplateDraftRoute/edits.ts` with their own test, because they are
  the part most worth testing without rendering.
- `apps/web/src/app/`: one `NAV_ITEMS` entry gated on the coordinator, two `TITLES` patterns, two
  routes in `router.tsx`.
- **Unblocked**: publishing. Once a draft exists and can say whether it is publishable, the second
  half of etapa 8 is the `GRANT INSERT` that `0003` §9 has been waiting for, plus `item_key`
  registration — and nothing else.
