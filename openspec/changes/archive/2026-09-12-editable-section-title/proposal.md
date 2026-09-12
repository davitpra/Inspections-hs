## Why

A section's title is the only text in the builder the author cannot write. It is copied from
the organization location catalog when a location is picked, and the editor deliberately
offers no text field: `openspec/specs/templates/spec.md` states that a section's
`section_title` "SHALL be copied from that catalog entry", and its scenario closes with "the
author is not offered a free-text section title".

That rule answered a real question — two sections naming the same shared location must not
become two names for one place the catalog defined once — but it answered it by borrowing the
catalog's vocabulary for a different job. A catalog entry names a **place**, and the plant
mapping is free to call it `Shipping dock` at St. Thomas and `Receiving dock` at Glencoe. A
section names a **leg of the walk an inspector makes**, which is what the author is actually
writing, and it may well want to be `Docks and aisles` in both plants. Today the author has no
way to say that, which is stage 8 of requirements v1.2 §7 failing at its own purpose: the
coordinator is supposed to stop depending on a developer, and here she still depends on
whoever words the catalog.

## What Changes

- The section title becomes an editable text field in the template builder. The author may
  rewrite it at any time.
- Picking an organization location still fills the title with that catalog entry's name, but
  now as an **initial value** rather than as the only source.
- Changing a section's location no longer overwrites a title the author wrote. The catalog
  name is written only when the title is empty or still equal to the catalog name of the
  location the section named before.
- A title the author wrote therefore also survives clearing the section's location, where
  today that silently empties the title and makes the section unpublishable.
- Not changed: findings are still grouped by `organization_location_code` and never by the
  title text; the per-plant resolution of a section's location stays read-only; a section
  still names at most one organization location; an empty title still blocks publication with
  the existing `Section N has no title.` message.

No breaking change. Existing drafts and published versions are already documents whose
`section_title` happens to equal a catalog name; nothing about them is reinterpreted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `templates`: the requirement that a section's `section_title` be copied from the chosen
  organization location becomes a requirement that the catalog name seeds the title, that the
  author may rewrite it, and that a later location change preserves an authored title.

## Impact

- `apps/web/src/routes/TemplateDraftRoute/`: `SectionCard.tsx` (the read-only heading becomes
  an input), `SectionList.tsx` (wiring), `edits.ts` (the seed-or-preserve rule, and the
  already-present but unused `renameSection`), plus the route's styles and tests.
- No API, database, migration, or `packages/contracts` change. The draft document is stored
  and published as an opaque JSON document, and `template_version_item.section_title` is
  projected from it by an existing Postgres trigger.
- No `packages/forms` change. The draft schema already allows any `section_title`, the
  published schema already requires a non-empty one, and `draftIssues` already reports a
  section that has none.
- Refines stage 8 of requirements v1.2 §7 (visual builder). It does not close the stage; it
  removes one place where the builder still forces the author into a developer's vocabulary.
