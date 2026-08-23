## ADDED Requirements

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
- **WHEN** an account whose role is `supervisor` reads it
- **THEN** the response is the same document the coordinator reads

#### Scenario: The account's plants do not change the answer

- **GIVEN** a template published from a draft written for St. Thomas only
- **WHEN** an account scoped to Glencoe reads that version
- **THEN** the response is returned in full

#### Scenario: An unknown version is refused as not found

- **WHEN** an identifier that names no `template_version` row is read
- **THEN** the request is refused as not found
- **AND** the response carries no partial document

### Requirement: The published version is offered as reading, never as editing

The system SHALL present a published version as a read-only record. The interface that shows it
SHALL NOT offer any way to change its questions, its order, its response types or its prescribed
corrective actions, and SHALL state that what is shown is frozen and that correcting a template
means publishing a new version.

The settings that determine how a question is completed SHALL be legible: its `prompt`, its
`item_key`, whether it is `required`, its `response_type` and that response type's configuration.
That configuration SHALL include bounds, lengths, decimal places, selection limits, photo limits
or choice labels and values whenever the discriminated response type declares them. The interface
SHALL also show the condition under which a question is visible when it declares `visible_when`,
and the complete `finding` prescription when it carries one: its `corrective_action` and its
`fails_when` threshold when present.

A section SHALL be shown with its `section_title`, in its published `position`, together with the
shared location it names when it declares one. Positions SHALL be expressed by display order
rather than by exposing their numeric values.

#### Scenario: A prescribed corrective action is shown with its question

- **GIVEN** a published version whose question carries a `finding` block with a
  `corrective_action`
- **WHEN** the version is read on screen
- **THEN** that corrective action is shown against that question

#### Scenario: Response configuration and requirement are shown

- **GIVEN** a published version whose required `multi_choice` question declares three `options`,
  `min_selected` 1 and `max_selected` 2
- **WHEN** the version is read on screen
- **THEN** the question is identified as required
- **AND** the three option labels and values and the two selection limits are shown against it

#### Scenario: A failure threshold is shown with its question

- **GIVEN** a published version whose number question carries a `finding.fails_when` with
  `operator` `gt` and `value` 80
- **WHEN** the version is read on screen
- **THEN** the threshold is shown against that question as a failure above 80

#### Scenario: A conditional question says what shows it

- **GIVEN** a published version whose question declares `visible_when`
- **WHEN** the version is read on screen
- **THEN** the question is shown together with the condition that reveals it, and not hidden

#### Scenario: No editing is offered

- **WHEN** a published version is read on screen
- **THEN** no control is offered that would rename, reorder, add, remove or retype anything in
  it
- **AND** the screen states that a published version is frozen

### Requirement: A published template is reachable from the authoring console

The system SHALL let the coordinator open a published template from the console where templates
are written, using the row that already names it. The published version each row opens SHALL be
the version that row names.

#### Scenario: The published row opens the version it names

- **GIVEN** the authoring console listing a published template at `latest_version` 1
- **WHEN** the coordinator opens that row
- **THEN** the version shown is the one the row named as `latest_version_id`
