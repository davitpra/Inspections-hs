## ADDED Requirements

### Requirement: Recorded action evidence can be read within site scope

The system SHALL issue a short-lived download URL for a recorded corrective-action evidence item
only when that evidence row is visible within the authenticated reader's current site scope. The
system SHALL NOT accept an object key from the reader to choose the object being signed.

#### Scenario: In-scope evidence receives a download URL

- **WHEN** an authenticated reader requests a download URL for an evidence `id` visible in their site scope
- **THEN** the system returns a short-lived URL for that evidence row's `object_key`

#### Scenario: Out-of-scope evidence reveals no object

- **WHEN** an authenticated reader requests a download URL for an evidence `id` outside their site scope
- **THEN** the request is rejected without returning an `object_key` or download URL
