## ADDED Requirements

### Requirement: Closed findings present the evidence accepted by verification

The system SHALL present, for each closed corrective action, the `before` and `after`
photographs attached to the last work-completion declaration before the transition to `closed`.
The system SHALL NOT present photographs attached to a work-completion declaration that was later
sent back to `in_progress`. The Closed record SHALL remain readable when the accepted declaration
contains no photographs.

#### Scenario: Closed presents the accepted photographs

- **WHEN** an action reaches `closed` after a completion declaration containing `before` and `after` evidence
- **THEN** the Closed record presents those photographs grouped by `kind`

#### Scenario: Rejected photographs are excluded

- **WHEN** an earlier completion declaration was sent back to `in_progress` and a later declaration was accepted
- **THEN** the Closed record presents only the evidence from the later accepted declaration

#### Scenario: Closure without photographs remains readable

- **WHEN** the accepted completion declaration has an empty `evidence` array
- **THEN** the Closed record presents the corrective action without claiming that the stage was not recorded
