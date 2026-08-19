## ADDED Requirements

### Requirement: A draft is a working document, not a version

The system SHALL keep an in-progress template as a `template_draft` record, separate from
`template_version` in every respect: it is mutable, it may be incomplete, it carries no version
number, and it is not reachable from any inspection, finding or record.

A draft SHALL carry its own `name`, a `key` derived from it, and a `document` holding the
sections and items being authored. Creating or saving a draft SHALL NOT write to `template`, `template_item`,
`template_version` or `template_version_item`: a draft that has never been published SHALL be
invisible to every reader of published templates, including the list offered for scheduling.

The two SHALL NOT be conflated. A published version is the record an inspection is bound to and a
regulator reads; a draft is scratch work. Storing a draft as a version — even a version marked
"unpublished" — would make the immutable table mutable, which is the one thing the model exists to
prevent.

#### Scenario: A draft is not offered for scheduling

- **GIVEN** a saved draft whose `document` is complete
- **WHEN** the templates available for scheduling are listed
- **THEN** the draft is not in the list
- **AND** no `template` row exists carrying the draft's `key`

#### Scenario: Saving a draft leaves the published model untouched

- **WHEN** a draft is created and then saved three times
- **THEN** the number of `template`, `template_item`, `template_version` and
  `template_version_item` rows is unchanged

#### Scenario: A draft is edited in place, not versioned

- **GIVEN** a draft whose `document` has one section
- **WHEN** a second section is added and the draft is saved
- **THEN** reading the draft returns both sections
- **AND** only one `template_draft` row exists for that draft

### Requirement: An incomplete draft is saved and reports what it lacks

The system SHALL accept and store a draft whose document could not be published — a section with no
items, an item with an empty prompt, an item whose configuration contradicts itself — because a
document being authored is incomplete for most of its life, and a save that refused it would force
the author to finish a section before leaving it.

The system SHALL, on every read of a draft, report whether the draft is publishable and, when it is
not, what stands in the way. Each reported issue SHALL name the section or item it concerns.

The publishability of a draft SHALL be decided by the same shared rules that validate a published
document, evaluated on the device and on the server from the same code, so that the interface never
shows a draft as ready that the server would then refuse.

#### Scenario: A section with no items is saved and reported

- **WHEN** a draft containing one section with an empty item list is saved
- **THEN** the save succeeds
- **AND** reading the draft reports it as not publishable
- **AND** an issue names that section

#### Scenario: A contradictory item configuration is reported, not rejected

- **WHEN** a draft is saved with a `scale` item whose `min` is not less than its `max`
- **THEN** the save succeeds
- **AND** reading the draft reports it as not publishable
- **AND** an issue names that item

#### Scenario: A complete draft reports itself as publishable

- **GIVEN** a draft whose document has one section with one `yes_no` item carrying a non-empty
  `prompt` and a valid `item_key`
- **WHEN** the draft is read
- **THEN** it is reported as publishable
- **AND** no issues are reported

#### Scenario: An unknown response type is refused outright

- **WHEN** a draft is saved with an item whose `response_type` is not one of the nine declared types
- **THEN** the save is rejected
- **AND** the draft's stored document is unchanged

### Requirement: The order of a draft is the order of its elements

The system SHALL derive `position` from the order of the sections and items in the draft document
rather than storing it, so that two sections or two items of the same section can never share a
position. Reordering SHALL be expressed as moving an element within its list.

When a draft is prepared for publication, sections SHALL receive positions in list order starting at
one, and the items of each section SHALL receive positions in list order starting at one.

#### Scenario: Moving a section changes the derived order

- **GIVEN** a draft whose sections are listed as `intake` then `storage`
- **WHEN** `storage` is moved one place earlier and the draft is saved
- **THEN** reading the draft lists `storage` before `intake`
- **AND** preparing that draft for publication assigns `storage` position `1` and `intake` position
  `2`

#### Scenario: Moving an item within its section changes the derived order

