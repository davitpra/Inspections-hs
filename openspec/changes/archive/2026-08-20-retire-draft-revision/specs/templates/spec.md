## ADDED Requirements

### Requirement: The last save of a live draft wins

The system SHALL apply every save submitted against a draft that has not been discarded,
without comparing the submitted document to what the draft held when it was read. Where two
saves reach a draft one after the other, the later one SHALL be the stored document, and the
earlier one SHALL be gone.

The system SHALL NOT report concurrent authorship. A save is refused only when the draft
does not exist or has been discarded, when the account is not a coordinator, when the name
collides with another live draft, or when `site_ids` is empty or names a plant outside the
account's scope. None of those refusals describes a draft that moved.

This is the same bargain ADR-001 makes everywhere else in the product: one owner, one
device, and losing a draft is accepted. A draft under authorship carries no guarantee that
a second window is not overwriting it, and the system does not pretend otherwise.

#### Scenario: A save against a draft that moved is applied anyway

- **GIVEN** a draft read by two windows
- **AND** the first window has saved a document naming the section `Loading dock`
- **WHEN** the second window saves a document naming the section `Compressor room`, having
  never seen the first window's save
- **THEN** the save succeeds
- **AND** reading the draft reports the section named `Compressor room`
- **AND** nothing written by the first window survives

#### Scenario: A save against a discarded draft is still refused

- **GIVEN** a draft that has been discarded
- **WHEN** a save is submitted against it
- **THEN** the request is refused as `template_draft_not_found`

## MODIFIED Requirements

### Requirement: A draft declares the plants it is written for

The system SHALL carry on every `template_draft` a non-empty `site_ids` list naming the
plants the template is being written for, and SHALL expose it on every read of a draft, both
in the list of drafts and in a single draft.

A draft created without a stated scope SHALL receive the full site scope of the account that
created it. The scope SHALL be editable for as long as the draft is a draft, and SHALL travel
inside the same save that carries the `document` and the `name`, because changing where a
template is meant to be used is an edit like any other and is not worth a second write that
could interleave with the first.

The system SHALL refuse a save whose `site_ids` is empty, and SHALL refuse a save naming a
plant outside the site scope of the requesting account, leaving the stored draft untouched in
both cases. This is selection, not isolation: a template still carries no `site_id`, still
has no row-level policy, and is still organisation reference content. `site_ids` states
**where the template is meant to be used**, not whose data it is.

#### Scenario: A new draft is scoped to the whole account

- **WHEN** a coordinator whose scope covers both plants creates a draft
- **THEN** reading the draft reports `site_ids` naming both plants

#### Scenario: The scope narrows and survives the save

- **GIVEN** a draft scoped to both plants
- **WHEN** a save declaring a `site_ids` naming only St. Thomas is submitted
- **THEN** the save succeeds
- **AND** reading the draft reports `site_ids` naming only St. Thomas

#### Scenario: An empty scope is refused

- **WHEN** a save is submitted with an empty `site_ids`
- **THEN** the request is refused
- **AND** the stored draft is unchanged

#### Scenario: A plant outside the account's scope is refused

- **GIVEN** a coordinator account whose site scope covers only Glencoe
- **WHEN** that account saves a draft whose `site_ids` names St. Thomas
- **THEN** the request is refused as `template_draft_site_out_of_scope`
- **AND** the stored draft is unchanged

#### Scenario: The scope is not a site isolation boundary

- **WHEN** two coordinator accounts whose scopes cover different plants list the drafts
- **THEN** both receive the same entries, whatever each draft's `site_ids` says

## REMOVED Requirements

### Requirement: Saving over a draft that has moved is refused

**Reason**: The requirement gave the template draft a concurrency guarantee that no other
write in the product offers, and that ADR-001 declines by design — one owner, one device,
one signer, and losing a draft is accepted. Multi-device authorship of a single document is
out of scope for v1 by decision. Keeping one write path with rules of its own costs more to
maintain and to explain than the uniform rule does, and the loss it prevented is a loss the
architecture already accepts everywhere else.

The cost is real and is not mitigated: with two windows open on one draft, the second save
discards what the first one wrote and no one is told. That is the price of the removal,
recorded here so it reads as a decision rather than an oversight.

**Migration**: No data migration. `revision` is dropped from `template_draft`, and no
history is lost with it — the column was an optimistic lock counter, never a version: each
save overwrote the stored document in place and only the current row ever existed.

Clients stop sending `revision` on a save and stop receiving it on a read; a save that still
declares it is refused as a validation error, not as a stale write. The
`template_draft_stale` response no longer exists, and nothing replaces it: a client that
handled it can drop that branch. Interfaces that displayed the revision number have nothing
to display in its place, because a counter with no lock behind it reports nothing an author
can act on.
