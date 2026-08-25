## ADDED Requirements

### Requirement: Deactivated inspection requirements can be archived without changing obligations

The system SHALL allow an `hs_coordinator` to archive an inspection requirement only when its `deactivated_at` is non-null. Archiving SHALL set `archived_at`, SHALL NOT delete the `inspection_schedule` row, and SHALL NOT change the periods the rule produced or the months it historically owed. An attempt to archive an active requirement SHALL be refused with a stated reason.

#### Scenario: A deactivated requirement is archived
- **GIVEN** an inspection requirement whose `deactivated_at` is non-null and whose `archived_at` is null
- **WHEN** an `hs_coordinator` archives the requirement
- **THEN** its `archived_at` is set
- **AND** its `deactivated_at` and existing scheduled inspections are unchanged

#### Scenario: An active requirement cannot be archived
- **GIVEN** an inspection requirement whose `deactivated_at` is null
- **WHEN** an `hs_coordinator` attempts to archive it
- **THEN** the request is refused with a stated reason
- **AND** its `archived_at` remains null

#### Scenario: Archiving does not rewrite the annual schedule
- **GIVEN** a deactivated requirement that historically owed periods in the selected year
- **WHEN** the requirement is archived
- **THEN** those periods remain in the annual schedule projection
- **AND** existing scheduled inspections remain visible

### Requirement: Archived inspection requirements are hidden by default and can be restored

The scheduling surface SHALL omit requirements whose `archived_at` is non-null from the default requirements table. It SHALL offer an `hs_coordinator` a control to show archived requirements, identify them as `Archived`, and restore one when no other non-archived requirement exists for the same `site_id` and `template_id`. Restoration SHALL clear `archived_at` while leaving `deactivated_at` non-null. Accounts without scheduling administration permission SHALL NOT receive archive or restore controls.

#### Scenario: Archived requirements are hidden by default
- **GIVEN** the selected site has one current requirement and one requirement whose `archived_at` is non-null
- **WHEN** the scheduling surface opens
- **THEN** the current requirement is shown
- **AND** the archived requirement is omitted

#### Scenario: A coordinator shows and restores an archived requirement
- **GIVEN** an archived requirement with no other non-archived requirement for the same `site_id` and `template_id`
- **WHEN** an `hs_coordinator` shows archived requirements and restores it
- **THEN** its `archived_at` is cleared
- **AND** its `deactivated_at` remains non-null
- **AND** it returns to the default table as `Deactivated`

#### Scenario: A superseded archived requirement cannot be restored
- **GIVEN** an archived requirement and another non-archived requirement with the same `site_id` and `template_id`
- **WHEN** an `hs_coordinator` attempts to restore the archived requirement
- **THEN** the request is refused with a stated reason
- **AND** its `archived_at` remains set

#### Scenario: A reader cannot archive or restore requirements
- **WHEN** an account without scheduling administration permission shows the requirements table
- **THEN** the table does not offer archive or restore controls
