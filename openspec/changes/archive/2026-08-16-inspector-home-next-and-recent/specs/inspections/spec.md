## ADDED Requirements

### Requirement: A listed scheduled inspection carries when it was completed

The system SHALL accompany every listed scheduled inspection with `inspection_id` and
`completed_at`, both null while no submission exists for that period and both populated once
one does.

`completed_at` SHALL be the submission's `signed_at` — the moment the inspector signed the
walk — and SHALL NOT be the moment the server received it. The two differ by however long the
device stayed offline, and the month a record belongs to is what identifies the obligation to
a regulator: an inspection walked and signed on the last day of a month SHALL be dated in that
month even when it is transmitted in the next one.

This is required because a reader can already tell **that** a period was completed, from the
derived status, but cannot date the record without it, and a list of completed inspections
that cannot say when each was closed is not evidence of anything.

#### Scenario: A completed period carries its signing date

- **GIVEN** a scheduled inspection for `2027-07-01` whose submission was signed on
  `2027-07-29` and received on `2027-08-02`
- **WHEN** the scheduled inspections are listed
- **THEN** the entry's `status` is `completed`
- **AND** its `completed_at` is `2027-07-29`
- **AND** its `inspection_id` is the id of that submission

#### Scenario: A period with no submission carries neither

- **GIVEN** a scheduled inspection for `2027-09-01` with no submission
- **WHEN** the scheduled inspections are listed
- **THEN** the entry's `completed_at` is null
- **AND** its `inspection_id` is null

#### Scenario: A cancelled period is not dated

- **GIVEN** a scheduled inspection that was cancelled before any submission
- **WHEN** the scheduled inspections are listed
- **THEN** the entry's `status` is `cancelled`
- **AND** its `completed_at` is null

### Requirement: The inspector's home names the assignment that comes next

The system SHALL present, on the screen an inspector opens the application to, the earliest
assignment that is neither overdue nor the month in progress, identified by its month, its
site, the inspector it is assigned to, and when it becomes available to start.

When no such assignment exists the system SHALL present nothing in its place rather than an
empty frame: most months only the period in progress is open, because periods are opened one
at a time, and a permanently empty card would read as something failing to load.

The screen SHALL NOT present a calendar of the remaining months of the year. The assignment
that matters now is presented on its own, and the months behind it are reached as each is
resolved.

#### Scenario: A month scheduled ahead is named before it opens

- **GIVEN** an inspector whose current month is assigned
- **AND** a further assignment for the following month at the same site
- **WHEN** the inspector opens the home screen
- **THEN** the next assignment is presented with that month, that site, the inspector's own
  name, and the day it opens

#### Scenario: Nothing is scheduled beyond the current month

- **GIVEN** an inspector with an assignment for the month in progress and no later one
- **WHEN** the inspector opens the home screen
- **THEN** no next assignment is presented

#### Scenario: An overdue month is not offered as what comes next

- **GIVEN** an inspector with an overdue assignment and one scheduled for a later month
- **WHEN** the inspector opens the home screen
- **THEN** the overdue assignment is the one presented as the current obligation
- **AND** the later month is the one presented as what comes next

### Requirement: An inspector can read back what they have completed

The system SHALL present to an inspector the scheduled inspections assigned to that account
whose period was completed, each identified by its month, its site and the date it was
completed, ordered most recent first.

The home screen SHALL present the most recent of these and a way to reach the whole list; a
separate screen SHALL present all of them.

This list SHALL be derived from the same definition of completion the scheduled inspections
listing already applies, so that a period cannot appear as completed on one screen and not on
the other.

#### Scenario: Completed months are listed newest first

- **GIVEN** an inspector who completed the inspections for `2027-05`, `2027-06` and `2027-07`
- **WHEN** the inspector views their completed inspections
- **THEN** the three are listed in the order `2027-07`, `2027-06`, `2027-05`
- **AND** each carries the date it was completed

#### Scenario: Another inspector's completed months are not listed

- **GIVEN** a site where two inspectors each completed inspections
- **WHEN** one of them views their completed inspections
- **THEN** only the inspections assigned to that account are listed

#### Scenario: An outstanding month is not listed as completed

- **GIVEN** an inspector with an overdue assignment and no submission for it
- **WHEN** the inspector views their completed inspections
- **THEN** that month is not listed
