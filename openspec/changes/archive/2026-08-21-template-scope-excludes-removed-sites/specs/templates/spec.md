## MODIFIED Requirements

### Requirement: A draft declares the plants it is written for

The system SHALL carry on every `template_draft` a non-empty `site_ids` list naming the
plants the template is being written for, and SHALL expose it on every read of a draft, both
in the list of drafts and in a single draft.

A draft created without a stated scope SHALL receive the site scope of the account that
created it, restricted to the plants that are still active. A plant that has been removed
cannot be inspected, so seeding a new draft with it would produce a document that is born
naming a place where it can never be used.

The scope SHALL be editable for as long as the draft is a draft, and SHALL travel inside the
same save that carries the `document` and the `name`, because changing where a template is
meant to be used is an edit like any other and is not worth a second write that could
interleave with the first.

The system SHALL refuse a save whose `site_ids` is empty, SHALL refuse a save naming a plant
outside the site scope of the requesting account, and SHALL refuse a save naming a plant that
has been removed, leaving the stored draft untouched in all three cases. The last two are
separate refusals because they are separate facts: one says the plant is not this account's,
the other says the plant no longer exists, and an author who sees them confused cannot tell
whether to ask for scope or to choose another plant.

This is selection, not isolation: a template still carries no `site_id`, still has no
row-level policy, and is still organisation reference content. `site_ids` states **where the
template is meant to be used**, not whose data it is.

Removing a plant SHALL NOT rewrite the stored `site_ids` of any draft that already names it.
The scope belongs to the document and to the author who edits it; silently narrowing a saved
draft would change a document nobody asked to change, and would do it outside the save that
the authoring interface makes explicit.

#### Scenario: A new draft is scoped to the whole account

- **WHEN** a coordinator whose scope covers both plants creates a draft
- **THEN** reading the draft reports `site_ids` naming both plants

#### Scenario: A new draft skips a removed plant in the account's scope

- **GIVEN** a coordinator account whose site scope covers St. Thomas and Glencoe
- **AND** Glencoe has been removed
- **WHEN** that account creates a draft
- **THEN** reading the draft reports `site_ids` naming only St. Thomas

#### Scenario: The scope narrows and survives the save

- **GIVEN** a draft scoped to both plants
- **WHEN** a save declaring a `site_ids` naming only St. Thomas is submitted
- **THEN** the save succeeds
- **AND** reading the draft reports `site_ids` naming only St. Thomas

#### Scenario: An empty scope is refused

- **WHEN** a save is submitted with an empty `site_ids`
- **THEN** the request is refused
- **AND** the stored draft is unchanged

#### Scenario: A plant outside the account's scope is refused

- **GIVEN** a coordinator account whose site scope covers only Glencoe
- **WHEN** that account saves a draft whose `site_ids` names St. Thomas
- **THEN** the request is refused as `template_draft_site_out_of_scope`
- **AND** the stored draft is unchanged

#### Scenario: A removed plant is refused

- **GIVEN** a coordinator account whose site scope covers St. Thomas and Glencoe
- **AND** Glencoe has been removed
- **WHEN** that account saves a draft whose `site_ids` names Glencoe
- **THEN** the request is refused as `template_draft_site_deactivated`
- **AND** the stored draft is unchanged

#### Scenario: A draft already scoped to a removed plant keeps its stored scope

- **GIVEN** a draft scoped to St. Thomas and Glencoe
- **WHEN** Glencoe is removed
- **THEN** reading the draft still reports `site_ids` naming both plants

#### Scenario: The scope is not a site isolation boundary

- **WHEN** two coordinator accounts whose scopes cover different plants list the drafts
- **THEN** both receive the same entries, whatever each draft's `site_ids` says

## ADDED Requirements

### Requirement: The scope choices offered by the builder are the active plants

The authoring interface SHALL offer, as scope choices for a draft, only the plants of the
account's scope that are still active. A removed plant SHALL NOT appear among them, whether
or not the draft being edited already names it.

The interface SHALL keep naming a removed plant wherever it is describing a scope that
already names it — the scope summary, the scope notice, and the per-plant location resolution
of a section — so that a stored `site_ids` always reads as a plant name and never as a bare
identifier. Offering and naming are separate jobs: a removed plant is still a name the
interface has to be able to pronounce, and is no longer an answer the author can pick.

When removing a plant leaves the account with a single active plant, the interface SHALL stop
drawing the scope control altogether, on the same grounds it already does for an organisation
configured with one plant: there is nothing left to choose.

This is an interface affordance, not a guarantee. The authoritative refusal is the save, which
rejects a `site_ids` naming a removed plant.

#### Scenario: A removed plant is not among the scope choices

- **GIVEN** an account whose scope covers St. Thomas and Glencoe, with a third plant removed
- **WHEN** the author opens a draft
- **THEN** the scope choices name St. Thomas and Glencoe and no removed plant

#### Scenario: The scope control disappears when one active plant is left

- **GIVEN** an account whose scope covers St. Thomas and Glencoe
- **WHEN** Glencoe is removed and the author opens a draft
- **THEN** no scope control is shown

#### Scenario: A stored scope naming a removed plant still reads as a name

- **GIVEN** a draft whose stored `site_ids` names Glencoe, which has been removed
- **WHEN** the author opens the draft
- **THEN** the scope summary names Glencoe rather than its identifier