- **GIVEN** a section whose items are listed as `guard.fitted` then `guard.intact`
- **WHEN** `guard.intact` is moved one place earlier and the draft is saved
- **THEN** reading the draft lists `guard.intact` first
- **AND** preparing that draft for publication assigns it position `1`

#### Scenario: Removing an element closes the gap

- **GIVEN** a section with three items
- **WHEN** the second item is removed and the draft is saved
- **THEN** preparing the draft for publication assigns the remaining items positions `1` and `2`

### Requirement: Changing an item's response type replaces its configuration

The system SHALL, when an item's `response_type` changes, discard the configuration belonging to the
previous type and supply the configuration the new type requires. An item SHALL NOT retain a
configuration field belonging to a response type it no longer has.

#### Scenario: Switching from text to single choice

- **GIVEN** an item of `response_type` `text` carrying `max_length`
- **WHEN** its response type is changed to `single_choice` and the draft is saved
- **THEN** the stored item carries `options` and no `max_length`

#### Scenario: Switching to a type that needs no configuration

- **GIVEN** an item of `response_type` `number` carrying `min`, `max` and `decimals`
- **WHEN** its response type is changed to `yes_no` and the draft is saved
- **THEN** the stored item carries none of `min`, `max` or `decimals`

### Requirement: Authoring a template is the HS coordinator's

The system SHALL restrict reading, creating, saving and discarding a template draft to the HS
coordinator, and SHALL refuse every other role with a code the interface can act on rather than a
message it must parse.

The restriction SHALL be by role and not by site scope, because a template carries no `site_id` by
design and a draft carries none either: it is organisation reference content, and narrowing it by
plant would reintroduce the per-plant duplication the model exists to avoid.

#### Scenario: A non-coordinator cannot read drafts

- **WHEN** an account whose role is `jhsc_member` lists the template drafts
- **THEN** the request is refused as `template_draft_forbidden`

#### Scenario: A non-coordinator cannot save a draft

- **WHEN** an account whose role is `supervisor` saves an existing draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** the stored draft is unchanged

#### Scenario: Drafts do not depend on the requester's site scope

- **WHEN** two coordinator accounts whose scopes cover different plants list the drafts
- **THEN** both receive the same entries

### Requirement: A draft is identified by its name, and its key is derived

The system SHALL derive a draft's `key` from its `name` when the draft is created, and SHALL
NOT accept a `key` from the client. The author names the template; the identifier that the
published template will carry is a consequence of that name, not a second decision.

Two live drafts SHALL NOT share a name, compared ignoring case and surrounding whitespace,
and a draft SHALL NOT take the name of an existing template. The name is what the interface
shows, so two rows sharing one cannot be told apart by anything the author can see.

The derivation SHALL NOT disambiguate by appending a suffix. Where two different names would
produce the same key, the second SHALL be refused, so that a draft's key is always exactly
what its name derives to.

A name from which no key can be derived SHALL be refused, naming the name rather than the
key: the key is not a field the author has.

A draft's `key` SHALL NOT change after creation, renaming included. The key is what
identifies the published template and what seed files reference, and an identifier that
moved with every wording change would identify nothing. A renamed draft may therefore carry
a key that no longer resembles its name, and the key SHALL remain readable in the interface
so that divergence is legible rather than hidden.

#### Scenario: The key comes from the name

- **WHEN** a draft is created with the name `Monthly electrical inspection`
- **THEN** its `key` is `monthly-electrical-inspection`

#### Scenario: A name already used by a live draft is refused

- **GIVEN** a live draft named `Fire extinguisher round`
- **WHEN** another draft is created with the name `  fire EXTINGUISHER round `
- **THEN** the request is refused as `template_draft_name_taken`

#### Scenario: A name already used by a published template is refused

- **GIVEN** a `template` row named `Already published`
- **WHEN** a draft is created with that name
- **THEN** the request is refused as `template_draft_name_taken`

#### Scenario: Two different names that derive one key are refused, not suffixed

- **GIVEN** a live draft named `Yard sweep`
- **WHEN** a draft is created with the name `Yard  sweep!`
- **THEN** the request is refused as `template_draft_name_taken`
- **AND** no draft carries a key with an appended discriminator

