## MODIFIED Requirements

### Requirement: A corrective action freezes its assignment at closure and its records cannot be removed

The system SHALL permit only `assignee_person_id`, `description` and `due_at` to be updated on
`corrective_action`, only while its derived state is not `closed`, and only through an explicit
application-role column grant. A database guard SHALL enforce the allowed columns and state for
every role including the owner. Every other action column and every column of
`corrective_action_event`, `corrective_action_evidence` and `corrective_action_escalation` SHALL
remain immutable. No role SHALL delete or truncate any of those tables.

#### Scenario: The application role replaces active assignment fields
- **GIVEN** a corrective action is not `closed`
- **WHEN** the application role updates `assignee_person_id`, `description` and `due_at`
- **THEN** the update succeeds within its declared site scope

#### Scenario: The engine freezes a closed action
- **GIVEN** a corrective action is `closed`
- **WHEN** any role attempts to update an assignment field
- **THEN** the guard rejects the update and the final values remain unchanged

#### Scenario: An unrelated action column remains immutable
- **WHEN** any role attempts to update `corrective_action.finding_id`
- **THEN** the database rejects the update

#### Scenario: Action records cannot be removed
- **WHEN** any role attempts to delete or truncate an action, event, evidence or escalation table
- **THEN** the database rejects the statement and preserves every row

## REMOVED Requirements

### Requirement: Corrective action commitment amendments are immutable

**Reason**: The amendment table is replaced by guarded updates to the active action assignment.

**Migration**: Consolidate development values and drop the obsolete table, triggers and policies.
