## ADDED Requirements

### Requirement: A finding is read with the display name of its location

The system SHALL accompany every finding it returns with `location_name`, the name of the
location identified by its `location_id`, resolved at read time from the catalogue of the
finding's own site.

`location_name` SHALL NOT be accepted in any request. It is a projection of the catalogue and
not a property of the finding: a finding records **which** location, and the name is whatever
the catalogue calls that location when it is read.

A location that has been deactivated since the finding was recorded SHALL still be named. A
finding is an immutable record of something seen somewhere, and withholding the name of a
retired location would make the older record less legible than the newer one — which is the
opposite of what a record kept for a regulator is for.

This is required because the location is the one field of a finding that answers *where*, and
there is no endpoint that publishes the location catalogue on its own. Without the name, every
reader of a finding is handed an identifier it has no way to resolve.

#### Scenario: A finding names its location

- **GIVEN** a finding recorded at a location named `Welding bay 2`
- **WHEN** the finding is read
- **THEN** its `location_id` is the identifier of that location
- **AND** its `location_name` is `Welding bay 2`

#### Scenario: A deactivated location is still named

- **GIVEN** a finding recorded at a location that was later deactivated
- **WHEN** the finding is read
- **THEN** its `location_name` is the name of that location

#### Scenario: The name cannot be written

- **WHEN** a request to record or classify a finding carries a `location_name` field
- **THEN** the request is rejected as invalid

### Requirement: Findings are presented with the unclassified ones first

The system SHALL present the list of findings ordered by what is waiting: findings with no
current classification before findings that have one, then by `risk_level` from `critical` down
to `low`, and within each group the most recently recorded first.

The system SHALL offer that same list restricted to the unclassified findings, and SHALL apply
that restriction by default.

The system SHALL NOT hide a classified finding permanently. The restriction is a default and
not the only view: a reader who wants to see what a site has already classified SHALL be able
to.

This is required because a finding derived from an accepted submission is born unclassified and
nothing else in the system announces it. A list that opens on everything, in the order it was
recorded, answers "what happened" when the question the screen exists for is "what is waiting
for me".

#### Scenario: The unclassified are what the screen opens on

- **GIVEN** four findings within the reader's site scope, two of them classified
- **WHEN** the reader opens the findings list
- **THEN** the two unclassified findings are presented
- **AND** the two classified ones are not

#### Scenario: The classified findings can be seen

- **WHEN** the reader asks for all findings
- **THEN** the four are presented
- **AND** the two unclassified ones are presented before the two classified ones

#### Scenario: Severity of risk orders what is already classified

- **GIVEN** three classified findings whose `risk_level` is `low`, `critical` and `high`
- **WHEN** all findings are presented
- **THEN** they are presented in the order `critical`, `high`, `low`

### Requirement: The risk level of a classification is shown before it is recorded

The system SHALL present, while a probability and a severity are being chosen, the `risk_level`
that the pair produces, and SHALL do so before the classification is submitted.

That presented level SHALL NOT be sent in the request, and the level that is recorded SHALL
remain the one the engine computes from the submitted `probability` and `severity`. The
presented level is an aid to the person choosing and never a value the client supplies.

This is required because the matrix is the whole judgement being made: a coordinator picking
`likely` and `major` is deciding that this is a critical risk, and a screen that reveals the
consequence only after it has been recorded in an append-only chain forces a reclassification to
correct a choice that was never shown.

#### Scenario: The consequence of the pair is visible while choosing

- **WHEN** `likely` and `major` are chosen
- **THEN** the risk level presented is `critical`

#### Scenario: Changing either side updates what is shown

- **GIVEN** `likely` and `major` are chosen
- **WHEN** the probability is changed to `unlikely`
- **THEN** the risk level presented is `medium`

#### Scenario: The shown level is not what is sent

- **WHEN** a classification is submitted
- **THEN** the request carries `probability`, `severity` and `control_level`
- **AND** the request carries no `risk_level`
- **AND** the `risk_level` of the recorded classification is the one the engine computed

### Requirement: Reclassifying is offered as a replacement that states its reason

The system SHALL present the current classification of a finding before offering to classify it
again, and SHALL require the `reason` whenever one exists.

The system SHALL NOT require a reason for the first classification of a finding, and SHALL NOT
offer to supply one.

When a classification cannot be recorded because another has superseded the one that was
current, the system SHALL report that the finding was classified by someone else and SHALL
present the classification that is now current, rather than reporting a failure the reader
cannot act on.

This is required because reclassifying is not editing: the previous judgement stays in the
record and the reason is what makes the pair readable months later. A screen that asks for the
reason without showing what is being replaced asks for a justification of something invisible.

#### Scenario: The first classification asks for no reason

- **GIVEN** a finding with no classification
- **WHEN** the classification form is presented
- **THEN** no reason is asked for
- **AND** the classification can be submitted with `probability`, `severity` and `control_level`

#### Scenario: Replacing a classification requires the reason

- **GIVEN** a finding whose current classification is `possible` / `moderate`
- **WHEN** the classification form is presented
- **THEN** the current classification is presented with its `risk_level` and `control_level`
- **AND** a reason is required
- **AND** the classification cannot be submitted while the reason is shorter than ten characters

#### Scenario: A concurrent reclassification is reported as one

- **GIVEN** a finding whose current classification has been superseded since it was read
- **WHEN** a classification is submitted against the superseded one
- **THEN** the response is `already_reclassified`
- **AND** the reader is told the finding was classified by someone else
- **AND** the classification that is now current is presented

### Requirement: Only the HS coordinator is offered the classification form

The system SHALL offer the classification form only to the HS coordinator, and SHALL tell any
other reader that classifying is the coordinator's.

The system SHALL NOT restrict reading. Every role within whose site scope a finding falls SHALL
be able to list it and open it, including its current classification: the JHSC member who
described the hazard in the field has a legitimate interest in what was made of it.

Withholding the form SHALL be understood as convenience and never as the guarantee. The
guarantee is the role the server checks when a classification is submitted, and it stands
whether or not the form was ever presented.

#### Scenario: A supervisor reads but is not offered the form

- **GIVEN** a supervisor whose site scope contains an unclassified finding
- **WHEN** the supervisor opens that finding
- **THEN** the finding is presented with its description, location and photo count
- **AND** no classification form is presented
- **AND** the supervisor is told that only the HS coordinator classifies

#### Scenario: A JHSC member sees what was made of the hazard

- **GIVEN** a JHSC member whose site scope contains a classified finding
- **WHEN** the member opens that finding
- **THEN** the current classification is presented with its `risk_level` and `control_level`

#### Scenario: The server refuses regardless of the form

- **WHEN** a supervisor submits a classification directly
- **THEN** the response is `forbidden`
