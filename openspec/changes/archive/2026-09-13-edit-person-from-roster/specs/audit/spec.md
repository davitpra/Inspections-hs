## MODIFIED Requirements

### Requirement: Roster changes are audited by the database, not by the caller

The system SHALL record an audit entry for every creation, rename, renumbering, transfer,
deactivation and reactivation of a `person`, written by the database as part of the same
transaction as the change itself. A committed roster change with no corresponding audit entry MUST
be an impossible state, and producing the entry SHALL NOT depend on the endpoint or the importer
remembering to write it.

Each entry SHALL carry the `site_id` of the person, an `event_type` naming the operation, and a
`payload` containing the person's identifier and `employee_number` together with the values that
changed. A transfer SHALL be recorded in the chains of both the site left and the site joined,
because each workplace's record must show who its people are. A single change that alters several
of these facts SHALL write one entry per fact.

#### Scenario: Creating a person writes an entry

- **WHEN** a `person` is inserted for a site
- **THEN** an `audit_log` entry exists with that person's `site_id` and an `event_type`
  identifying a roster creation
- **AND** its `payload` contains the person's identifier and `employee_number`

#### Scenario: Renaming a person writes an entry carrying both names

- **WHEN** a `person` row's `last_name` is updated
- **THEN** an `audit_log` entry exists with an `event_type` identifying a rename
- **AND** its `payload` contains both the previous and the new name

#### Scenario: Renumbering a person writes an entry carrying both numbers

- **WHEN** a `person` row's `employee_number` is updated
- **THEN** an `audit_log` entry exists with an `event_type` identifying a renumbering, distinct from
  a rename
- **AND** its `payload` contains both the previous and the new `employee_number`

#### Scenario: Correcting a name and a number at once writes two entries

- **WHEN** a single update changes a `person` row's `first_name` and its `employee_number`
- **THEN** one rename entry and one renumbering entry exist for that update

#### Scenario: A transfer is recorded in both sites

- **WHEN** a person's `site_id` is updated from `st-thomas` to `glencoe`
- **THEN** an `audit_log` entry exists in the chain of `st-thomas` and another in the chain of
  `glencoe`
- **AND** both payloads name the site left and the site joined

#### Scenario: Deactivating and reactivating are distinct events

- **WHEN** `deactivated_at` is set on a `person` row and later set back to null
- **THEN** two further `audit_log` entries exist for that person
- **AND** their `event_type` values distinguish the deactivation from the reactivation

#### Scenario: An import writes one entry per applied row

- **WHEN** an import applies 197 rows, of which 12 create a person and 185 change one
- **THEN** 197 roster audit entries exist for that transaction
- **AND** they carry the `actor_user_id` of the account that ran the import

#### Scenario: A rolled-back roster change leaves no entry

- **WHEN** a transaction changes a person and is then rolled back
- **THEN** no `audit_log` entry for that change exists
