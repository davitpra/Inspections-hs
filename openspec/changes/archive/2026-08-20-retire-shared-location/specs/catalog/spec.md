## ADDED Requirements

### Requirement: The HS coordinator can retire a shared organization location

The system SHALL allow only an HS coordinator to retire an active
`organization_location` by setting its `deactivated_at` timestamp. The operation SHALL accept
only the deactivation command and SHALL never delete the row or provide reactivation through the
console operation.

#### Scenario: A coordinator retires an active shared location

- **WHEN** an HS coordinator submits the deactivation command for an active
  `organization_location`
- **THEN** the system sets that row's `deactivated_at` to a non-null timestamp
- **AND** the `organization_location` row remains stored

#### Scenario: A supervisor cannot retire a shared location

- **WHEN** a `supervisor` submits the deactivation command for an active `organization_location`
- **THEN** the request is refused with HTTP 403
- **AND** the `organization_location.deactivated_at` value is unchanged

#### Scenario: Retiring an already retired shared location is not idempotent

- **WHEN** an HS coordinator submits the deactivation command for an
  `organization_location` whose `deactivated_at` is already non-null
- **THEN** the system refuses the request with HTTP 404
- **AND** the existing `deactivated_at` value is unchanged

### Requirement: Retiring a shared location retires its in-scope physical locations

The system SHALL, in the same transaction as retiring an `organization_location`, set
`location.deactivated_at` for every active physical `location` row with that
`organization_location_id` visible in the requester's site scope. The operation SHALL be atomic
for the shared row and the physical rows.

#### Scenario: A two-site coordinator retires both physical mappings

- **GIVEN** an active `organization_location` mapped by active physical `location` rows in St.
  Thomas and Glencoe
- **WHEN** an HS coordinator whose scope covers both sites retires the `organization_location`
- **THEN** the shared row and both physical `location` rows have non-null `deactivated_at`
- **AND** the shared location is absent from active organization-location reads
- **AND** both physical locations are absent from active location reads

#### Scenario: A single-site coordinator retires only visible physical mappings

- **GIVEN** an active `organization_location` mapped by active physical `location` rows in St.
  Thomas and Glencoe
- **AND** an HS coordinator whose scope covers St. Thomas only retires the
  `organization_location`
- **THEN** the shared row is deactivated for the organization
- **AND** the St. Thomas physical `location` is deactivated
- **AND** the Glencoe physical `location` remains active and is visible as an orphan to an
  appropriately scoped catalogue read

#### Scenario: A failed physical update does not leave a partial retirement

- **WHEN** the physical-location cascade cannot complete after the shared row update starts
- **THEN** the transaction rolls back
- **AND** the `organization_location.deactivated_at` value remains null
- **AND** no affected `location.deactivated_at` value is changed

### Requirement: The console warns about unresolved future sections and preserves history

The Locations console SHALL require explicit confirmation before retiring a shared
`organization_location`. The confirmation SHALL state that template sections naming the shared
location will resolve to no location for future findings, and SHALL state that already registered
findings continue resolving their existing physical `location` reference. The console SHALL offer
the action only on shared-location rows, not on orphaned physical-location rows.

#### Scenario: The coordinator confirms the risk before retirement

- **WHEN** the coordinator opens the action for a shared location
- **THEN** the confirmation names the future template-section failure and the preservation of
  already registered findings
- **AND** the coordinator must choose the explicit retire action before the deactivation command is
  submitted

#### Scenario: Keeping the shared location makes no request

- **WHEN** the coordinator chooses the keep action in the confirmation
- **THEN** no deactivation request is submitted
- **AND** the dialog closes without changing the catalogue

#### Scenario: Orphaned physical rows have no retirement action

- **WHEN** an orphaned physical `location` is displayed
- **THEN** the row has no retirement action in the Locations table
