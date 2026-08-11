## REMOVED Requirements

### Requirement: A corrective action belongs to exactly one classified finding

**Reason**: Stage 5 wrote `finding_id NOT NULL` and stated in its own proposal that stage 6 would
add the second parent §4 requires: an action belongs to exactly one parent, which is a `Finding`
**or** an `Investigation`. The requirement is replaced rather than edited because its subject is
no longer the finding but the parent, and because the migration that relaxes `NOT NULL` and adds
the exactly-one check is a **BREAKING** change for any query that assumed a finding was always
there.

**Migration**: Replaced by "A corrective action belongs to exactly one parent, a finding or an
investigation". Existing rows are unaffected: every action written before this change keeps its
`finding_id` and a null `investigation_id`, which satisfies the new check constraint without a
backfill. Any consumer reading `finding_id` must now handle null and read `investigation_id`
instead.

### Requirement: The deadline is derived from the finding's severity and frozen at creation

**Reason**: The severity that produces the deadline no longer always comes from a finding's
classification. An action hanging from an investigation has no finding to read a severity from, so
the requirement's subject changes from "the finding's severity" to "the action's severity, however
it was established".

**Migration**: Replaced by "The deadline is derived from the action's severity and frozen at
creation". The table of severity to days is unchanged and existing `due_at` values are unaffected.

## ADDED Requirements

### Requirement: A corrective action belongs to exactly one parent, a finding or an investigation

The system SHALL store every corrective action as a `corrective_action` row carrying `site_id`,
`assignee_person_id`, `description`, `due_at`, `severity`, `created_by` and exactly one of
`finding_id` and `investigation_id`. A parent MAY have many corrective actions and a corrective
action SHALL belong to exactly one parent, as §4 closed; the exactly-one rule SHALL be a check
constraint in the database and not an application check. The system SHALL refuse to create an
action for a finding that has no current `finding_risk_assessment`, because that finding cannot
yield a severity and an action without a deadline can never be overdue and therefore never
escalates. The action's `site_id` SHALL be the `site_id` of its parent, enforced by the engine
through the composite foreign key of whichever parent it names.

#### Scenario: An action is created for a classified finding

- **WHEN** the HS coordinator creates an action for a finding classified `likely` × `major`, with
  an `assignee_person_id` and a `description`
- **THEN** a `corrective_action` row is created referencing that `finding_id`
- **AND** its `investigation_id` is null
- **AND** its `site_id` is the finding's `site_id`

#### Scenario: An action is created for an investigation

- **WHEN** the HS coordinator creates an action for an investigation, with an
  `assignee_person_id`, a `description` and a `severity`
- **THEN** a `corrective_action` row is created referencing that `investigation_id`
- **AND** its `finding_id` is null
- **AND** its `site_id` is the investigation's `site_id`

#### Scenario: An unclassified finding cannot receive an action

- **GIVEN** a derived finding with no `finding_risk_assessment` row
- **WHEN** an action is created for it
- **THEN** the request is rejected with the code `finding_not_classified`
- **AND** no `corrective_action` row is created

#### Scenario: An action with no parent is refused

- **WHEN** a `corrective_action` row is inserted with both `finding_id` and `investigation_id` null
- **THEN** the insert fails on the check constraint

#### Scenario: An action with two parents is refused

- **WHEN** a `corrective_action` row is inserted carrying both a `finding_id` and an
  `investigation_id`
- **THEN** the insert fails on the check constraint

#### Scenario: One parent carries several actions

- **WHEN** three actions are created for the same finding
- **THEN** three `corrective_action` rows reference that `finding_id`
- **AND** each carries its own `assignee_person_id` and its own `due_at`

#### Scenario: An action cannot name a site other than its parent's

- **WHEN** a `corrective_action` row is inserted whose `site_id` differs from the `site_id` of the
  parent it names
- **THEN** the insert fails on that parent's composite foreign key

#### Scenario: Actions written before the second parent existed remain valid

- **GIVEN** corrective actions created before this change, all carrying a `finding_id`
- **WHEN** the exactly-one check constraint is added
- **THEN** every existing row satisfies it and none is rewritten

#### Scenario: A description of two characters is refused

- **WHEN** an action is created with the `description` `fix`
- **THEN** the request is rejected and no `corrective_action` row is created

### Requirement: The deadline is derived from the action's severity and frozen at creation

The system SHALL compute `due_at` from the action's `severity` through a fixed table:
`catastrophic` 3 days, `major` 7 days, `moderate` 14 days, `minor` 30 days, `negligible` 60 days.
When the parent is a finding, the system SHALL take that `severity` from the finding's current
classification at the moment the action is created and SHALL ignore any severity the caller
supplies, deriving it from `severity` and NOT from `risk_level` as §3 R2 states. When the parent
is an investigation, there is no classification to read, so the system SHALL require the HS
coordinator to state the `severity` and SHALL refuse the creation without it. The system SHALL
ignore any `due_at` a caller supplies in either case, and SHALL store on the action the `severity`
the deadline was derived from, so the record states what was promised and why. Reclassifying the
finding afterwards SHALL NOT move the `due_at` of an action that already exists; a shorter
deadline is obtained by opening a new action. The table is configuration written in code, not an
authoritative legal rule.

#### Scenario: A major finding gets seven days

- **GIVEN** a finding whose current classification carries `severity` `major`
- **WHEN** an action is created for it on `2026-08-10T09:00:00-04:00`
- **THEN** its `due_at` is `2026-08-17T09:00:00-04:00`
- **AND** its `severity` is `major`

#### Scenario: An action of an investigation takes the severity the coordinator states

- **WHEN** the coordinator creates an action for an investigation stating `severity` `moderate` on
  `2026-08-10T09:00:00-04:00`
- **THEN** its `due_at` is `2026-08-24T09:00:00-04:00`
- **AND** its `severity` is `moderate`

#### Scenario: An action of an investigation without a severity is refused

- **WHEN** an action is created for an investigation with no `severity`
- **THEN** the request is rejected with the code `severity_required`

#### Scenario: A severity supplied for a finding's action is ignored

- **WHEN** an action is created for a `moderate` finding claiming `severity` `negligible`
- **THEN** the stored `severity` is `moderate` and the deadline is 14 days out

#### Scenario: The stored deadline is the table's, not the caller's

- **WHEN** an action is created for a `catastrophic` finding claiming a `due_at` ninety days away
- **THEN** the stored `due_at` is three days from creation

#### Scenario: All five severities are covered

- **WHEN** the deadline is computed for each of the five severities from the same instant
- **THEN** the results are 3, 7, 14, 30 and 60 days respectively

#### Scenario: Reclassifying does not move an open action's deadline

- **GIVEN** an action created from a `moderate` classification, with a `due_at` 14 days out
- **WHEN** the coordinator reclassifies the finding as `catastrophic`
- **THEN** the existing action's `due_at` is unchanged
- **AND** its `severity` is still `moderate`
