# inspections

## MODIFIED Requirements

### Requirement: The template version of a scheduled inspection is frozen by the engine

The system SHALL make `site_id`, `period_start`, `period_months`, `template_id`,
`scheduled_at` and `scheduled_by` immutable once a `scheduled_inspection` row exists.

`template_version_id` SHALL be monotonic rather than immutable: it SHALL only ever be
replaced by a version of the same `template_id` whose `version` is strictly greater, it
SHALL NOT be changed once an `inspection` row exists for that scheduled inspection, and it
SHALL NOT be changed on a cancelled row. Every other move — to a lower version, to a version
of another template, on a submitted period, on a cancelled period — SHALL be refused by the
engine for every role, the owning role included.

Publishing a new version of a template SHALL have no effect of its own on any scheduled
inspection that already exists. Moving an inspection to a newer version SHALL always be an
explicit act.

#### Scenario: The application role can advance a scheduled inspection to a newer version

- **GIVEN** a scheduled inspection bound to version `2` of a template whose version `3` is
  published
- **WHEN** a session connected as the application role runs
  `UPDATE scheduled_inspection SET template_version_id = <version 3 of the same template>
  WHERE id = <existing id>`
- **THEN** the statement succeeds
- **AND** `template_version_id` reads back as version `3`

#### Scenario: No role can move a scheduled inspection to a lower version

- **GIVEN** a scheduled inspection bound to version `3` of a template
- **WHEN** any role — the application role or the migration role that owns the table — runs
  `UPDATE scheduled_inspection SET template_version_id = <version 2 of the same template>
  WHERE id = <existing id>`
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE
- **AND** `template_version_id` is unchanged when read back

#### Scenario: A version belonging to another template is still refused

- **WHEN** the `template_version_id` of a scheduled inspection whose `template_id` is
  template A is updated to a published version of template B
- **THEN** the statement fails with the foreign key violation on the
  `(template_version_id, template_id)` pair

#### Scenario: A submitted inspection cannot be moved to another version

- **GIVEN** a scheduled inspection for which an `inspection` row exists
- **WHEN** its `template_version_id` is updated to a higher version of the same template
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE
- **AND** the `inspection` row's own `template_version_id` is unchanged

#### Scenario: A cancelled period cannot be moved to another version

- **GIVEN** a scheduled inspection whose `cancelled_at` is not null
- **WHEN** its `template_version_id` is updated to a higher version of the same template
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE

#### Scenario: Publishing a newer version leaves an open inspection untouched

- **GIVEN** a scheduled inspection open against version `2` of a template
- **WHEN** version `3` of that template is published
- **THEN** the scheduled inspection still reports `template_version_id` for version `2`
- **AND** no row of `scheduled_inspection` was written by the publication

## ADDED Requirements

### Requirement: A scheduled inspection can be advanced to the newest published version of its template

The system SHALL accept a request to advance one scheduled inspection to the highest
published version of its own template, and SHALL respond with the same field package the
frozen template version read returns: the complete document, its `template_version_id`, its
`version`, the inspection's `site_id` and the inspection's `inspector_id`.

The request SHALL be restricted to the account the inspection is assigned to and to accounts
whose role is `hs_coordinator`, and SHALL be refused as forbidden to every other account.
Advancing SHALL be resolvable only within the requester's session scope, on the same terms as
every other read of the field package.

The request SHALL be idempotent: when the inspection is already bound to the highest published
version, it SHALL write nothing and SHALL still return the package. It SHALL be refused when
the period already has a submission, when the period is cancelled, and when the template has
no version higher than the one the inspection is bound to.

Advancing SHALL be recorded in the audit log of the inspection's site as an event of its own,
naming the acting account, the `template_version_id` the inspection was bound to and the one
it is now bound to. It SHALL NOT be recorded as a reassignment or as a cancellation, and a
request that writes nothing SHALL add no entry.

#### Scenario: The assigned inspector advances to the newest version

- **GIVEN** a scheduled inspection assigned to the requesting account and bound to version `2`
  of a template whose version `3` is published
- **WHEN** the account requests the advance
- **THEN** the inspection reports `template_version_id` for version `3`
- **AND** the response carries the document of version `3` and its `version` number

#### Scenario: Advancing twice writes once

- **GIVEN** a scheduled inspection that has just been advanced to version `3`
- **WHEN** the same advance is requested again
- **THEN** the response carries version `3`
- **AND** exactly one `inspection.version_advanced` entry exists for that inspection

#### Scenario: An inspection already on the newest version is not an error

- **GIVEN** a scheduled inspection bound to the highest published version of its template
- **WHEN** the advance is requested
- **THEN** the response carries that same version
- **AND** no audit entry is added

#### Scenario: A submitted period cannot be advanced

- **GIVEN** a scheduled inspection whose submission has been accepted
- **WHEN** the advance is requested
- **THEN** the request is refused and names that the period was already submitted
- **AND** `template_version_id` is unchanged

#### Scenario: A cancelled period cannot be advanced

- **GIVEN** a scheduled inspection whose `cancelled_at` is not null
- **WHEN** the advance is requested
- **THEN** the request is refused and names that the period was cancelled

#### Scenario: An account that is neither the inspector nor a coordinator is refused

- **GIVEN** a scheduled inspection assigned to another account
- **WHEN** an account whose role is `supervisor` requests the advance
- **THEN** the request is refused as forbidden
- **AND** `template_version_id` is unchanged

#### Scenario: The advance is audited with both versions

- **WHEN** an inspection bound to version `2` is advanced to version `3`
- **THEN** an audit log entry of type `inspection.version_advanced` is written for the
  inspection's `site_id` naming the acting account, the `scheduled_inspection_id`, the
  previous `template_version_id` and the new one

### Requirement: An inspector's pending list names the version published today

The system SHALL carry, on every entry of the pending list, the `version` of the
`template_version_id` the inspection is bound to, together with the `version` and the
`template_version_id` of the highest published version of that template.

The two SHALL be distinct fields and SHALL NOT be conflated: the inspection is bound to the
first and is not bound to the second until an advance is requested. They SHALL be resolved by
the server with the same expression the period opening job uses to freeze a version, so that
what the screen offers and what an advance would produce cannot disagree.

#### Scenario: The pending list carries both versions

- **GIVEN** an inspection bound to version `2` of a template whose version `3` is published
- **WHEN** the assigned inspector reads their pending list
- **THEN** the entry reports `template_version` `2`
- **AND** it reports `latest_template_version` `3` and the `template_version_id` of version `3`

#### Scenario: An inspection on the newest version reports the same version twice

- **GIVEN** an inspection bound to the highest published version of its template
- **WHEN** the assigned inspector reads their pending list
- **THEN** `template_version` and `latest_template_version` are the same number
- **AND** `template_version_id` and `latest_template_version_id` are the same identifier
