## Purpose

Defines what an inspector's device must hold before it loses signal, how a draft inspection
survives the application being closed, how photos are uploaded separately from and before the
submission, and how a submission leaves the device exactly once no matter how many times it is
retried. It also defines what the interface must tell the inspector about work that has not yet
left the phone, so the seven-day assumption of ADR-010 is something the user can verify rather
than something the system hopes for.

## Requirements

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

### Requirement: Capture does not start for an inspection the account is not assigned

The system SHALL refuse to start a draft for a scheduled inspection that is not assigned to the
account holding the device, and SHALL name the reason on the screen instead of presenting the
walkthrough. An inspection assigned to nobody SHALL be refused the same way.

The refusal SHALL be resolvable with no network: the assignment SHALL be read from what the
device already downloaded for that inspection, never from a request made at the moment of
opening. A device that has not downloaded the inspection SHALL continue to report it as not
field-ready, which is a separate refusal with its own reason.

The refusal SHALL be the device declining to begin work, not a claim about what the server would
accept. The server SHALL keep refusing a submission from an account that is not the assigned
inspector regardless of what the device allowed.

#### Scenario: An inspection assigned to someone else does not open for capture

- **GIVEN** a device holding the field package of an inspection assigned to inspector A
- **WHEN** account B, signed in on that device, opens that inspection for capture
- **THEN** no draft is created and the walkthrough is not shown
- **AND** the screen states that the inspection is assigned to someone else

#### Scenario: An unassigned inspection does not open for capture

- **GIVEN** a device holding the field package of an inspection whose inspector is `null`
- **WHEN** any account opens that inspection for capture
- **THEN** no draft is created
- **AND** the screen states that the inspection has no inspector assigned

#### Scenario: The refusal holds with no network

- **GIVEN** a device with no connectivity holding the field package of an inspection assigned
  to another account
- **WHEN** that inspection is opened for capture
- **THEN** the refusal is shown without any request being made

#### Scenario: The assigned inspector captures as before

- **GIVEN** a device holding the field package of an inspection assigned to the signed-in
  account
- **WHEN** the inspector opens it for capture
- **THEN** the draft opens and the walkthrough is shown

### Requirement: A draft whose inspection is no longer the account's cannot be signed

The system SHALL refuse to sign a draft whose inspection is no longer assigned to the account
that holds it, and SHALL state on the review screen why signing is unavailable.

The draft, its answers, its findings and its photos SHALL remain readable on the device. The
system SHALL NOT discard them, and SHALL NOT sign or queue them.

#### Scenario: Reassignment mid-capture blocks signing and keeps the work

- **GIVEN** a draft captured by account A for an inspection that is then reassigned to
  inspector B, and a device that has downloaded the reassignment
- **WHEN** A opens the review screen for that draft
- **THEN** signing is refused and the screen states that the inspection is now assigned to
  someone else
- **AND** the draft and its answers remain readable on the device

#### Scenario: The work is not discarded by the refusal

- **GIVEN** a draft that cannot be signed because its inspection was reassigned
- **WHEN** the device is reopened later
- **THEN** the draft is still listed and still readable

### Requirement: A draft belongs to one device, one owner and one signer

The system SHALL treat a draft as owned by the account that created it on the device that holds
it. The system SHALL NOT merge, replicate or reconcile a draft across devices, and SHALL NOT
attempt to resolve concurrent edits of the same inspection. Signing SHALL be part of the capture
on that device. Once a submission is accepted, the device SHALL treat the inspection as closed and
SHALL NOT allow it to be re-opened for editing.

A queued submission SHALL belong to the same account as the draft it came from. The system SHALL
send a queued submission only while that account is the one signed in, and SHALL NOT show one
account the queue of another. A submission SHALL NEVER be sent under a session other than its
owner's, so that the account holding the device cannot become the signer of work it did not sign.

#### Scenario: A different account does not see another's draft

- **GIVEN** a draft created by account A on a device
- **WHEN** account B signs in on that same device
- **THEN** account A's draft is not listed or readable to B

#### Scenario: A different account does not send another's queued submission

- **GIVEN** a signed submission of account A waiting in the queue on a device
- **WHEN** account B signs in on that device and the queue runs
- **THEN** the submission is not sent
- **AND** it stays in the queue, unchanged, until A signs in again

#### Scenario: An accepted submission cannot be edited

- **GIVEN** an inspection whose submission the server accepted
- **WHEN** the inspector opens it
- **THEN** it is presented read-only
- **AND** no new draft or submission is created for it

#### Scenario: A second device does not receive the draft

