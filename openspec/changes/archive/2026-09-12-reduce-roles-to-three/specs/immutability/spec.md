## MODIFIED Requirements

### Requirement: The incident adds a visibility restriction on top of site isolation, never in place of it

The system SHALL apply to `incident` and its related tables a row level security policy that
restricts reading to the transaction's own account when it is the row's `reported_by`, and to
transactions whose declared role is `hs_coordinator` or `management`. That policy SHALL be
composed with the site isolation policy so that both must hold — a coordinator still sees only the
sites in scope, and a non-administrative account still sees only its own incidents within those
sites. The restriction SHALL depend on session variables set on the connection and SHALL NOT be a
`WHERE` clause written in an endpoint, so that a query issued directly inside the transaction is
subject to it too.

The policy SHALL keep both of its branches even though the only role now restricted by the
`reported_by` branch is `jhsc_member`, and even though a `jhsc_member` cannot report an incident:
the branch is what makes the administrative exception explicit in the engine rather than implied by
the absence of other roles, and it is the barrier that a future reporting role would inherit
without a policy change.

#### Scenario: Both policies must hold

- **GIVEN** a `jhsc_member` of St. Thomas whose transaction declares that role and scope
- **WHEN** their transaction selects from `incident`
- **THEN** no incident is returned, neither a St. Thomas one filed by somebody else nor any
  Glencoe row

#### Scenario: A coordinator is still bound by site

- **GIVEN** a transaction whose declared role is `hs_coordinator` and whose scope is St. Thomas
- **WHEN** it selects from `incident`
- **THEN** every St. Thomas incident is returned and no Glencoe incident is

#### Scenario: Management reads its scope like the coordinator

- **GIVEN** a transaction whose declared role is `management` and whose scope is St. Thomas
- **WHEN** it selects from `incident`
- **THEN** every St. Thomas incident is returned, whoever filed it

#### Scenario: A transaction that declares no role sees no incident

- **WHEN** a transaction sets a site scope but no role and no acting account, and selects from
  `incident`
- **THEN** no row is returned, even though rows of that site exist

#### Scenario: The restriction survives a direct query

- **WHEN** a raw `SELECT * FROM incident` is issued inside a `jhsc_member` transaction
- **THEN** the rows they may not see are absent from the result of that statement

#### Scenario: A write outside the visibility rule is rejected

- **WHEN** a transaction inserts an `incident` whose `reported_by` is an account other than the
  one it declared
- **THEN** the insert is rejected by the policy's check
