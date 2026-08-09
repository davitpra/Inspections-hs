## Purpose

Defines what an inspector's device must hold before it loses signal, how a draft inspection
survives the application being closed, how photos are uploaded separately from and before the
submission, and how a submission leaves the device exactly once no matter how many times it is
retried. It also defines what the interface must tell the inspector about work that has not yet
left the phone, so the seven-day assumption of ADR-010 is something the user can verify rather
than something the system hopes for.

## ADDED Requirements

### Requirement: The application shell runs with no network

The system SHALL precache the application shell — the document, the scripts, the styles and the
form engine — at install time, and SHALL serve every capture route from that cache. Opening,
navigating and completing an inspection SHALL NOT require any network request. The device SHALL
request persistent storage at application start so that the browser does not evict the local
store under pressure. The application SHALL be installable to the home screen.

#### Scenario: A capture route opens with the network disabled

- **GIVEN** the application has been opened once with network available
- **WHEN** the device is put in airplane mode and the application is launched from the home
  screen
- **THEN** the inspection capture screen renders
- **AND** no request leaves the device

#### Scenario: Persistent storage is requested at start

- **WHEN** the application starts
- **THEN** it requests persistent storage from the browser
- **AND** a denial is recorded as a degraded-storage state without preventing capture

#### Scenario: A route the shell does not cover degrades to an offline screen

- **GIVEN** the device has no network
- **WHEN** a route outside the precached capture shell is requested
- **THEN** an offline screen is shown naming what needs a connection
- **AND** no draft is discarded

### Requirement: An inspection is prepared for the field before signal is lost

The system SHALL download, and store locally, everything an inspection needs before the device
leaves coverage: the complete frozen `template_version` the scheduled inspection is bound to, the
closed location catalog of the inspection's `site_id`, and the active roster subset of that site.
An inspection SHALL be reported as field-ready only when all three are stored. An inspection that
is not field-ready SHALL be shown as such in the pending list, with what is missing named, while
the device still has network.

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

### Requirement: Every answer is persisted before the inspector moves on

The system SHALL write each answer to the local store as it is entered, before the next screen is
presented. Closing the application, the process being killed by the operating system, or the
device restarting SHALL NOT lose any answer that was already entered. Reopening an inspection
SHALL restore the draft — its answers, the item the inspector was on, and its photos — exactly as
it was left.

#### Scenario: A killed application loses nothing

- **GIVEN** an inspection in airplane mode with twelve answers entered
- **WHEN** the application is closed completely and relaunched
- **THEN** all twelve answers are present
- **AND** the inspection resumes at the item that was last shown

#### Scenario: A draft is restored with its photos

- **GIVEN** a draft with five photos captured and not yet uploaded
- **WHEN** the application is relaunched
- **THEN** the five photos are present in the draft and can be viewed without network

#### Scenario: A hidden item's answer is not retained

- **GIVEN** an answer entered on an item that a later answer makes invisible under the template
  version's conditional logic
- **WHEN** the draft is read back
- **THEN** the hidden item carries no answer
- **AND** the draft does not report it as missing

### Requirement: A photo is stored locally when taken and uploaded before the submission

The system SHALL store every captured photo in the local store at capture time, and SHALL upload
it to object storage with a presigned URL as an operation independent of the submission. A
submission SHALL carry only object keys and SHALL NEVER carry photo bytes. A submission SHALL NOT
be sent while any of its photos is still unuploaded. A failed photo upload SHALL be retried
without affecting the answers or any other photo.

#### Scenario: A submission carries keys, not bytes

- **WHEN** a submission is sent
- **THEN** its payload references each photo by object key
- **AND** the payload contains no image data

#### Scenario: A submission waits for its photos

- **GIVEN** a completed inspection with five photos of which two have not uploaded
- **WHEN** the outbox runs
- **THEN** the submission is not sent
- **AND** the remaining photo uploads are attempted

#### Scenario: One failed photo does not block the others

- **GIVEN** five queued photos of which one upload fails
- **WHEN** the outbox runs
- **THEN** the other four are uploaded and marked as uploaded
- **AND** the failed one is retried on the next run without being re-captured

#### Scenario: An uploaded photo is not uploaded twice

- **GIVEN** a photo that uploaded successfully
- **WHEN** the outbox runs again
- **THEN** no presigned URL is requested for it and no upload is performed

#### Scenario: A presigned URL is scoped to the requester

- **WHEN** an account requests a presigned upload for a scheduled inspection outside its active
  site scope
- **THEN** the request is rejected as forbidden
- **AND** no URL is issued

#### Scenario: A presigned URL grants upload only

- **WHEN** a presigned URL is issued
- **THEN** it authorises a single object upload and nothing else
- **AND** it expires

### Requirement: The submission identifier is fixed when the draft is created

The system SHALL generate a `client_submission_id` as a UUID on the device at the moment the
draft is created, not at the moment it is sent. That value SHALL be stored with the draft and
SHALL NEVER change: not across application restarts, not across network changes, not across any
number of send attempts, and not when a send fails. Every attempt to send a given inspection
SHALL carry the same `client_submission_id`.

