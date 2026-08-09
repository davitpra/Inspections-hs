## Purpose

Defines the obligation to inspect: which site owes which inspection for which monthly period,
against which published template version, and by whom. It guarantees that the template version an
inspection was opened against is frozen at scheduling time and cannot be moved by a later
publication, that a period is opened exactly once per site and template no matter how many times
the opening job runs, and that every inspector can see what they still owe.

## Requirements

### Requirement: A scheduled inspection binds a site, a monthly period and a frozen template version

The system SHALL store every scheduled inspection in `scheduled_inspection` with `site_id`,
`period_start`, `template_id`, `template_version_id`, `inspector_id`, `scheduled_at` and
`scheduled_by`. `period_start` SHALL be the first calendar day of the month the inspection covers,
and `period_end` SHALL be derived from it as the last calendar day of that same month rather than
stored independently. `template_version_id` SHALL reference a published version of `template_id`,
and the pair SHALL be enforced by the engine so that a scheduled inspection cannot name a version
belonging to a different template.

#### Scenario: A period that does not start on the first of a month is rejected

- **WHEN** a row is inserted with `period_start` `2026-08-15`
- **THEN** the insert fails with a check violation on `period_start`

#### Scenario: The period end is the last day of the period month

- **WHEN** a scheduled inspection is read back with `period_start` `2026-02-01`
- **THEN** `period_end` is `2026-02-28`
- **AND** a scheduled inspection with `period_start` `2028-02-01` reads back `period_end`
  `2028-02-29`

#### Scenario: A version belonging to another template is rejected

- **WHEN** a row is inserted whose `template_id` is template A and whose `template_version_id` is a
  published version of template B
- **THEN** the insert fails with a foreign key violation on the `(template_version_id, template_id)`
  pair

### Requirement: The template version of a scheduled inspection is frozen by the engine

The system SHALL make `site_id`, `period_start`, `template_id`, `template_version_id`,
`scheduled_at` and `scheduled_by` immutable once a `scheduled_inspection` row exists. Publishing a
new version of a template SHALL have no effect on any scheduled inspection that already exists.
Correcting the version an inspection is bound to SHALL be done by cancelling the row and scheduling
a new one, never by updating it.

#### Scenario: The application role cannot move a scheduled inspection to another version

