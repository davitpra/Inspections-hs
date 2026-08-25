## ADDED Requirements

### Requirement: The H&S coordinator can import the roster over HTTP

The system SHALL let an account whose `role` is `hs_coordinator` import a roster CSV over HTTP by
submitting exactly one file in the multipart field `file`, and SHALL apply it through the same
importer as the server command: the same header columns, the same per-row validation, the same
upsert by `employee_number`, and the same single transaction that writes the import record together
with the rows it applied.

The sites the import may write SHALL come from the session's scope resolved at that request, and
the account recorded as having run the import SHALL be the session's account. The request SHALL
NOT be able to name the scope it runs under, and a row naming a `site_code` outside that scope
SHALL be rejected with the same reason as a `site_code` that matches no site, so that the response
does not disclose the existence of a site the account does not administer.

Any other `role` SHALL be refused, and the refusal SHALL leave no `person` row and no import record
behind.

The system SHALL reject with `roster_file_unusable` a submission that carries no `file`, more than
one `file`, an unexpected multipart field or an unusable file name. The system SHALL reject with
`roster_file_too_large` a file larger than 2 MiB, and SHALL apply nothing in those cases.

#### Scenario: The coordinator imports a file from the console

- **WHEN** an account whose `role` is `hs_coordinator` and whose scope contains `st-thomas`
  submits a CSV whose rows all name `site_code` `st-thomas`
- **THEN** every row is applied to the roster of `st-thomas`
- **AND** the response reports the counts of rows read, applied and rejected
- **AND** an import record exists naming that account and the submitted file name

#### Scenario: A row outside the session's scope is rejected, not applied

- **WHEN** a coordinator whose scope is `st-thomas` only submits a file containing rows for
  `st-thomas` and rows for `glencoe`
- **THEN** the rows for `st-thomas` are applied
- **AND** the rows for `glencoe` are rejected, each with its row number
- **AND** the reason given does not distinguish a site outside the scope from a site that does not
  exist

#### Scenario: The request cannot widen its own scope

- **WHEN** a coordinator whose scope is `st-thomas` only submits a file together with a site or a
  scope named in the request
- **THEN** the named scope is ignored
- **AND** no `person` of `glencoe` is created or changed

#### Scenario: Any other role is refused

- **WHEN** an account whose `role` is `supervisor`, `jhsc_member`, `management` or
  `external_auditor` submits a roster CSV
- **THEN** the request is refused
- **AND** no `person` row is created or changed and no import record is written

#### Scenario: A submission without a file is refused

- **WHEN** a coordinator submits a request that carries no file
- **THEN** the request is refused with `roster_file_unusable`
- **AND** no import record is written

#### Scenario: A submission with more than one file is refused

- **WHEN** a coordinator submits more than one `file` or submits a file in another multipart field
- **THEN** the request is refused with `roster_file_unusable`
- **AND** no `person` row is created or changed and no import record is written

#### Scenario: A file above the accepted maximum is refused

- **WHEN** a coordinator submits a file larger than the accepted maximum size
- **THEN** the request is refused with `roster_file_too_large`
- **AND** no row of it is applied

#### Scenario: An employee number outside the scope does not abort the file

- **WHEN** a coordinator whose scope is `st-thomas` submits a row for `st-thomas` whose
  `employee_number` already belongs to a person of `glencoe`
- **THEN** that row is rejected without disclosing the site of the existing person
- **AND** the other valid rows are applied in the same import
- **AND** the person of `glencoe` is not changed

### Requirement: Rejected rows are a result, not a failed request

The system SHALL answer an import that could be read as a success carrying the report, however many
rows it rejected: rejected rows are the expected outcome of a real payroll export and SHALL NOT
turn the response into an error. The report SHALL carry the number of rows read, applied and
rejected, and one entry per rejected row with its 1-based row number in the file and its reason.

The system SHALL answer with `roster_file_unusable`, applying nothing, when the submission cannot
be read as a roster file at all: its CSV syntax is invalid or its header omits a required column.
The response SHALL name what made the file unusable.

#### Scenario: A file with some bad rows is a success

- **WHEN** a coordinator submits a file of 200 rows of which 3 are rejected
- **THEN** the response is a success
- **AND** it reports 200 read, 197 applied and 3 rejected, with the row number and reason of each
  rejected row

#### Scenario: A file whose every row is rejected is still a success

- **WHEN** a coordinator submits a readable file whose every row is rejected
- **THEN** the response is a success reporting zero rows applied and one entry per rejected row
- **AND** an import record exists carrying those counts

#### Scenario: An unreadable file is an error and applies nothing

- **WHEN** a coordinator submits a file whose header omits `employee_number`, or a file that is not
  CSV at all
- **THEN** the response is an error with `roster_file_unusable` naming what made the file unusable
- **AND** no `person` row is created or changed and no import record is written

#### Scenario: The report is the same report the server command produces

- **WHEN** the same file is imported over HTTP and by the server command under the same scope
- **THEN** both report the same counts of rows read, applied and rejected
- **AND** both list the same rejected rows with the same row numbers and reasons

## MODIFIED Requirements

### Requirement: The roster of a site is readable by the H&S coordinator

The system SHALL expose the roster of one site as a list of `person` rows carrying `id`,
`site_id`, `employee_number`, `first_name`, `last_name` and `deactivated_at`, ordered by
`last_name` then `first_name`. The site SHALL be named by the request, and the rows returned
SHALL be limited to the sites of the session's scope by the row-level security policy on
`person`, never by a filter written into the endpoint.

