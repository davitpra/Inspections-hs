## Context

See `proposal.md` for motivation, and `specs/templates/spec.md` for the behavior this design
has to produce.

The relevant current state: the builder holds the whole draft document in local state and
saves it on demand, every edit is a pure function in the route's `edits.ts` returning a new
document, and the one function that writes `section_title` today is the one that sets a
section's location — it receives an already-resolved catalog name and assigns it
unconditionally. A second pure function that renames a section already exists and is already
tested, but no component calls it.

This change is confined to the web builder. It does not touch an immutable table, and it does
not alter the database guarantees of ADR-002 and ADR-004: a draft is stored as an opaque JSON
document, and `template_version_item.section_title` is projected out of it at publication by
an existing Postgres trigger. No migration, no `REVOKE`/RLS work, no API or contracts change,
and no change to `packages/forms` — its draft schema already accepts any `section_title`, its
published schema already requires a non-empty one, and its draft validation already reports a
section that has none.

## Goals / Non-Goals

**Goals:**

- Keep the decision about whether to overwrite a title in one pure function, so it can be
  tested without rendering.
- Keep the catalog as the source of the *suggestion* while making the author the source of
  the *text*.
- Leave the publication gate exactly where it is: an empty title is refused by the existing
  draft validation, not by a new check in the editor.

**Non-Goals:**

- A per-plant section title. The per-plant resolution of a location stays read-only; this
  change gives the section one title, not one per site.
- Any notion of "the title is custom" stored in the document. No new field.
- Reconciling titles in drafts or published versions when a catalog entry is later renamed.
  That was already true and stays true.

## Decisions

**The overwrite rule compares against the previous catalog name, and stores no flag.**
When the location changes, the new catalog name is written only if the current title is empty
or equals the catalog name of the code the section named *before*. This makes "the author
wrote this" inferable from the document itself rather than recorded in it.

Storing a boolean such as `section_title_is_custom` was rejected: it adds a field to a
document schema that is shared with the form engine and frozen into every published version,
to express something the existing two fields already imply. A document written by a seed or by
hand would also have to set it correctly, and nothing would force it to.

Never overwriting after the first seed was rejected too: an author who picks the wrong
location, notices immediately and picks the right one would be left with the wrong name and no
hint that the field is the thing to fix.

**The comparison is on trimmed text, and it is exact.** No case-folding and no fuzzy match: a
title that differs from the catalog name by anything at all is the author's, and the cost of
being wrong in that direction is a preserved title the author can still edit, whereas the
other direction destroys typing.

**The decision lives in the existing location-setting function, which starts taking both
catalog names.** It receives the name of the code being chosen and the name of the code the
section currently holds, because it is pure and cannot look either up. The component that
already holds the catalog resolves both. The alternative — passing a lookup function into a
pure edit — was rejected as a worse seam for the same result.

**The title becomes a plain always-visible input, not an inline-edit affordance.** It matches
how every other authored text in this builder works (a question's prompt, the template's
name), and the repo has no inline-edit component to reuse. The heading it replaces was what
gave the section element its accessible name, so that name has to come from the section's
label instead; the input carries its own label naming which section it belongs to.

**An interface-level maximum length, not a schema one.** While the text came from the catalog
it inherited that catalog's 120-character limit on labels. Opening it to free text drops that
ceiling, and no schema anywhere — draft, published, or the `text` column — replaces it. The
input caps input at the same 120 characters. This is deliberately an affordance and not a
requirement: adding a maximum to the published document schema would make previously valid
historical documents invalid, which is not something this change is entitled to do.

## Risks / Trade-offs

- **An author renames the location's catalog entry and expects section titles to follow.**
  → They never did, and this change does not make it worse: published versions are immutable
  rows and drafts were only ever rewritten by re-picking the location. The title now visibly
  being an editable field makes the actual model easier to read, not harder.

- **A title that no longer resembles the place the section resolves to.**
  → The editor already shows, under the title, what the section applies to and what the
  location resolves to at each plant, and marks a section whose location is not mapped
  everywhere. Findings are grouped by `organization_location_code`, so a divergent title
  costs nothing downstream.

- **Clearing the location no longer clears the title, so a section can carry a title and no
  location.** → That combination was already representable and already publishable: the
  published schema requires a title and leaves `organization_location_code` optional. The
  change only stops a path that silently emptied a field the author had filled in.
