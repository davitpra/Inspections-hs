## Purpose

Defines the obligation to inspect and its fulfilment: which site owes which inspection for which
monthly period, against which published template version and by whom, and what happens when the
inspector submits it. It guarantees that the template version an inspection was opened against is
frozen at scheduling time and cannot be moved by a later publication, that a period is opened
exactly once per site and template no matter how many times the opening job runs, and that every
inspector can see what they still owe. It further guarantees that a submission is recorded exactly
once however many times a device retries it, that a rejected submission leaves no partial state,
and that every answer is stored as its own row keyed by the stable concept the recurrence report
groups by.

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

### Requirement: A submitted inspection freezes what was inspected, by whom, and against which version

The system SHALL store every accepted submission as one row of `inspection` carrying `site_id`,
`scheduled_inspection_id`, `template_version_id`, `client_submission_id`, `submitted_by`,
`signed_at`, `received_at` and `answer_count`. `signed_at` SHALL be the device clock reported in
the payload and `received_at` SHALL be assigned by the engine. `template_version_id` SHALL equal
the `template_version_id` the scheduled inspection is bound to, and the engine SHALL reject any
row where it does not, so that a submission can never be recorded against a version the inspector
was not given.

#### Scenario: An accepted submission records both clocks

- **WHEN** a submission with `signed_at` `2026-08-03T14:20:00-04:00` is accepted on 2026-08-09
- **THEN** the created `inspection` row reports `signed_at` `2026-08-03T14:20:00-04:00`
- **AND** `received_at` is the server time of the accepting transaction, not the device time

#### Scenario: A submission naming another version of the same template is refused

- **GIVEN** a scheduled inspection bound to version `2` of a template, and version `3` published
- **WHEN** a submission for that scheduled inspection is posted with `template_version_id` of
  version `3`
- **THEN** the request is rejected with the code `invalid_submission`
- **AND** no `inspection` row exists for that `client_submission_id`

#### Scenario: The engine refuses a mismatched version even outside the endpoint

- **WHEN** a row is inserted directly into `inspection` whose `template_version_id` differs from
  the `template_version_id` of its `scheduled_inspection_id`
- **THEN** the insert fails with the guard trigger's dedicated SQLSTATE
- **AND** no row is present when read back

### Requirement: A submission is idempotent by client submission id

The system SHALL treat `client_submission_id` as the idempotency key of the whole system.
Re-posting a payload whose `client_submission_id` already exists SHALL return the existing record
with the same HTTP status and the same response shape as the first acceptance, distinguished only
by `created` being `false`, and SHALL NOT create a second `inspection`, write a second set of
answers, or append a second audit entry. Uniqueness SHALL be enforced by a unique index on
`inspection.client_submission_id` rather than by a check performed before the insert, so that two
concurrent posts of the same identifier converge on one row.

#### Scenario: Re-posting the same submission returns the existing record

- **GIVEN** a submission already accepted with `client_submission_id` `C`
- **WHEN** the identical payload is posted again
- **THEN** the response carries the same `id`, `scheduled_inspection_id`, `template_version_id`,
  `submitted_at` and `submitted_by` as the first response
- **AND** `created` is `false`
- **AND** the response status is the one the first acceptance returned, not `409`

#### Scenario: A replay adds no rows and no audit entry

- **GIVEN** a submission already accepted with `client_submission_id` `C` and 40 answers
- **WHEN** the identical payload is posted three more times
- **THEN** exactly one `inspection` row exists with `client_submission_id` `C`
- **AND** exactly 40 rows of `inspection_answer` reference it
- **AND** exactly one `audit_log` entry of type `inspection.submitted` names it

#### Scenario: Two concurrent posts of the same identifier create one record

- **WHEN** two requests carrying the same `client_submission_id` are posted concurrently
- **THEN** both receive a successful response naming the same `inspection.id`
- **AND** exactly one `inspection` row exists for that `client_submission_id`

### Requirement: A scheduled inspection accepts exactly one submission

The system SHALL allow at most one `inspection` per `scheduled_inspection_id`, enforced by a
unique index. A submission carrying a `client_submission_id` that does not exist yet, for a
scheduled inspection that already has one, SHALL be rejected with the code `already_submitted`
rather than accepted as a second record: one owner, one device, one signer. Correcting an accepted
inspection SHALL NOT be done by submitting again.

#### Scenario: A second submission from a different draft is refused

- **GIVEN** a scheduled inspection with an accepted submission for `client_submission_id` `C1`
- **WHEN** a submission for the same `scheduled_inspection_id` is posted with
  `client_submission_id` `C2`
- **THEN** the request is rejected with the code `already_submitted`
- **AND** exactly one `inspection` row exists for that `scheduled_inspection_id`
- **AND** the row is the one created for `C1`

#### Scenario: A cancelled scheduled inspection accepts nothing

- **GIVEN** a scheduled inspection whose `cancelled_at` is set
- **WHEN** a submission for it is posted
- **THEN** the request is rejected with the code `invalid_submission`
- **AND** the message states that the inspection was cancelled

### Requirement: Answers are validated against the frozen template version and a rejection leaves nothing behind

The system SHALL validate the submitted answers against the document of the
`template_version` the scheduled inspection is bound to, using the same shared form engine the
device used, and SHALL reject a submission that produces any violation with the code
`validation_failed` and the full list of violations, each naming its `item_key` and its violation
code. A rejected submission SHALL leave no `inspection` row, no `inspection_answer` row and no
audit entry: the whole ingestion is one transaction that either commits entirely or not at all.

#### Scenario: A missing required answer rejects the whole submission

