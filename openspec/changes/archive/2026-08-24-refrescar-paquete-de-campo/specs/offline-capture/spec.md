## MODIFIED Requirements

### Requirement: An inspection is prepared for the field before signal is lost

The system SHALL download, and store locally, everything an inspection needs before the device
leaves coverage: the complete frozen `template_version` the scheduled inspection is bound to, the
closed location catalog of the inspection's `site_id`, and the active roster subset of that site.
An inspection SHALL be reported as field-ready only when all three are stored. An inspection that
is not field-ready SHALL be shown as such in the pending list, with what is missing named, while
the device still has network.

Preparing an inspection SHALL remain available after it is field-ready. The system SHALL let the
inspector run the preparation again on an inspection whose three sets are already stored, and a
re-run SHALL replace each stored set with what the server returns. Alongside the offered re-run,
the system SHALL show the `fetched_at` of the stored `template_version` so the inspector can tell
how old the package on the device is. A re-run SHALL NOT change any stored answer, photo or
finding: those belong to the draft's `client_submission_id`, not to the package.

#### Scenario: Preparing an inspection stores all three sets

- **GIVEN** a scheduled inspection assigned to the requesting account
- **WHEN** the inspector prepares it for the field with network available
- **THEN** the `template_version` document, the site's location catalog and the site's active
  roster subset are stored locally
- **AND** the inspection is reported as field-ready

#### Scenario: A partial download does not report field-ready

- **GIVEN** a prepare run whose roster request fails
- **WHEN** the pending list is read
- **THEN** the inspection is listed as not field-ready and names the roster as missing
- **AND** re-running prepare with network available completes it and reports field-ready

#### Scenario: Capture on a device that is not field-ready is refused

- **GIVEN** an inspection that is not field-ready and a device with no network
- **WHEN** the inspector opens it for capture
- **THEN** capture does not start
- **AND** the screen names what must be downloaded and that a connection is required

#### Scenario: The stored template version is the one the inspection is bound to

- **GIVEN** an inspection prepared against version `2` of a template
- **WHEN** version `3` of that template is published and the device reconnects
- **THEN** the locally stored document for that inspection is still version `2`
- **AND** capture continues to be interpreted against version `2`

#### Scenario: A field-ready inspection can still be prepared again

- **GIVEN** an inspection whose three sets are already stored
- **WHEN** the inspector reads the assignment
- **THEN** preparing it again is offered, together with the `fetched_at` of the stored
  `template_version`
- **AND** running it replaces the stored location catalog and roster subset with what the server
  returns

#### Scenario: Preparing again leaves the draft's work untouched

- **GIVEN** a draft with answers, photos and findings already captured on this device
- **WHEN** the inspector prepares the same inspection again
- **THEN** every answer, photo and finding of that `client_submission_id` is still stored
- **AND** the progress shown for the assignment is unchanged

## ADDED Requirements

### Requirement: A draft bound to a version the device no longer holds is named

The system SHALL refuse to continue capture when the stored package's `template_version_id` is not
the one the draft was opened against, and SHALL name that refusal on the screen instead of leaving
it loading. The screen SHALL say that the draft was started against a different version of the
form, and SHALL say what resolves it: discarding the draft and starting the inspection over. WHEN
the draft can no longer be discarded because it is already signed, the system SHALL NOT offer
discarding it, and SHALL say that the draft is on its way and that the server will refuse it.

#### Scenario: A capturing draft bound to a stale version is named

- **GIVEN** a draft opened against `template_version_id` A
- **AND** a stored package whose `template_version_id` is B
- **WHEN** the inspector opens the inspection for capture
- **THEN** the walkthrough is not shown and the screen states that the draft was started against a
  different version of the form
- **AND** the screen states that the draft must be discarded and the inspection started over

#### Scenario: A signed draft bound to a stale version is not offered a discard

- **GIVEN** a draft in the `signed` status whose `template_version_id` is not the stored package's
- **WHEN** the inspector opens the inspection for capture
- **THEN** discarding the draft is not offered
- **AND** the screen states that the draft is signed and on its way, and that the server will
  refuse it

### Requirement: A stored package that is not the inspection's frozen version is named

The system SHALL compare the `template_version_id` of the stored package against the
`template_version_id` the scheduled inspection is frozen to, using the value already carried by the
pending list so that no extra request is made. WHEN the two differ, the system SHALL show the
assignment as holding a stale package and SHALL offer preparing it again. The system SHALL NOT
report a mismatch while either value is still unknown.

#### Scenario: A stale stored package is reported on the assignment

- **GIVEN** an assignment frozen to `template_version_id` A
- **AND** a stored package whose `template_version_id` is B
- **WHEN** the inspector reads the assignment
- **THEN** the assignment says the stored package is not the version this inspection is frozen to
- **AND** preparing it again is offered

#### Scenario: An aligned package reports nothing

- **GIVEN** an assignment frozen to `template_version_id` A and a stored package whose
  `template_version_id` is A
- **WHEN** the inspector reads the assignment
- **THEN** no mismatch is reported

#### Scenario: Nothing is reported before the stored package is read

- **GIVEN** an assignment whose stored package has not been read yet
- **WHEN** the inspector reads the assignment
- **THEN** no mismatch is reported
