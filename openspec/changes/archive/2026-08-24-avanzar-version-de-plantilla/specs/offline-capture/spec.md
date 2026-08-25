# offline-capture

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

WHEN the device holds no draft for the inspection, a re-run SHALL advance the inspection to the
highest published version of its template before storing the document, so that the package the
inspector carries is the form the coordinator published last.

WHEN the device holds a draft for the inspection — whether it is being captured or already signed
— a re-run SHALL NOT advance the version. It SHALL refresh the location catalog, the roster and
the document of the version the inspection is already bound to, and the screen SHALL name that a
newer version exists and that taking it requires discarding the draft first. Advancing under a
draft would orphan the answers already captured, and under a signed draft it would make the
server refuse a submission the inspector already walked the plant for.

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

#### Scenario: A newer version is not taken until the inspection is prepared again

- **GIVEN** an inspection prepared against version `2` of a template
- **WHEN** version `3` of that template is published and the device reconnects
- **THEN** the locally stored document for that inspection is still version `2`
- **AND** capture continues to be interpreted against version `2` until the inspector prepares
  the inspection again

#### Scenario: Preparing again with no draft takes the newest version

- **GIVEN** an inspection prepared against version `2`, with no draft on the device
- **AND** version `3` of that template published
- **WHEN** the inspector prepares the inspection again
- **THEN** the inspection is bound to version `3`
- **AND** the stored document is version `3`
- **AND** starting the inspection interprets it against version `3`

#### Scenario: Preparing again with a draft in progress does not take the newest version

- **GIVEN** an inspection bound to version `2` with a draft being captured on the device
- **AND** version `3` of that template published
- **WHEN** the inspector prepares the inspection again
- **THEN** the inspection is still bound to version `2`
- **AND** the stored document is still version `2`
- **AND** the assignment states that version `3` is published and that the draft must be
  discarded to inspect with it

#### Scenario: Preparing again with a signed draft does not take the newest version

- **GIVEN** an inspection bound to version `2` with a draft in the `signed` status waiting to be
  sent
- **AND** version `3` of that template published
- **WHEN** the inspector prepares the inspection again
- **THEN** the inspection is still bound to version `2`
- **AND** discarding the draft is not offered

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

### Requirement: A stored package that is not the inspection's frozen version is named

The system SHALL compare the `template_version_id` of the stored package against the
`template_version_id` the scheduled inspection is frozen to, using the value already carried by the
pending list so that no extra request is made. WHEN the two differ, the system SHALL show the
assignment as holding a stale package and SHALL offer preparing it again. The system SHALL NOT
report a mismatch while either value is still unknown.

WHEN the two agree but the pending list reports a higher published version of the same template,
the system SHALL name that newer version on the assignment instead of reporting a stale package.
The two SHALL be distinguished because they end differently: a stale package is repaired by
preparing again, while a newer version is a choice the inspector takes — and one that a draft on
the device blocks until it is discarded. Neither SHALL be reported while any of the values is
still unknown.

#### Scenario: A stale stored package is reported on the assignment

- **GIVEN** an assignment frozen to `template_version_id` A
- **AND** a stored package whose `template_version_id` is B
- **WHEN** the inspector reads the assignment
- **THEN** the assignment says the stored package is not the version this inspection is frozen to
- **AND** preparing it again is offered

#### Scenario: An aligned package with a newer version published names the newer version

- **GIVEN** an assignment frozen to `template_version_id` A and a stored package whose
  `template_version_id` is A
- **AND** a higher published version of the same template
- **WHEN** the inspector reads the assignment
- **THEN** the assignment names the newer version and how to take it
- **AND** no stale package is reported

#### Scenario: An aligned package with nothing newer reports nothing

- **GIVEN** an assignment frozen to `template_version_id` A, a stored package whose
  `template_version_id` is A, and no higher published version
- **WHEN** the inspector reads the assignment
- **THEN** no mismatch and no newer version are reported

#### Scenario: Nothing is reported before the stored package is read

- **GIVEN** an assignment whose stored package has not been read yet
- **WHEN** the inspector reads the assignment
- **THEN** no mismatch is reported