#### Scenario: A name with nothing to derive from is refused

- **WHEN** a draft is created with the name `???`
- **THEN** the request is refused as `template_draft_name_unusable`

#### Scenario: Renaming changes the name and not the key

- **GIVEN** a draft named `Quarterly boiler check` with key `quarterly-boiler-check`
- **WHEN** it is renamed to `Annual boiler check`
- **THEN** the save succeeds
- **AND** its `key` is still `quarterly-boiler-check`

#### Scenario: Renaming onto another draft's name is refused

- **GIVEN** two live drafts
- **WHEN** one is saved with the other's name
- **THEN** the request is refused as `template_draft_name_taken`
- **AND** the stored draft is unchanged

#### Scenario: A discarded draft releases its name

- **GIVEN** a draft named `Compressor check` that has been discarded
- **WHEN** another draft is created with that name
- **THEN** the request succeeds
- **AND** its `key` is `compressor-check`

### Requirement: Saving over a draft that has moved is refused

The system SHALL carry a `revision` on every draft, increment it on every save, and refuse a save
that declares a `revision` other than the stored one, leaving the stored document untouched.

Two windows open on the same draft is the ordinary case for one author, not a concurrency edge:
without this, the second save silently discards everything the first one wrote.

#### Scenario: A stale save is refused and changes nothing

- **GIVEN** a draft read at `revision` 4 and then saved by another window, leaving it at `revision` 5
- **WHEN** a save declaring `revision` 4 is submitted
- **THEN** the request is refused as `template_draft_stale`
- **AND** the stored document is the one written at `revision` 5

#### Scenario: A save at the current revision succeeds and advances it

- **GIVEN** a draft at `revision` 5
- **WHEN** a save declaring `revision` 5 is submitted
- **THEN** the save succeeds
- **AND** reading the draft reports `revision` 6

### Requirement: A draft is discarded, never deleted

The system SHALL retire a draft by setting `discarded_at` rather than by deleting it. A discarded
draft SHALL be absent from the list of drafts, and deleting a `template_draft` row SHALL be refused
by the engine for every role.

#### Scenario: Discarding hides the draft and keeps the row

- **WHEN** a draft is discarded
- **THEN** it is absent from the list of drafts
- **AND** its `template_draft` row still exists with `discarded_at` set

#### Scenario: Deletion is refused by the engine

- **WHEN** a `template_draft` row is deleted as the application role
- **THEN** the statement fails
- **AND** deleting it as the migration role fails on the guard trigger

#### Scenario: The key of a draft cannot be rewritten

- **WHEN** `template_draft.key` is updated as the application role
- **THEN** the statement fails on insufficient privilege

## MODIFIED Requirements

### Requirement: Templates are loaded from versioned seed files

The system SHALL load the initial templates from SQL seed files kept under version control,
runnable independently of the migration sequence and safe to run more than once. Seeding SHALL
remain sufficient on its own to put a usable template into the system, so that a freshly migrated
database is usable without anyone opening an authoring interface, and so that continuous
integration never depends on one.

The existence of an authoring interface SHALL NOT make the seed path optional or secondary: a
template loaded by seed and a template authored through the interface SHALL be indistinguishable
once published, because both are `template` and `template_version` rows written the same way.

#### Scenario: Seeding twice leaves one copy

- **WHEN** the seed command runs against a database that already contains the seeded templates
- **THEN** it completes without error
- **AND** the number of `template`, `template_version` and `template_version_item` rows is
  unchanged

#### Scenario: A seeded template is complete and queryable

- **WHEN** the seed command runs against a freshly migrated database
- **THEN** at least one `template` row exists with a published `template_version`
- **AND** every item of that version's document has a matching `template_version_item` row whose
  `item_key` is registered in `template_item`

#### Scenario: A freshly migrated and seeded database needs no authoring

- **WHEN** the migration sequence and the seed command run against an empty database
- **THEN** the templates available for scheduling include the seeded template
- **AND** no `template_draft` row exists