- **WHEN** a session connected as the application role runs
  `UPDATE scheduled_inspection SET template_version_id = <another version of the same template>
  WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** `template_version_id` is unchanged when read back

#### Scenario: The owner role cannot move a scheduled inspection to another version

- **WHEN** a session connected as the migration role — which owns the table — runs the same
  `UPDATE`
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE, not with a privilege
  error

#### Scenario: Publishing a newer version leaves an open inspection untouched

- **GIVEN** a scheduled inspection open against version `2` of a template
- **WHEN** version `3` of that template is published
- **THEN** the scheduled inspection still reports `template_version_id` for version `2`
- **AND** no row of `scheduled_inspection` was written by the publication

#### Scenario: A scheduled inspection cannot be deleted

- **WHEN** any role runs `DELETE FROM scheduled_inspection WHERE id = <existing id>`
- **THEN** the statement fails and the row is still present

### Requirement: A schedule rule declares what a site owes every month

The system SHALL store recurrence rules in `inspection_schedule` with `site_id`, `template_id`,
`default_inspector_id`, `created_at` and `deactivated_at`. A rule SHALL mean that the site owes one
inspection of that template for every monthly period while the rule is active. At most one active
rule SHALL exist per `(site_id, template_id)`. A rule SHALL never be deleted: it is deactivated,
and a deactivated rule SHALL stop producing new periods while every inspection it already produced
stays valid.

#### Scenario: A second active rule for the same site and template is rejected

- **GIVEN** an active rule for site St. Thomas and the monthly safety template
- **WHEN** a second rule is created for the same site and the same template
- **THEN** the insert fails with a unique violation
- **AND** the message names `site_id` and `template_id`

#### Scenario: A rule can be recreated after deactivation

- **GIVEN** a rule for site St. Thomas and the monthly safety template with `deactivated_at` set
- **WHEN** a new rule is created for the same site and the same template
- **THEN** the insert succeeds and both rows are present

#### Scenario: A deactivated rule stops opening periods

- **GIVEN** a rule deactivated during the current period
- **WHEN** the period opening job runs
- **THEN** no scheduled inspection is created for that rule
- **AND** the inspections that rule opened in previous periods are unchanged

#### Scenario: A rule whose template has no published version cannot be created

- **WHEN** a rule is created for a template that has no `template_version` row
- **THEN** the request is rejected and names the template as having nothing publishable to inspect

### Requirement: The current period is opened automatically once per site

The system SHALL run a recurring job that, for every active schedule rule of every active site,
creates the scheduled inspection of the current monthly period if it does not already exist. The
job SHALL resolve the current period in the `America/Toronto` calendar, not in UTC. The job SHALL
bind the newly created inspection to the highest published version of the rule's template at the
moment it runs, and SHALL assign the rule's `default_inspector_id` as `inspector_id`. The job SHALL
be idempotent: running it any number of times within a period SHALL leave exactly one
non-cancelled scheduled inspection per `(site_id, template_id, period_start)`, and that uniqueness
SHALL be enforced by the database rather than by the job.

#### Scenario: Running the job twice creates one inspection

- **GIVEN** one active rule and no scheduled inspection for the current period
- **WHEN** the period opening job runs, and then runs again
- **THEN** exactly one `scheduled_inspection` row exists for that site, template and period
- **AND** the second run reports zero inspections created

#### Scenario: Concurrent runs cannot create a duplicate

- **WHEN** two runs of the job attempt to insert the same `(site_id, template_id, period_start)`
  concurrently
- **THEN** exactly one row exists afterwards
- **AND** neither run fails with an unhandled error

#### Scenario: The period is resolved in the site's calendar

- **GIVEN** the job runs at `2026-09-01T02:00:00Z`, which is `2026-08-31` in `America/Toronto`
- **WHEN** the job resolves the current period
- **THEN** `period_start` is `2026-08-01`, not `2026-09-01`

#### Scenario: The opened inspection is bound to the latest published version

- **GIVEN** a template whose highest published version is `3`
- **WHEN** the job opens the current period for a rule on that template
- **THEN** the created row's `template_version_id` is version `3`

#### Scenario: A cancelled inspection lets the period be scheduled again

- **GIVEN** a scheduled inspection for the current period that has been cancelled
- **WHEN** a new inspection is scheduled for the same site, template and period
- **THEN** the insert succeeds and both rows are present, one cancelled and one open

#### Scenario: The job sees every site without a session

- **WHEN** the period opening job runs
- **THEN** it operates under an explicitly declared site scope covering every active site
- **AND** it does not run under any user session

### Requirement: Only the HS coordinator schedules, reassigns and cancels

The system SHALL restrict creating and deactivating schedule rules, scheduling an inspection
outside the automatic calendar, reassigning `inspector_id` and cancelling a scheduled inspection to
accounts whose role is `hs_coordinator`. `inspector_id` SHALL reference an account whose role is
`jhsc_member` and whose active site scope includes the inspection's `site_id`. Every one of these
operations SHALL be recorded in the audit log with the acting account.

#### Scenario: A JHSC member cannot reassign an inspection

- **WHEN** an account whose role is `jhsc_member` requests a change of `inspector_id` on a
  scheduled inspection
- **THEN** the request is rejected as forbidden
- **AND** `inspector_id` is unchanged

#### Scenario: A supervisor cannot create a schedule rule

- **WHEN** an account whose role is `supervisor` requests the creation of a schedule rule
- **THEN** the request is rejected as forbidden

#### Scenario: An inspector without scope for the site is rejected

- **WHEN** the coordinator assigns as `inspector_id` an account whose role is `jhsc_member` but
  whose active site scope does not include the inspection's `site_id`
- **THEN** the request is rejected and names the site the account lacks

#### Scenario: An account that is not a JHSC member is rejected as inspector

- **WHEN** the coordinator assigns as `inspector_id` an account whose role is `management`
- **THEN** the request is rejected and names the role

#### Scenario: A reassignment is audited

- **WHEN** the coordinator changes `inspector_id` on a scheduled inspection
- **THEN** an audit log entry is written for the inspection's `site_id` naming the acting account,
  the previous `inspector_id` and the new one

### Requirement: Cancelling requires a reason and never removes the row

The system SHALL cancel a scheduled inspection by setting `cancelled_at` and `cancellation_reason`
together. Neither SHALL be set without the other, and neither SHALL be cleared once set: an
inspection is not un-cancelled, it is scheduled again. A cancelled inspection SHALL disappear from
pending lists while remaining readable as a record of the period.

#### Scenario: Cancelling without a reason is rejected

- **WHEN** `cancelled_at` is set on a row while `cancellation_reason` stays null
- **THEN** the statement fails with a check violation naming both columns

#### Scenario: A cancellation cannot be undone

- **WHEN** any role attempts to set `cancelled_at` back to null on a cancelled row
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE

#### Scenario: A cancelled inspection leaves the pending list

- **GIVEN** a scheduled inspection assigned to an inspector and then cancelled
- **WHEN** that inspector reads their pending inspections
- **THEN** the cancelled inspection is not listed

### Requirement: Every inspector can list what they still owe

The system SHALL expose, for the requesting account, the scheduled inspections that are assigned to
it and not cancelled, ordered by `period_end` ascending so that the most overdue appears first.
Each entry SHALL carry the site, the period, the template name and the `template_version_id` the
inspection is bound to, and SHALL indicate whether `period_end` is already past. The list SHALL be
restricted to sites in the requesting account's active site scope by the site isolation policy, not
by a filter in the endpoint.

#### Scenario: The list contains only the requester's own inspections

- **GIVEN** two open inspections in the same site, one assigned to inspector A and one to
  inspector B
- **WHEN** inspector A reads their pending inspections
- **THEN** only the inspection assigned to A is listed

#### Scenario: Overdue periods sort first and are flagged

- **GIVEN** an inspection for the previous period and one for the current period, both assigned to
  the same inspector
- **WHEN** that inspector reads their pending inspections
- **THEN** the previous period's inspection is listed first and is flagged as overdue
- **AND** the current period's inspection is not flagged as overdue

#### Scenario: A session with no site scope sees nothing

- **WHEN** the pending list is read in a transaction that declares no site scope
- **THEN** no rows are returned

### Requirement: The HS coordinator is notified when a period is opened

The system SHALL create, for every site where the opening job created at least one scheduled
inspection, one `notification` row per active `hs_coordinator` account whose site scope includes
that site, with `kind` `inspection_period_opened` and a payload naming the period and the
inspections opened. The notification SHALL be delivered in the application; the system SHALL NOT
depend on outbound email. At most one such notification SHALL exist per recipient, site and
period, enforced by the database, so that a repeated job run does not produce a second one. A
recipient SHALL be able to mark a notification as read, and `read_at` SHALL be the only value a
notification ever changes.

#### Scenario: Opening a period notifies the coordinator

- **GIVEN** an active `hs_coordinator` account whose site scope includes St. Thomas
- **WHEN** the opening job creates the St. Thomas inspection for the current period
- **THEN** a `notification` row exists for that account with `kind` `inspection_period_opened`
- **AND** its payload names the period and the inspections opened

#### Scenario: A repeated run does not notify twice

- **WHEN** the opening job runs a second time in the same period
- **THEN** the coordinator still has exactly one `inspection_period_opened` notification for that
  site and period

#### Scenario: A job run that opens nothing notifies nobody

- **GIVEN** every rule of a site already has its inspection for the current period
- **WHEN** the opening job runs
- **THEN** no notification is created for that site

#### Scenario: A notification body cannot be rewritten

- **WHEN** any role attempts to update a notification's `payload`, `kind`, `user_id` or `site_id`
- **THEN** the statement fails
- **AND** setting `read_at` on the same row succeeds

#### Scenario: A coordinator outside the site scope is not notified

- **GIVEN** an active `hs_coordinator` account whose site scope covers only Glencoe
- **WHEN** the opening job creates the St. Thomas inspection for the current period
- **THEN** no notification for St. Thomas is created for that account

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