#### Scenario: The identifier survives a full application restart

- **GIVEN** a draft created in airplane mode
- **WHEN** the application is closed completely and relaunched
- **THEN** the draft's `client_submission_id` is unchanged

#### Scenario: A retry reuses the same identifier

- **GIVEN** a submission whose first attempt failed with a server error
- **WHEN** the outbox retries it
- **THEN** the second attempt carries the same `client_submission_id` as the first

#### Scenario: A second draft gets a different identifier

- **WHEN** two drafts are created on the same device
- **THEN** their `client_submission_id` values differ

### Requirement: The outbox sends one submission at a time and never discards an entry

The system SHALL hold a local outbox with one entry per completed inspection, carrying its state,
its attempt count and its last error. At most one send SHALL be in flight for a given entry at any
time, including across concurrent application tabs and service worker wake-ups. A failed send
SHALL be retried with exponential backoff. An entry SHALL be removed only after the server has
accepted it. An entry SHALL NEVER be discarded because of an authentication failure: the session
SHALL be refreshed or re-established and the entry retried.

#### Scenario: Reconnecting after a full restart sends exactly once

- **GIVEN** a completed inspection with five photos captured in airplane mode
- **WHEN** the application is closed completely, the device reconnects and the application is
  relaunched
- **THEN** exactly one submission is sent
- **AND** the outbox entry is removed only after the server accepts it

#### Scenario: A concurrent run does not double-send

- **WHEN** two runs of the outbox start for the same entry at the same time
- **THEN** only one send is performed
- **AND** neither run fails with an unhandled error

#### Scenario: An expired session does not lose the submission

- **GIVEN** an outbox entry and a session whose access token has expired
- **WHEN** the outbox runs
- **THEN** the session is refreshed and the submission is sent
- **AND** if the session cannot be refreshed the entry stays queued and sign-in is requested

#### Scenario: A rejected submission is kept and surfaced, not dropped

- **GIVEN** a submission the server rejects as invalid
- **WHEN** the outbox runs
- **THEN** the entry stops being retried and is shown to the inspector with the server's reason
- **AND** the draft and its answers remain readable on the device

#### Scenario: Repeated failures back off rather than hammer the network

- **GIVEN** an entry whose sends keep failing with a transient error
- **WHEN** successive attempts run
- **THEN** the interval between attempts grows
- **AND** the attempt count and last error are stored with the entry

### Requirement: The inspector always sees what has not left the device

The system SHALL display, on every capture screen, the number of answers not yet submitted and
the age of the oldest unsynchronised draft, phrased as "N answers not submitted, draft from X days
ago". When the oldest unsynchronised draft is three days old or more, the system SHALL show a
prominent warning telling the inspector to connect. The indicator SHALL be present whether or not
the device has network, and SHALL NOT be dismissible while unsubmitted work exists.

#### Scenario: The indicator counts unsubmitted answers and draft age

- **GIVEN** a draft created four days ago with seventeen answers and no successful submission
- **WHEN** any capture screen is shown
- **THEN** the indicator reads seventeen answers not submitted and a draft from four days ago

#### Scenario: Three days triggers a prominent warning

- **GIVEN** an unsynchronised draft that becomes three days old
- **WHEN** the application is opened
- **THEN** a prominent warning is shown telling the inspector to connect
- **AND** it cannot be dismissed while the draft is unsubmitted

#### Scenario: A two-day-old draft warns nothing

- **GIVEN** an unsynchronised draft two days old
- **WHEN** any capture screen is shown
- **THEN** the indicator reports it
- **AND** no prominent warning is shown

#### Scenario: The indicator clears only on acceptance

- **GIVEN** a submission accepted by the server
- **WHEN** any capture screen is shown
- **THEN** the indicator reports nothing unsubmitted for that inspection

### Requirement: A draft belongs to one device, one owner and one signer

The system SHALL treat a draft as owned by the account that created it on the device that holds
it. The system SHALL NOT merge, replicate or reconcile a draft across devices, and SHALL NOT
attempt to resolve concurrent edits of the same inspection. Signing SHALL be part of the capture
on that device. Once a submission is accepted, the device SHALL treat the inspection as closed and
SHALL NOT allow it to be re-opened for editing.

#### Scenario: A different account does not see another's draft

- **GIVEN** a draft created by account A on a device
- **WHEN** account B signs in on that same device
- **THEN** account A's draft is not listed or readable to B

#### Scenario: An accepted submission cannot be edited

- **GIVEN** an inspection whose submission the server accepted
- **WHEN** the inspector opens it
- **THEN** it is presented read-only
- **AND** no new draft or submission is created for it

#### Scenario: A second device does not receive the draft

- **GIVEN** a draft on device 1 for a scheduled inspection
- **WHEN** the same account opens that scheduled inspection on device 2
- **THEN** device 2 shows no draft content from device 1