Each row SHALL also carry the account that references that person, or `null` when no
`app_user` row does. The account SHALL be reduced to what tells the coordinator whether this
person can reach the system, as what and through which work address: its `id`, its `role`,
whether it is active, whether it can already sign in and its `email`. It SHALL NOT carry the
account's scope, credential or any invitation token; reading the roster SHALL NOT become a
way to read the account table.

The listing SHALL be available only to an account whose `role` is `hs_coordinator`, and SHALL
be able to include people whose `deactivated_at` is non-null, which is what distinguishes it
from the subject selection list.

The system SHALL NOT expose any way to create, modify or delete a single `person` through
this listing or any companion route: the roster is maintained by the CSV import, and reading
it SHALL NOT become a way to edit it row by row. Loading the file itself SHALL remain
available, as a separate act that names no person and applies the whole file at once.

#### Scenario: The coordinator reads the roster of a site in scope

- **WHEN** an account whose `role` is `hs_coordinator` and whose scope contains `st-thomas`
  requests the roster of `st-thomas`
- **THEN** every `person` whose `site_id` is `st-thomas` is returned, ordered by `last_name`
  then `first_name`
- **AND** each row carries `employee_number`, `first_name`, `last_name` and `deactivated_at`

#### Scenario: Each site is read separately

- **WHEN** the same coordinator requests the roster of `glencoe`
- **THEN** the people of `glencoe` are returned
- **AND** no `person` whose `site_id` is `st-thomas` appears in the result

#### Scenario: A site outside the scope returns nothing, not an error

- **WHEN** a coordinator whose scope is `st-thomas` only requests the roster of `glencoe`
- **THEN** the result is an empty list and no error is raised
- **AND** no `person` of `glencoe` is disclosed, not even their `employee_number`

#### Scenario: Any other role is refused

- **WHEN** an account whose `role` is `supervisor`, `jhsc_member`, `management` or
  `external_auditor` requests the roster of a site within its own scope
- **THEN** the request is refused
- **AND** no `person` row is returned

#### Scenario: Deactivated people can be listed, and are marked

- **WHEN** the coordinator requests the roster of a site including inactive people
- **THEN** the result contains the people whose `deactivated_at` is non-null, carrying that
  value
- **AND** requesting only the active people excludes them

#### Scenario: Listing a deactivated person does not return them to any selector

- **WHEN** a deactivated person appears in the roster listing
- **THEN** the subject selection list for their site still does not offer them

#### Scenario: A person who holds an account is returned with its role

- **WHEN** the roster of `st-thomas` is read
- **AND** one of its people is referenced by an `app_user` row whose `role` is `jhsc_member`
- **THEN** that row carries an account whose `role` is `jhsc_member`

#### Scenario: A person without an account is returned with none

- **WHEN** the roster of `st-thomas` is read
- **AND** one of its people is referenced by no `app_user` row
- **THEN** that row carries a null account
- **AND** no error is raised

#### Scenario: The roster carries the work email but not account security data

- **WHEN** the roster of a site is read
- **THEN** an account in the result carries its `email`
- **AND** no account carries a site scope, a credential or an invitation token

#### Scenario: An account that cannot yet sign in is distinguishable from one that can

- **WHEN** the roster is read after an account has been created for a person and before its
  invitation has been accepted
- **THEN** that account is reported as unable to sign in
- **AND** once the invitation is accepted, the same account is reported as able to sign in

#### Scenario: The listing offers no way to write a single person

- **WHEN** the roster of a site is read
- **THEN** no route accepts the `id` of one `person` to create, rename, move or deactivate
  them
- **AND** the only write available over the roster is the import of a whole CSV file

### Requirement: The roster is loaded from a CSV file, never synchronised

The system SHALL provide a roster import that reads a UTF-8 CSV file with a mandatory header row
and the columns `employee_number`, `first_name`, `last_name`, `site_code` and `status`. The import
SHALL be operator-initiated: it SHALL run only when an operator submits a file, whether from a
server command or from the console, and SHALL NOT run on a schedule. The system SHALL NOT connect
to, poll or receive data from any payroll system.

A row whose `employee_number` is not yet known SHALL create a person. A row whose
`employee_number` is known SHALL update that person's `first_name`, `last_name`, `site_id` and
active status, and SHALL NOT create a second person.

#### Scenario: A new employee number creates a person

- **WHEN** a file containing a row with an `employee_number` that matches no `person` is imported
- **THEN** a `person` row is created with the file's `first_name`, `last_name` and the site named
  by `site_code`

#### Scenario: A known employee number updates the existing person

- **WHEN** a file containing a row whose `employee_number` matches an existing `person` is
  imported with a different `last_name`
- **THEN** that person's `last_name` is updated
- **AND** no second `person` row with that `employee_number` exists
- **AND** every record already referencing that person still resolves to them

#### Scenario: A file with a different column order is accepted

- **WHEN** a file whose header names the five required columns in a different order is imported
- **THEN** the columns are matched by header name and the import proceeds

#### Scenario: A file missing a required column is rejected as a whole

- **WHEN** a file whose header omits `employee_number` is imported
- **THEN** no `person` row is created or changed
- **AND** the import reports the missing column as the reason it could not run

#### Scenario: No payroll connection exists

- **WHEN** the deployed system is inspected for outbound integrations
- **THEN** no scheduled job, client or credential targets a payroll system

#### Scenario: No import runs without a file somebody submitted

- **WHEN** the deployed system is inspected for scheduled work
- **THEN** no job imports the roster on its own
- **AND** every import record corresponds to a file an operator submitted