- **GIVEN** a template version with a required item `dock.guards` and 39 other answered items
- **WHEN** a submission omits `dock.guards`
- **THEN** the response carries the code `validation_failed` and a violation with `item_key`
  `dock.guards` and code `required_missing`
- **AND** no `inspection` row exists for that `client_submission_id`
- **AND** no `inspection_answer` row was written for any of the 39 valid answers

#### Scenario: All violations are reported at once

- **WHEN** a submission has three items with answers of the wrong shape and one required item
  missing
- **THEN** the response lists four violations, not one

#### Scenario: An answer for an item the document does not contain is refused

- **WHEN** a submission carries an answer whose `item_key` is not an item of the bound
  `template_version`
- **THEN** the response carries the code `validation_failed` with a violation of code
  `unknown_item` for that `item_key`

#### Scenario: An answer for an item its own answers hide is refused

- **GIVEN** a template version where `spill.cleanup` is visible only when `spill.present` is `yes`
- **WHEN** a submission answers `spill.present` with `no` and also carries an answer for
  `spill.cleanup`
- **THEN** the response carries a violation of code `answer_for_hidden_item` for `spill.cleanup`

### Requirement: Answers are stored as rows keyed by the stable item key

The system SHALL store one row of `inspection_answer` per answered item, with `inspection_id`,
`site_id`, `template_version_item_id`, `item_key` and `value`. It SHALL NOT store the answer set
as a single document column. `template_version_item_id` SHALL record which published row was
answered — the legal fidelity of §4 — and `item_key` SHALL record the stable concept the
recurrence report groups by. The engine SHALL guarantee that `item_key` is the key of the
referenced `template_version_item` and that the item belongs to the inspection's
`template_version_id`. `item_key` SHALL be indexed so that grouping every answer of a site by
concept does not require reading the answers of every inspection.

#### Scenario: One row per answered item

- **WHEN** a submission with 40 answers is accepted
- **THEN** 40 rows of `inspection_answer` reference the created `inspection`
- **AND** each row carries the `item_key` of the item it answers and the
  `template_version_item_id` of that item within the bound version

#### Scenario: The same item answered in two versions groups under one key

- **GIVEN** two accepted inspections of the same site, one against version `2` and one against
  version `3` of a template, both answering the item whose `item_key` is `dock.guards`
- **WHEN** the answers of that site are grouped by `item_key`
- **THEN** both rows fall in the same group
- **AND** their `template_version_item_id` values differ

#### Scenario: An answer cannot name an item of another version

- **WHEN** a row is inserted into `inspection_answer` whose `template_version_item_id` belongs to
  a `template_version` other than the one of its `inspection`
- **THEN** the insert fails with the guard trigger's dedicated SQLSTATE

#### Scenario: An answer cannot claim an item key that is not the referenced item's

- **WHEN** a row is inserted into `inspection_answer` whose `item_key` is not the `item_key` of
  its `template_version_item_id`
- **THEN** the insert fails with a foreign key violation on the
  `(template_version_item_id, item_key)` pair

#### Scenario: The same item cannot be answered twice in one inspection

- **WHEN** a second `inspection_answer` row is inserted with an `item_key` already present for
  that `inspection_id`
- **THEN** the insert fails with a unique violation

### Requirement: A submission carries object keys, never bytes, and only its own

The system SHALL accept photo and signature answers as object keys of files already uploaded
before the submission, merge the keys reported in `photos` into the answer set under their
`item_key` before validating, and reject any submission whose payload references an object key
outside the prefix derived from its own `site_id` and `scheduled_inspection_id`.

#### Scenario: Uploaded photo keys satisfy a photo item

- **GIVEN** a template version with a photo item `dock.guards.photo` requiring at least one photo
- **WHEN** a submission carries no answer for `dock.guards.photo` but reports one object key for
  it under `photos`
- **THEN** the submission is accepted
- **AND** the stored `inspection_answer` for `dock.guards.photo` carries that object key

#### Scenario: A key belonging to another inspection is refused

- **WHEN** a submission references an object key whose prefix names another
  `scheduled_inspection_id`
- **THEN** the request is rejected with the code `invalid_submission`
- **AND** no `inspection` row is created

#### Scenario: A payload carrying image bytes is refused

- **WHEN** a submission carries a base64 blob in place of an object key for a photo item
- **THEN** the request is rejected before any row is written

### Requirement: Only the assigned inspector submits, and only within their site scope

The system SHALL accept a submission only from the account named as `inspector_id` of the
scheduled inspection, and SHALL record that account as `submitted_by`. A submission for a
scheduled inspection outside the session's site scope SHALL be answered exactly as one for a
scheduled inspection that does not exist, so that the endpoint cannot be used to learn what the
other site is inspecting.

#### Scenario: An account that is not the assigned inspector is refused

- **GIVEN** a scheduled inspection assigned to inspector A
- **WHEN** inspector B of the same site posts a submission for it
- **THEN** the request is rejected with the code `forbidden`
- **AND** no `inspection` row is created

#### Scenario: A scheduled inspection with no inspector accepts nothing

- **GIVEN** a scheduled inspection whose `inspector_id` is `NULL`
- **WHEN** any account posts a submission for it
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: Another site's inspection is indistinguishable from a missing one

- **GIVEN** a scheduled inspection of Glencoe
- **WHEN** an inspector whose scope is only St. Thomas posts a submission for it
- **THEN** the response carries the code `inspection_not_found`
- **AND** the response body reveals nothing about the site, period or template of that inspection

#### Scenario: The submitter is taken from the session, not from the payload

- **WHEN** a submission is accepted
- **THEN** `inspection.submitted_by` is the account of the authenticated session
- **AND** no field of the request payload can set it
