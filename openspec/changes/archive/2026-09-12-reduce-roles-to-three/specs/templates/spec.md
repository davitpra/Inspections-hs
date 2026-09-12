## MODIFIED Requirements

### Requirement: Publishing a template is the HS coordinator's

The system SHALL restrict publishing a template draft to an administrative account —
`hs_coordinator` or `management` — and SHALL refuse `jhsc_member` as `template_draft_forbidden`,
the same code the other acts on a draft use: for the role that inspects, a draft is a document that
does not exist.

#### Scenario: A JHSC member cannot publish

- **WHEN** an account whose role is `jhsc_member` publishes a draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** no `template` or `template_version` row is written

### Requirement: Revising a published template seeds a draft from its latest version

The system SHALL create, on the HS coordinator's request over a published template, a
`template_draft` bound to that template through `template_draft.template_id`, whose `document`
is the document of the template's latest published version with its positions dropped, whose
`key` and `name` are the template's own, and whose `site_ids` are the active plants of the
requesting account.

Every `item_key` the latest version declares SHALL appear unchanged in the seeded draft, because
carrying the concept forward is the whole point of revising rather than starting over.

The request SHALL be refused as `template_not_found` when the template does not exist or has been
deactivated, and as `template_version_not_found` when it has no published version. It SHALL be
restricted to an administrative account and refused to `jhsc_member` as `template_draft_forbidden`.

#### Scenario: The seeded draft repeats the published document

- **GIVEN** a template published at version 2 with two sections of two questions each
- **WHEN** the HS coordinator revises it
- **THEN** a draft exists whose `template_id` is that template
- **AND** its document declares the same four `item_key` values in the same order
- **AND** its `key` and `name` are the template's `key` and `name`

#### Scenario: The seeded draft carries no position

- **GIVEN** a template whose published document declares positions
- **WHEN** the HS coordinator revises it
- **THEN** the stored draft document declares no `position` on any section or item

#### Scenario: The published model is untouched by seeding

- **WHEN** a template is revised
- **THEN** the number of `template`, `template_item`, `template_version` and
  `template_version_item` rows is unchanged

#### Scenario: A JHSC member cannot revise

- **WHEN** an account whose role is `jhsc_member` revises a published template
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** no `template_draft` row is written

#### Scenario: A template with no published version cannot be revised

- **GIVEN** a `template` row with no `template_version`
- **WHEN** the HS coordinator revises it
- **THEN** the request is refused as `template_version_not_found`

### Requirement: Authoring a template is the HS coordinator's

The system SHALL restrict reading, creating, saving, discarding and publishing a template draft
to an administrative account — `hs_coordinator` or `management` — and SHALL refuse `jhsc_member`
with a code the interface can act on rather than a message it must parse.

The restriction SHALL be by role and not by site scope, because a template carries no `site_id` by
design and a draft's `site_ids` describes where it is intended to be used rather than whose data
it is. A draft remains organisation reference content, and restricting visibility by plant would
reintroduce the per-plant duplication the model exists to avoid.

#### Scenario: A management account authors like the coordinator

- **WHEN** an account whose role is `management` lists, creates, saves, discards or publishes a
  template draft
- **THEN** each request is accepted on the same terms as for an `hs_coordinator`

#### Scenario: A JHSC member cannot read drafts

- **WHEN** an account whose role is `jhsc_member` lists the template drafts
- **THEN** the request is refused as `template_draft_forbidden`

#### Scenario: A JHSC member cannot save a draft

- **WHEN** an account whose role is `jhsc_member` saves an existing draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** the stored draft is unchanged

#### Scenario: A JHSC member cannot publish a draft

- **WHEN** an account whose role is `jhsc_member` publishes a draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** no `template_version` row is written

#### Scenario: Drafts do not depend on the requester's site scope

- **WHEN** two coordinator accounts whose scopes cover different plants list the drafts
- **THEN** both receive the same entries

### Requirement: A published version can be read back by its own identity

The system SHALL let an authenticated account read a published template version by the
identifier of that version, without a scheduled inspection standing against it. The response
SHALL carry the frozen `document` together with the identity needed to name it: `template_id`,
`template_version_id`, the template's `key` and `name`, the `version` number and the
`published_at` timestamp of that version.

The read SHALL resolve the version whose identifier was asked for, never the highest published
version of its template. A published version's content SHALL NOT change under a stored link:
reading the same identifier twice SHALL return the same document.

The read SHALL be available on the same terms as the list of templates offered for scheduling.
A template carries no `site_id` and no row-level policy, so the response SHALL NOT depend on
which plants the reading account is scoped to, and SHALL NOT be restricted to the role that
authors templates.

#### Scenario: A published version is read by identity

- **GIVEN** a template published with `latest_version` 1 and `latest_version_id` `V`
- **WHEN** an authenticated account reads the published version `V`
- **THEN** the response carries `template_version_id` `V`, `version` 1, the template's `key`
  and `name`, and the `published_at` of that version
- **AND** the `document` is the one that was frozen at publication, section for section and
  item for item

#### Scenario: The read is not the latest version

- **GIVEN** a template whose versions `1` and `2` are both published
- **WHEN** the identifier of version `1` is read
- **THEN** the response carries `version` 1 and the document of version `1`

#### Scenario: A role that cannot author templates can still read one

- **GIVEN** a published template version
- **WHEN** an account whose role is `jhsc_member` reads it
- **THEN** the response is the same document the coordinator reads

#### Scenario: The account's plants do not change the answer

- **GIVEN** a template published from a draft written for St. Thomas only
- **WHEN** an account scoped to Glencoe reads that version
- **THEN** the response is returned in full

#### Scenario: An unknown version is refused as not found

- **WHEN** an identifier that names no `template_version` row is read
- **THEN** the request is refused as not found
- **AND** the response carries no partial document

