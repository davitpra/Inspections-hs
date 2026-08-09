## ADDED Requirements

### Requirement: A scheduled inspection serves the field package it needs to be worked offline

The system SHALL make everything a scheduled inspection needs available to the device that
will carry it, as three separate reads keyed by the inspection: its frozen template version
document, the location catalog of its site, and the active roster subset of its site.

The three SHALL be separate reads and SHALL NOT be combined into a single response, so that
a device that obtains some but not all of them can name exactly which part is missing.

Each read SHALL be resolvable while the requester still has a connection, and SHALL carry
no dependency on any earlier read.

#### Scenario: The three reads together are everything the device needs

- **GIVEN** a scheduled inspection assigned within the requester's site scope
- **WHEN** the device reads the inspection's template version, locations and roster
- **THEN** each read returns its part of the field package
- **AND** no further request is required before the inspection can be worked with no network

#### Scenario: One read failing does not prevent the others

- **GIVEN** a scheduled inspection whose roster read fails
- **WHEN** the template version and location reads are performed
- **THEN** both return their content
- **AND** the roster can be read again on its own without repeating the other two

### Requirement: The template version served is the one the inspection is bound to

The system SHALL serve the complete frozen document of the `template_version_id` recorded on
the scheduled inspection, together with that `template_version_id`, its `version` number and
the inspection's `site_id`.

The system SHALL NEVER resolve the template version at read time — not as the highest
published version of the template, and not as the most recent one. Publishing a newer
version of a template SHALL NOT change what an already-scheduled inspection serves.

#### Scenario: The frozen document is returned with its identifiers

- **GIVEN** a scheduled inspection bound to version `2` of a template
- **WHEN** the device reads its template version
- **THEN** the response carries the document of version `2`, its `template_version_id`, the
  number `2`, and the inspection's `site_id`

#### Scenario: Publishing a newer version does not change what is served

- **GIVEN** a scheduled inspection bound to version `2` of a template
- **WHEN** version `3` of that template is published and the device reads the inspection's
  template version again
- **THEN** the response still carries version `2`

#### Scenario: The served document is the one the shared engine accepts

- **WHEN** the template version of a scheduled inspection is read
- **THEN** the returned document parses against the shared template document schema
- **AND** the same answers validated against it on the device and on the server reach the
  same verdict

### Requirement: The catalog and roster served belong to the inspection's site and exclude what is deactivated

The system SHALL serve, for a scheduled inspection, only the locations of that inspection's
`site_id` and only the people of that same site.

The system SHALL exclude deactivated locations and deactivated people from both reads: a
deactivated entry still resolves from history but SHALL NOT be offered as a choice on a
walkthrough.

Each location SHALL carry its `id`, `code` and `name`. Each person SHALL carry their `id`,
`employee_number`, `first_name` and `last_name`, and SHALL NOT carry anything else.

#### Scenario: Only the inspection's site is served

- **GIVEN** a requester whose scope covers two sites, and a scheduled inspection at one of
  them
- **WHEN** the device reads the inspection's locations and roster
- **THEN** only entries belonging to the inspection's site are returned
- **AND** no entry from the other site appears, even though the requester may read it

#### Scenario: A deactivated location is not offered

- **GIVEN** a location of the inspection's site that has been deactivated
- **WHEN** the device reads the inspection's locations
- **THEN** that location is not in the response

#### Scenario: A deactivated person is not offered

- **GIVEN** a person of the inspection's site who has been deactivated
- **WHEN** the device reads the inspection's roster
- **THEN** that person is not in the response

#### Scenario: The roster read carries no profile detail

- **WHEN** the device reads the inspection's roster
- **THEN** each entry carries only `id`, `employee_number`, `first_name` and `last_name`

### Requirement: The field package is scoped by the session and refused outside it

The system SHALL determine what a field package read may return from the requester's session
scope, and SHALL NOT accept a site, an actor or a scope from the request.

A read for a scheduled inspection that the requester's scope does not reach SHALL be refused
with the same `inspection_not_found` response the system already gives for an inspection that
does not exist, and SHALL return no part of the package. The two SHALL be indistinguishable,
so that the routes cannot be used to discover what is scheduled at a site the requester
cannot see.

#### Scenario: An inspection outside the requester's scope is refused

- **WHEN** an account reads the field package of a scheduled inspection at a site outside its
  scope
- **THEN** the request is rejected as `inspection_not_found`
- **AND** no document, location or roster entry is returned

#### Scenario: A nonexistent inspection is refused the same way

- **WHEN** an account reads the field package of an inspection identifier that does not exist
- **THEN** the response is the same refusal as for an inspection outside its scope

#### Scenario: A cancelled inspection serves no field package

- **GIVEN** a scheduled inspection that has been cancelled
- **WHEN** the device reads its field package
- **THEN** the request is rejected as `inspection_not_found`
- **AND** no part of the package is returned
