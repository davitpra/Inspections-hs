## ADDED Requirements

### Requirement: A negative answer asks for its finding details on the spot, with no network

The system SHALL prompt the inspector for a description, a location and at least one photo as soon
as an answer is entered as negative, on the same screen and without any network request. The
location SHALL be chosen from the closed catalogue already stored on the device for that
inspection's site; the inspector SHALL NOT be able to type a location as free text. The prompt
SHALL work identically with the device offline.

#### Scenario: Answering `no` opens the finding details

- **GIVEN** an inspection open with the network disabled
- **WHEN** the inspector answers a `yes_no` item `false`
- **THEN** the description field, the location list and the camera control are shown for that item
- **AND** no network request is made

#### Scenario: The location list is the prefetched catalogue of the inspection's site

- **GIVEN** an inspection of St. Thomas prepared for the field
- **WHEN** the location list is opened for a finding
- **THEN** it offers the locations stored for St. Thomas and no location of Glencoe
- **AND** the list offers no free-text entry

#### Scenario: `na` asks for nothing

- **WHEN** the inspector answers a `yes_no_na` item `na`
- **THEN** no finding details are requested for that item

### Requirement: Finding details are persisted as they are entered and discarded with their answer

The system SHALL write each part of a finding — the description, the location and each photo — to
the local store as it is entered, before the inspector moves on, so that the application being
killed loses nothing. Reopening a draft SHALL restore its finding details and their photos exactly
as they were left. When an answer stops being negative, or when the item is hidden by a later
answer, the system SHALL discard the finding details captured for it, so that a draft never
carries details for an answer that no longer implies a finding.

#### Scenario: A killed application loses no finding detail

- **GIVEN** a draft where the inspector entered a description, a location and one photo for
  `dock.guards`
- **WHEN** the application is killed and reopened
- **THEN** the description, the location and the photo are restored for `dock.guards`

#### Scenario: Correcting an answer discards its finding

- **GIVEN** `dock.guards` answered `false` with a description, a location and a photo
- **WHEN** the inspector changes the answer to `true`
- **THEN** the finding details for `dock.guards` are removed from the draft
- **AND** the submission built from that draft carries no `findings` entry for `dock.guards`

#### Scenario: An item hidden by a later answer discards its finding

- **GIVEN** `spill.cleanup` answered `false` with its finding details, visible only when
  `spill.present` is `yes`
- **WHEN** the inspector changes `spill.present` to `no`
- **THEN** the draft retains neither the answer nor the finding details of `spill.cleanup`

### Requirement: An inspection cannot be signed while a finding is incomplete

The system SHALL refuse to let the inspector sign and submit while any negative answer of the
draft lacks a description, a location or at least one photo, and SHALL name which items are
incomplete rather than only reporting that something is missing. The refusal SHALL happen on the
device, before signing, so that the inspector can still walk back to the spot; the server refusing
the same submission is the backstop and not the first line.

#### Scenario: Signing is refused and the incomplete items are named

- **GIVEN** a draft with three negative answers, one of them with no photo
- **WHEN** the inspector tries to sign
- **THEN** signing is refused
- **AND** the item with no photo is named on screen

#### Scenario: A complete draft signs and queues

- **WHEN** every negative answer of the draft has a description, a location and at least one photo
- **THEN** signing is allowed
- **AND** the outbox entry carries a `findings` entry for each negative answer

### Requirement: A finding photo is uploaded before its submission is sent

The system SHALL store every finding photo in the local store at capture time and SHALL upload it
with a presigned URL before the submission is sent, exactly as it does for the photos of a photo
item. A submission SHALL NOT be sent while any of its finding photos is still unuploaded, and the
payload SHALL carry only object keys.

#### Scenario: A submission waits for its finding photos

- **GIVEN** a signed draft whose finding photo has not uploaded yet
- **WHEN** the outbox runs
- **THEN** the submission is not posted
- **AND** the photo upload is attempted

#### Scenario: The payload carries keys, not bytes

- **WHEN** the submission is posted
- **THEN** every `photo_object_keys` value is an object key
- **AND** no image bytes are present in the payload

#### Scenario: An uploaded finding photo is not uploaded twice

- **GIVEN** a finding photo already uploaded and its object key stored
- **WHEN** the outbox runs again after a restart
- **THEN** the photo is not uploaded a second time
