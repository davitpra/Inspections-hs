## ADDED Requirements

### Requirement: A draft declares the plants it is written for

The system SHALL carry on every `template_draft` a non-empty `site_ids` list naming the
plants the template is being written for, and SHALL expose it on every read of a draft, both
in the list of drafts and in a single draft.

A draft created without a stated scope SHALL receive the full site scope of the account that
created it. The scope SHALL be editable for as long as the draft is a draft, and SHALL travel
inside the same save that carries the `document`, the `name` and the `revision`, so that a
scope change is subject to the same optimistic lock as every other edit.

The system SHALL refuse a save whose `site_ids` is empty, and SHALL refuse a save naming a
plant outside the site scope of the requesting account, leaving the stored draft untouched in
both cases. This is selection, not isolation: a template still carries no `site_id`, still
has no row-level policy, and is still organisation reference content. `site_ids` states
**where the template is meant to be used**, not whose data it is.

#### Scenario: A new draft is scoped to the whole account

- **WHEN** a coordinator whose scope covers both plants creates a draft
- **THEN** reading the draft reports `site_ids` naming both plants

#### Scenario: The scope narrows and survives the save

- **GIVEN** a draft at `revision` 3 scoped to both plants
- **WHEN** a save declaring `revision` 3 and a `site_ids` naming only St. Thomas is submitted
- **THEN** the save succeeds
- **AND** reading the draft reports `revision` 4 and `site_ids` naming only St. Thomas

#### Scenario: An empty scope is refused

- **WHEN** a save is submitted with an empty `site_ids`
- **THEN** the request is refused
- **AND** the stored draft is unchanged

#### Scenario: A plant outside the account's scope is refused

- **GIVEN** a coordinator account whose site scope covers only Glencoe
- **WHEN** that account saves a draft whose `site_ids` names St. Thomas
- **THEN** the request is refused as `template_draft_site_out_of_scope`
- **AND** the stored draft is unchanged

#### Scenario: A stale save cannot change the scope either

- **GIVEN** a draft read at `revision` 4 and then saved elsewhere, leaving it at `revision` 5
- **WHEN** a save declaring `revision` 4 and a different `site_ids` is submitted
- **THEN** the request is refused as `template_draft_stale`
- **AND** the stored `site_ids` is the one written at `revision` 5

#### Scenario: The scope is not a site isolation boundary

- **WHEN** two coordinator accounts whose scopes cover different plants list the drafts
- **THEN** both receive the same entries, whatever each draft's `site_ids` says

### Requirement: A section may only name a location every plant in scope has

The authoring interface SHALL offer, for a section's `organization_location_code`, only those
organization locations that are mapped to an active location at **every** plant in the
draft's `site_ids`. An organization location mapped at one plant of a two-plant scope SHALL
NOT be offered, because a section naming it cannot resolve at the other plant, and a finding
raised there would be stored with no location at all.

The interface SHALL show, for each plant in scope, the location that the section's chosen
organization location resolves to at that plant. That resolution SHALL be read-only: a
section names one organization location, and the per-plant pairing is the mapping's business,
not the author's.

Narrowing or widening the scope SHALL NOT silently rewrite a section. When a section already
names an organization location that is not mapped at every plant in the new scope, the
interface SHALL report that section as needing attention and SHALL keep the stored code, so
that the author decides whether to remap the location or choose another.

This narrowing is an interface affordance, not a guarantee: the authoritative refusal is the
document schema at publication time, and the fallback for an unmapped section at ingestion
time is unchanged.

#### Scenario: A location mapped at only one plant is not offered to a both-plant draft

- **GIVEN** a draft scoped to both plants
- **AND** an organization location mapped to a location at St. Thomas and at no other plant
- **WHEN** the author opens the location choices for a section
- **THEN** that organization location is not among them

#### Scenario: The same location is offered once the scope narrows

- **GIVEN** the draft and organization location of the previous scenario
- **WHEN** the scope is narrowed to St. Thomas only
- **THEN** that organization location is among the choices

#### Scenario: The per-plant resolution is shown for the chosen location

- **GIVEN** a draft scoped to both plants
- **AND** a section naming an organization location mapped to `Shipping dock` at St. Thomas
  and to `Receiving dock` at Glencoe
- **WHEN** the section is read in the editor
- **THEN** it shows `Shipping dock` for St. Thomas and `Receiving dock` for Glencoe
- **AND** neither is offered as an editable choice

#### Scenario: Narrowing the scope reports a section it leaves stranded, and changes nothing

- **GIVEN** a draft scoped to St. Thomas only with a section naming an organization location
  mapped only at St. Thomas
- **WHEN** the scope is widened to both plants
- **THEN** that section is reported as needing attention
- **AND** its stored `organization_location_code` is unchanged

### Requirement: A section or a question can be duplicated

The authoring interface SHALL let the author duplicate a section or a question. A duplicate
SHALL copy everything that describes the content — the prompt or the location, the response
type and its configuration, and whether an answer is required — and SHALL receive a fresh
`section_key` or `item_key` that collides with nothing in the document.

A duplicate SHALL be placed immediately after its original, because the author duplicates to
write a variation of what they are looking at, and appending it to the end would move the
work away from the place they are working in.

An item's `visible_when` SHALL NOT be carried onto a duplicate. Copying it would produce a
second item answering to the same condition, which is almost never what was meant and which
can silently break the strictly-backwards reference rule when the duplicate is later moved.

#### Scenario: Duplicating a question keeps its content and takes a new identity

- **GIVEN** a section whose second item is a required `scale` question with `min` 1 and `max` 5
- **WHEN** that item is duplicated
- **THEN** the section has a third item carrying the same `prompt`, `response_type`, `min`,
  `max` and `required`
- **AND** its `item_key` differs from every other `item_key` in the document
- **AND** it sits immediately after the item it was duplicated from

#### Scenario: Duplicating a section copies its questions

- **GIVEN** a section with three items
- **WHEN** the section is duplicated
- **THEN** the new section has three items whose prompts match, in the same order
- **AND** no `section_key` or `item_key` appears twice in the document

#### Scenario: A duplicate does not inherit a visibility condition

- **GIVEN** an item carrying a `visible_when` condition
- **WHEN** it is duplicated
- **THEN** the duplicate carries no `visible_when`