- **GIVEN** a draft on device 1 for a scheduled inspection
- **WHEN** the same account opens that scheduled inspection on device 2
- **THEN** device 2 shows no draft content from device 1

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

### Requirement: A negative answer shows the corrective action its question prescribes

The system SHALL show the `corrective_action` of the answered question's `finding` block
alongside the finding details, as soon as an answer is entered as negative, on the same
screen and without any network request. The text SHALL be shown exactly as it was frozen
into the published document — the device holds it from the field package and never asks
for it.

The system SHALL show the prescription as reading only: it SHALL NOT be editable, and it
SHALL NOT prefill or alter the description the inspector writes. What the author decided
months ago about the question and what the inspector saw today are two different records,
and a prescription copied into the inspector's own words would be signed as an observation
nobody made.

The system SHALL show nothing at all when the answered question carries no `finding`
block: no placeholder, no empty heading, and no statement that no corrective action is
defined.

The system SHALL NOT show the `fails_when` threshold of the `finding` block. The engine
does not read that threshold, and showing it during the walkthrough would present a value
the system never applies as if it governed the answer.

#### Scenario: A negative answer shows what the template prescribes

- **GIVEN** an inspection open with the network disabled
- **AND** a `yes_no` question whose `finding` block prescribes a `corrective_action`
- **WHEN** the inspector answers that question `false`
- **THEN** the prescribed `corrective_action` is shown for that item
- **AND** the description field for that item is still empty
- **AND** no network request is made

#### Scenario: A question that prescribes nothing shows nothing

- **GIVEN** a `yes_no` question that carries no `finding` block
- **WHEN** the inspector answers it `false`
- **THEN** the description field, and the camera control are shown for that item
- **AND** no corrective action text is shown for that item

#### Scenario: The prescription is not the inspector's description

- **GIVEN** a question whose `finding` block prescribes a `corrective_action`
- **WHEN** the inspector answers it `false` and signs without typing a description
- **THEN** the inspection is refused as incomplete for that item
- **AND** the prescribed text is not submitted as the finding's description

#### Scenario: `na` shows no prescription

- **GIVEN** a `yes_no_na` question whose `finding` block prescribes a `corrective_action`
- **WHEN** the inspector answers it `na`
- **THEN** no corrective action text is shown for that item

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

### Requirement: An assignment can be previewed read-only without becoming a draft

The system SHALL let an inspector open an assignment in a preview that presents the frozen
template's sections and questions and accepts no input: no answer is recorded, no finding is
opened, no photo is captured and no signature is taken.

The preview SHALL create nothing on the device. Opening it SHALL NOT create a draft, SHALL NOT
mark the assignment as started, and SHALL NOT change whether the assignment is ready for the
field. An inspector who previews an assignment and returns SHALL find that assignment
described exactly as before.

The preview SHALL be available for an assignment whose field package is not on the device,
which is its purpose: the month that has not opened yet is the one an inspector wants to look
at before committing to it. Where the device already holds the frozen template, the preview
SHALL use it; otherwise it SHALL request it, and where it can do neither it SHALL say so
rather than present a partial walk.

The preview SHALL present every question of the template, including those a condition would
hide while nothing is answered, so that it does not describe a shorter walk than the one the
inspector will actually make.

Previewing is not capturing, and the requirement that capture is refused on a device that is
not field-ready is unaffected: an inspector who previews an assignment SHALL still have to
download it before any answer can be recorded.

#### Scenario: Previewing writes nothing to the device

- **GIVEN** an assignment with no draft on the device
- **WHEN** the inspector opens it as a preview
- **THEN** the template's sections and questions are presented
- **AND** no draft is created for that assignment
- **AND** the assignment is still reported as not started

#### Scenario: A month that has not been downloaded can still be previewed

- **GIVEN** an assignment whose field package is not on the device
- **WHEN** the inspector opens it as a preview and the template can be retrieved
- **THEN** the questions are presented read-only
- **AND** the assignment is still reported as needing to be downloaded

#### Scenario: The preview accepts no answer

- **GIVEN** an assignment presented as a preview
- **WHEN** the inspector attempts to answer one of its questions
- **THEN** the answer is not accepted and nothing is recorded

#### Scenario: A conditional question is shown in the preview

- **GIVEN** a template with a question shown only when an earlier one is answered negatively
- **WHEN** the inspector opens the assignment as a preview, with nothing answered
- **THEN** that question is presented among the others

#### Scenario: The template cannot be reached

- **GIVEN** an assignment whose template is neither on the device nor retrievable
- **WHEN** the inspector opens it as a preview
- **THEN** the screen states that the preview could not be loaded
- **AND** no partial set of questions is presented

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
