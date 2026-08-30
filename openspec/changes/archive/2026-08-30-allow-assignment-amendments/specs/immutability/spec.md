## ADDED Requirements

### Requirement: Corrective action commitment amendments are immutable

The system SHALL store each correction of `assignee_person_id`, `description` and `due_at` as a new
`corrective_action_commitment_amendment` row. The application role SHALL have `SELECT` and `INSERT`
but SHALL NOT have `UPDATE`, `DELETE` or `TRUNCATE`. A guard trigger SHALL refuse those mutations
for every role including the table owner. The system SHALL isolate amendments by `site_id` through
row level security and SHALL include every insertion in the site's audit chain.

#### Scenario: An amendment cannot be rewritten

- **GIVEN** a `corrective_action_commitment_amendment` has committed
- **WHEN** an application or owner connection attempts to update, delete or truncate it
- **THEN** the database refuses the mutation
- **AND** the recorded commitment remains unchanged

#### Scenario: An amendment is site isolated and audited

- **GIVEN** an amendment belongs to Glencoe
- **WHEN** a session scoped only to St. Thomas reads amendments
- **THEN** the Glencoe row is not visible
- **AND** its insertion remains represented in the Glencoe audit chain
