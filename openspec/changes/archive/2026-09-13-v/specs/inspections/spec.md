## RENAMED Requirements

- FROM: `### Requirement: Only the HS coordinator schedules, reassigns and cancels`
- TO: `### Requirement: Only the coordinator schedules, reassigns and cancels`


## MODIFIED Requirements

### Requirement: A scheduled inspection can be advanced to the newest published version of its template

The system SHALL accept a request to advance one scheduled inspection to the highest
published version of its own template, and SHALL respond with the same field package the
frozen template version read returns: the complete document, its `template_version_id`, its
`version`, the inspection's `site_id` and the inspection's `inspector_id`.

The request SHALL be restricted to the account the inspection is assigned to and to accounts
whose role is `coordinator`, and SHALL be refused as forbidden to every other account.
Advancing SHALL be resolvable only within the requester's session scope, on the same terms as
every other read of the field package.

The request SHALL be idempotent: when the inspection is already bound to the highest published
version, it SHALL write nothing and SHALL still return the package. It SHALL be refused when
the period already has a submission, when the period is cancelled, and when the template has
no version higher than the one the inspection is bound to.

Advancing SHALL be recorded in the audit log of the inspection's site as an event of its own,
naming the acting account, the `template_version_id` the inspection was bound to and the one
it is now bound to. It SHALL NOT be recorded as a reassignment or as a cancellation, and a
request that writes nothing SHALL add no entry.

#### Scenario: The assigned inspector advances to the newest version

- **GIVEN** a scheduled inspection assigned to the requesting account and bound to version `2`
  of a template whose version `3` is published
- **WHEN** the account requests the advance
- **THEN** the inspection reports `template_version_id` for version `3`
- **AND** the response carries the document of version `3` and its `version` number

#### Scenario: Advancing twice writes once

- **GIVEN** a scheduled inspection that has just been advanced to version `3`
- **WHEN** the same advance is requested again
- **THEN** the response carries version `3`
- **AND** exactly one `inspection.version_advanced` entry exists for that inspection

#### Scenario: An inspection already on the newest version is not an error

- **GIVEN** a scheduled inspection bound to the highest published version of its template
- **WHEN** the advance is requested
- **THEN** the response carries that same version
- **AND** no audit entry is added

#### Scenario: A submitted period cannot be advanced

- **GIVEN** a scheduled inspection whose submission has been accepted
- **WHEN** the advance is requested
- **THEN** the request is refused and names that the period was already submitted
- **AND** `template_version_id` is unchanged

#### Scenario: A cancelled period cannot be advanced

- **GIVEN** a scheduled inspection whose `cancelled_at` is not null
- **WHEN** the advance is requested
- **THEN** the request is refused and names that the period was cancelled

#### Scenario: An account that is neither the inspector nor a coordinator is refused

- **GIVEN** a scheduled inspection assigned to another account
- **WHEN** an account whose role is `inspector` requests the advance
- **THEN** the request is refused as forbidden
- **AND** `template_version_id` is unchanged

#### Scenario: The advance is audited with both versions

- **WHEN** an inspection bound to version `2` is advanced to version `3`
- **THEN** an audit log entry of type `inspection.version_advanced` is written for the
  inspection's `site_id` naming the acting account, the `scheduled_inspection_id`, the
  previous `template_version_id` and the new one

### Requirement: Each owed period of a requirement is planned on its own row

The system SHALL offer a `coordinator`, on each row of the annual plan, the operation
valid for that period and no other.

A period that has not been opened SHALL offer one action to open it, SHALL identify the
published `template_version` that the action will freeze, and SHALL NOT offer an inspector
until the period exists. An opened period whose status is `open` or `missed` SHALL offer the
eligible inspectors of the site and SHALL NOT send an assignment until the coordinator
confirms it. A completed period and a cancelled period SHALL be readable, carrying the
inspector and the `cancellation_reason` they hold, and SHALL offer no assignment.

Each row SHALL carry its own outcome. An operation SHALL be sent for one period at a time,
its pending state SHALL be shown on that row, and a failure SHALL retain the persisted
inspector and display the server's reason on that row alone, leaving the other rows
unchanged. The plan SHALL NOT hold unsaved rows behind a single confirmation of the whole
table.

Accounts without scheduling administration permission SHALL read every row, its status and
its inspector, without any of those controls.

#### Scenario: Opening a period does not assign anybody

- **GIVEN** a row for a period that has not been opened
- **WHEN** the coordinator opens it
- **THEN** the row's action identifies the published `template_version` it freezes
- **AND** the period is created with no `inspector_id`
- **AND** the row then offers the eligible inspectors

#### Scenario: Selecting an inspector does not immediately assign it

- **GIVEN** a row for an opened period and two eligible inspectors
- **WHEN** the coordinator selects a different `inspector_id` without confirming
- **THEN** no assignment request is sent
- **AND** a separate confirmation action remains available on that row

#### Scenario: A missed period can still be assigned

- **GIVEN** a row for a period whose `period_end` has passed with no inspection
- **WHEN** the coordinator opens the annual plan
- **THEN** the row offers the eligible inspectors
- **AND** it states that the period closed without an inspection and can still be submitted

#### Scenario: A completed period is read, not planned

- **GIVEN** a row for a period that carries a submitted inspection
- **WHEN** the coordinator opens the annual plan
- **THEN** the row shows the inspector who holds it and the completed status
- **AND** the row offers no inspector selection

#### Scenario: A cancelled period is read with its reason

- **GIVEN** a row whose only scheduled inspection has been cancelled
- **WHEN** the coordinator opens the annual plan
- **THEN** the row shows the cancelled status and the `cancellation_reason`
- **AND** the row offers no inspector selection

#### Scenario: A rejected assignment affects one row only

- **GIVEN** an annual plan whose rows carry different inspectors
- **WHEN** an assignment is rejected by the server for one period
- **THEN** that row displays the server's reason and keeps the persisted inspector
- **AND** the other rows keep their inspectors and offer their operations unchanged

#### Scenario: A reader cannot plan

- **WHEN** an account whose role is `inspector` opens the annual plan of a requirement
- **THEN** every owed period, its status and its inspector are readable
- **AND** no control to open a period or to assign an inspector is offered

### Requirement: Schedule requirements are configured as one focused operation

The system SHALL let a `coordinator` create an inspection requirement by selecting a published
`template_id`, `frequency_months`, an applicable `anchor_month` and an optional
`default_inspector_id` before confirmation. Before creation, the surface SHALL describe the annual
cadence produced by the selected frequency and anchor and SHALL state that `frequency_months` and
`anchor_month` cannot be changed later.

The surface SHALL present one current requirement per template. It SHALL let the coordinator change
`default_inspector_id`, deactivate an active requirement after confirming the consequence for future
periods, and reactivate a deactivated requirement. Accounts without scheduling administration
permission SHALL see the requirements without any of those controls.

Every listed requirement SHALL lead to its own annual plan, addressed by its
`inspection_schedule` identifier. The navigation SHALL be available to every reader,
including accounts without scheduling administration permission, and SHALL be offered for
deactivated and archived requirements as well as active ones.

#### Scenario: A requirement is created with a default inspector

- **GIVEN** a published template with no active rule for the selected site
- **WHEN** the coordinator creates a quarterly requirement with `anchor_month` `2` and an eligible
  `default_inspector_id`
- **THEN** the create request carries the selected `template_id`, `frequency_months`,
  `anchor_month` and `default_inspector_id`
- **AND** the new requirement describes periods beginning in February, May, August and November

#### Scenario: A monthly requirement does not request a meaningless anchor

- **WHEN** the coordinator selects `frequency_months` `1`
- **THEN** the requirement form does not ask the coordinator to choose an `anchor_month`
- **AND** the cadence preview states that one period begins every month

#### Scenario: Deactivation explains what remains unchanged

- **GIVEN** an active schedule requirement
- **WHEN** the coordinator chooses to deactivate it
- **THEN** the confirmation states that no future period will be opened from the requirement
- **AND** the confirmation states that periods already opened remain unchanged

#### Scenario: A reader cannot administer requirements

- **WHEN** an account whose role is `inspector` views the scheduling surface
- **THEN** the current requirements and their default inspectors are readable
- **AND** no control to create, update, deactivate or reactivate a requirement is offered
- **AND** each requirement still leads to its annual plan

#### Scenario: A listed requirement leads to its annual plan

- **GIVEN** the scheduling surface listing a current requirement
- **WHEN** the reader follows that requirement
- **THEN** the annual plan of that `inspection_schedule` identifier is presented

### Requirement: Period operations are exposed on demand from an annual entry

The system SHALL let a reader select an owed-period entry of the annual schedule to inspect its
period label, template, status and inspector without placing a form in every entry of that
schedule, which spans every requirement of the site across twelve months. For a
`coordinator`, the focused period view SHALL expose the operations valid for that entry: opening
an unopened period, confirming an inspector assignment, cancelling an eligible scheduled inspection
with a reason, or scheduling a cancelled period again. Other roles SHALL receive the same readable
detail without administrative controls.

Opening a period SHALL identify the currently published `template_version` that the operation will
freeze. Changing an inspector selection SHALL NOT send an assignment until the coordinator
explicitly confirms it. A failed assignment SHALL retain the persisted inspector and display the
server's reason.

#### Scenario: Selecting an unopened entry offers one opening operation

- **GIVEN** an owed period with no scheduled inspection
- **WHEN** the coordinator selects its annual entry
- **THEN** the focused view offers an optional `inspector_id` and one action to open the period
- **AND** it identifies the published `template_version` that will be frozen

#### Scenario: Selecting an inspector does not immediately assign it

- **GIVEN** an opened period and two eligible inspectors
- **WHEN** the coordinator selects a different `inspector_id` without confirming
- **THEN** no assignment request is sent
- **AND** a separate confirmation action remains available

#### Scenario: A cancelled period offers scheduling again

- **GIVEN** a cancelled scheduled inspection with a `cancellation_reason`
- **WHEN** the coordinator selects its annual entry
- **THEN** the focused view shows the cancellation reason
- **AND** it offers scheduling the period again rather than clearing the cancellation

#### Scenario: The annual entry keeps its form on demand

- **GIVEN** an annual schedule spanning several requirements and twelve months
- **WHEN** the coordinator views it
- **THEN** no entry of that schedule carries an inspector form of its own
- **AND** the operations of an entry remain reachable by selecting it

### Requirement: The coordinator can open an owed month ahead of the automatic job

The system SHALL let an account whose role is `coordinator` open a not-yet-opened month
directly from the year projection, creating the scheduled inspection for that `site_id`,
`template_id` and `period_start` and optionally naming its `inspector_id` in the same act. No
other role SHALL be offered or allowed that operation.

A period opened this way SHALL be indistinguishable from one the job opened, except that
`scheduled_by` names the coordinator rather than being null. The opening job SHALL NOT create a
second inspection when it later reaches that month.

The created inspection SHALL be bound to the highest published version of its template **at the
moment the coordinator opens it**, not at the moment the period begins, and that binding is
frozen thereafter. This is the stated cost of planning ahead, and it is why the automatic job is
not made to open months in advance: opening a month early freezes a template version early, and
the row cannot be corrected afterwards.

#### Scenario: Opening a future month from its empty entry

- **GIVEN** the year `2027` where no period is opened
- **WHEN** the coordinator opens the entry for `2027-04-01` and names an eligible inspector
- **THEN** a scheduled inspection exists for that site, template and `period_start`
- **AND** it carries that `inspector_id`
- **AND** the entry for April now reads as an opened period

#### Scenario: The job does not duplicate a period opened ahead

- **GIVEN** a scheduled inspection the coordinator opened for a month that has not begun
- **WHEN** that month becomes the current period and the opening job runs
- **THEN** exactly one non-cancelled scheduled inspection exists for that site, template and
  `period_start`

#### Scenario: A period opened ahead freezes today's version

- **GIVEN** a template whose highest published version is `2`
- **WHEN** the coordinator opens a period six months ahead
- **AND** version `3` of that template is published before the period begins
- **THEN** the scheduled inspection's `template_version` is still `2`

#### Scenario: An inspector is not offered the operation

- **WHEN** an account whose role is `inspector` views the year projection
- **THEN** no control to open a month is offered
- **AND** a request to create a scheduled inspection from that account is rejected as forbidden

### Requirement: A coordinator can make an assigned future period visible early

The system SHALL let an account whose role is `coordinator` advance `visible_early` from
`false` to `true` on an opened scheduled inspection whose `inspector_id` is non-null, whose
`period_start` is later than the current civil month, and which is neither cancelled nor
completed. The operation SHALL make that inspection appear in the assigned inspector's pending
list immediately. No other role SHALL be allowed the operation.

The scheduling surface SHALL offer this operation as `Make visible` only while those conditions
hold, SHALL require confirmation before sending it, and SHALL retain the persisted state with an
error inside the confirmation when the request fails.

#### Scenario: A future assignment becomes pending after confirmation

- **GIVEN** an opened scheduled inspection with `visible_early` equal to `false`, a non-null
  `inspector_id`, and a future `period_start`
- **WHEN** a `coordinator` confirms `Make visible`
- **THEN** `visible_early` becomes `true`
- **AND** the scheduled inspection appears in that inspector's pending list
- **AND** its year-plan row reads `Visible`

#### Scenario: An unassigned future period is not offered the operation

- **GIVEN** an opened scheduled inspection with a null `inspector_id` and a future `period_start`
- **WHEN** a `coordinator` opens its row menu
- **THEN** `Make visible` is not offered
- **AND** assigning an inspector remains available

#### Scenario: A closed inspection cannot change visibility

- **GIVEN** a scheduled inspection that is cancelled or completed
- **WHEN** a `coordinator` requests early visibility
- **THEN** the request is rejected
- **AND** `visible_early` is unchanged

#### Scenario: A non-coordinator cannot change visibility

- **WHEN** an account whose role is not `coordinator` requests early visibility
- **THEN** the request is rejected as forbidden
- **AND** `visible_early` is unchanged

#### Scenario: A failed confirmation remains attributable

- **GIVEN** a future assigned period whose persisted `visible_early` is `false`
- **WHEN** its early-visibility request fails
- **THEN** the confirmation remains open with the failure
- **AND** the year-plan row continues to read `Not visible`

### Requirement: Only the coordinator schedules, reassigns and cancels

The system SHALL restrict creating and deactivating schedule rules, scheduling an inspection
outside the automatic calendar, reassigning `inspector_id` and cancelling a scheduled inspection to
accounts whose role is `coordinator`. `inspector_id` SHALL reference an account that is not
deactivated and whose active site scope includes the inspection's `site_id`. The role SHALL NOT be
part of that question: every account of the closed set is on the committee, so there is no role a
scheduled inspection can be refused for. Every one of these operations SHALL be recorded in the
audit log with the acting account.

An account refused as `inspector_id` SHALL be refused for one of exactly two reasons, and the
refusal SHALL say which: the account does not exist or is deactivated, or it has no active scope
over the inspection's site.

#### Scenario: An inspector cannot reassign an inspection

- **WHEN** an account whose role is `inspector` requests a change of `inspector_id` on a
  scheduled inspection
- **THEN** the request is rejected as forbidden
- **AND** `inspector_id` is unchanged

#### Scenario: An inspector cannot create a schedule rule

- **WHEN** an account whose role is `inspector` requests the creation of a schedule rule
- **THEN** the request is rejected as forbidden

#### Scenario: An inspector without scope for the site is rejected

- **WHEN** the coordinator assigns as `inspector_id` an account whose role is `inspector` but
  whose active site scope does not include the inspection's `site_id`
- **THEN** the request is rejected and names the site the account lacks

#### Scenario: A deactivated account is rejected as inspector

- **WHEN** the coordinator assigns as `inspector_id` an account whose `deactivated_at` is non-null
- **THEN** the request is rejected and says the account does not exist or is deactivated

#### Scenario: A manager can be assigned an inspection

- **WHEN** the coordinator assigns as `inspector_id` a `management` account whose active site scope
  includes the inspection's `site_id`
- **THEN** the assignment is accepted
- **AND** the inspection appears among what that account still owes

#### Scenario: A coordinator can be assigned an inspection

- **WHEN** the coordinator assigns as `inspector_id` a `coordinator` account whose active site
  scope includes the inspection's `site_id`
- **THEN** the assignment is accepted
- **AND** the inspection appears among what that account still owes

#### Scenario: A promoted member stays assignable

- **GIVEN** an `inspector` account with active scope for the site
- **WHEN** that account is promoted to `coordinator`
- **AND** the coordinator assigns it as `inspector_id` of an inspection at that site
- **THEN** the assignment is accepted, with no act between the promotion and the assignment

#### Scenario: A reassignment is audited

- **WHEN** the coordinator changes `inspector_id` on a scheduled inspection
- **THEN** an audit log entry is written for the inspection's `site_id` naming the acting account,
  the previous `inspector_id` and the new one

### Requirement: The accounts eligible to be assigned an inspection at a site can be listed

The system SHALL expose, for a site, the accounts eligible to be named as `inspector_id` of a
scheduled inspection at that site: accounts that are not deactivated and whose `user_site_scope` for
that `site_id` has not been revoked. No role SHALL be excluded, because every account of the closed
set is on the committee.

The system SHALL determine that list with **the same predicate** it uses to validate an
assignment, so that every account the list offers is an account a reassignment accepts, and an
account a reassignment refuses as `inspector_invalid` never appears in the list.

The listing SHALL be restricted to administrative accounts, because it is the only
read that projects the account table and it exists solely to feed an operation that is already
the coordinator's alone. A request for a site outside the session's site scope SHALL be refused
and SHALL return no entry, and the endpoint SHALL apply that check itself, because `app_user` and
`user_site_scope` carry no site isolation policy to apply it for them.

Each entry SHALL carry the account's `id` — the value that travels as `inspector_id`, never the
`person.id` — together with `employee_number`, `first_name` and `last_name`. Those three SHALL be
nullable: eligibility is defined over `user_site_scope` while the name lives in `person`, which is
site-isolated and whose `site_id` is a separate mutable column, so an eligible account whose person
row is outside the reader's scope SHALL still be listed, without its name, rather than dropped.

#### Scenario: Every account offered is an account an assignment accepts

- **GIVEN** a site with a mix of accounts of several roles and scopes
- **WHEN** the eligible accounts for that site are listed
- **AND** each one is then assigned to a scheduled inspection of that site
- **THEN** every assignment is accepted

#### Scenario: An account refused as inspector is never offered

- **GIVEN** an account whose role is `inspector` but whose scope for the site has been revoked,
  and one that has been deactivated
- **WHEN** the eligible accounts for that site are listed
- **THEN** neither appears
- **AND** assigning either of them is refused with the code `inspector_invalid`

#### Scenario: A management account is offered

- **GIVEN** a `management` account with active scope for the site
- **WHEN** the eligible accounts for that site are listed
- **THEN** the account appears
- **AND** it stops appearing once its scope for that site is revoked

#### Scenario: A coordinator is offered

- **GIVEN** a `coordinator` account with active scope for the site
- **WHEN** the eligible accounts for that site are listed
- **THEN** the account appears

#### Scenario: An eligible account whose person row is out of scope is still offered

- **GIVEN** an account whose role is `inspector` with active scope for St. Thomas, whose `person`
  row belongs to Glencoe
- **WHEN** a coordinator whose scope covers only St. Thomas lists the eligible accounts
- **THEN** the account is listed with a null `first_name` and a null `last_name`
- **AND** assigning it to a St. Thomas inspection is accepted

#### Scenario: An inspector cannot list the eligible accounts

- **WHEN** an account whose role is `inspector` requests the eligible accounts of its own site
- **THEN** the request is rejected as forbidden

#### Scenario: A site outside the session scope returns nothing

- **WHEN** a coordinator whose scope covers only Glencoe requests the eligible accounts of
  St. Thomas
- **THEN** the request is refused
- **AND** no entry is returned

### Requirement: The coordinator is notified once per site for each opening run

The system SHALL notify every active coordinator with scope on a site when that run opened at least
one inspection there, deduplicated by site and by the month the run resolved. The notification
payload SHALL carry the period start, end and length of each opened inspection individually,
because rules of different frequencies opened by the same run cover different periods.

The notification SHALL be delivered in the application; the system SHALL NOT depend on outbound
email. At most one such notification SHALL exist per recipient, site and period, enforced by the
database, so that a repeated job run does not produce a second one. A recipient SHALL be able to
mark a notification as read, and `read_at` SHALL be the only value a notification ever changes.

`inspection_period_opened` SHALL be one of several notification kinds, and the shape of
`notification.payload` SHALL be determined by `kind`: a reader SHALL NOT assume that every
notification carries the period payload. A reader that does not recognise a `kind` SHALL fail
loudly rather than render an unknown payload, because the set of kinds is closed and adding one is
a change that has to state how it is shown.

#### Scenario: Opening a period notifies the coordinator

- **GIVEN** an active `coordinator` account whose site scope includes St. Thomas
- **WHEN** the opening job creates the St. Thomas inspection for the current period
- **THEN** a `notification` row exists for that account with `kind` `inspection_period_opened`
- **AND** its payload names the period and the inspections opened

#### Scenario: One notification lists inspections of different lengths

- **GIVEN** a monthly rule and a quarterly rule that both open in the same run
- **WHEN** the job runs
- **THEN** the coordinator receives one notification
- **AND** its payload lists both inspections, each with its own `period_start`, `period_end` and
  `period_months`

#### Scenario: A repeated run does not notify twice

- **WHEN** the opening job runs a second time in the same period
- **THEN** the coordinator still has exactly one `inspection_period_opened` notification for that
  site and period

#### Scenario: A job run that opens nothing notifies nobody

- **GIVEN** every rule of a site already has its inspection for the current period
- **WHEN** the opening job runs
- **THEN** no notification is created for that site

#### Scenario: A notification body cannot be rewritten

- **WHEN** any role attempts to update a notification's `payload`, `kind`, `user_id` or `site_id`
- **THEN** the statement fails
- **AND** setting `read_at` on the same row succeeds

#### Scenario: A coordinator outside the site scope is not notified

- **GIVEN** an active `coordinator` account whose site scope covers only Glencoe
- **WHEN** the opening job creates the St. Thomas inspection for the current period
- **THEN** no notification for St. Thomas is created for that account

#### Scenario: The inbox carries notifications of several kinds together

- **GIVEN** a coordinator with one `inspection_period_opened` notification and one
  `corrective_action_overdue_coordinator` notification
- **WHEN** the inbox is read
- **THEN** both are returned
- **AND** each carries the payload of its own `kind`

#### Scenario: An unknown kind is not silently rendered

- **WHEN** a notification whose `kind` is outside the closed list is read
- **THEN** the read fails rather than returning a notification with an unrecognised payload

### Requirement: An inspector can read back what they have completed

The system SHALL present to a signed-in account the scheduled inspections whose period was
completed, each identified by its month, its site and the date it was completed, ordered most
recent first within its inspection type. A `coordinator` or `management` account SHALL see
completed inspections for every site in its active site scope, while an `inspector` account
SHALL see only completed inspections assigned to that account. For administrative accounts, each
history row SHALL also identify the inspector who completed the inspection by the available
inspector name.

The home screen SHALL retain a way to reach the complete history. The history SHALL present one
named section per `template_id` for which a completed inspection is available to the account, and
each section SHALL contain the complete chronological list for that `template_id` on the same page.
The sections SHALL be ordered by inspection type name. For `coordinator` and `management`, the
history SHALL include completed inspections assigned to other accounts when those inspections
belong to a site in the account's active site scope.

This list SHALL be derived from the same definition of completion the scheduled inspections
listing already applies, so that a period cannot appear as completed on one screen and not on the
other. Drafts, incomplete periods, missed periods and cancelled periods SHALL NOT be presented as
completed history.

#### Scenario: Completed months of one type are listed newest first

- **GIVEN** an inspector who completed inspections with one `template_id` for `2027-05`, `2027-06` and `2027-07`
- **WHEN** the inspector views the complete history
- **THEN** the three are listed in the order `2027-07`, `2027-06`, `2027-05`
- **AND** each carries the date it was completed

#### Scenario: Completed inspections are grouped by stable type identity

- **GIVEN** an inspector who completed inspections under two template versions sharing one `template_id`
- **WHEN** the inspector views the complete history
- **THEN** one inspection type section is presented for that `template_id`
- **AND** its table includes both versions

#### Scenario: All inspection types are visible in one history

- **GIVEN** an inspector who completed inspections with two different `template_id` values
- **WHEN** the inspector views the complete history
- **THEN** one named table is presented for each `template_id`
- **AND** both tables are present without selecting an intermediate type entry
- **AND** each submitted inspection offers access to its report

#### Scenario: A coordinator reviews completed inspections in the active site scope

- **GIVEN** a `coordinator` whose active site scope contains a site where two inspectors each completed inspections
- **WHEN** the coordinator views the complete history
- **THEN** the history presents completed inspections assigned to both inspectors

#### Scenario: Management reviews completed inspections in the active site scope

- **GIVEN** a `management` account whose active site scope contains a site where another inspector completed an inspection
- **WHEN** management views the complete history
- **THEN** the completed inspection assigned to the other inspector is presented with access to its report

#### Scenario: Administrative history identifies the completing inspector

- **GIVEN** a `coordinator` or `management` account reviewing a completed inspection assigned to another account
- **WHEN** the account views the complete history
- **THEN** the inspection row presents the assigned inspector's name

#### Scenario: A completed inspection outside the active site scope is not listed

- **GIVEN** an administrative account whose active site scope excludes the site where an inspection was completed
- **WHEN** the account views the complete history
- **THEN** that inspection is not presented

#### Scenario: An outstanding month is not listed as completed

- **GIVEN** an inspector with an overdue assignment and no submission for it
- **WHEN** the inspector views the complete history
- **THEN** that month is not listed

### Requirement: Deactivated inspection requirements can be archived without changing obligations

The system SHALL allow a `coordinator` to archive an inspection requirement only when its
`deactivated_at` is non-null. Archiving SHALL set `archived_at`, SHALL NOT delete the
`inspection_schedule` row, and SHALL NOT change the periods the rule produced or the months it
historically owed. An attempt to archive an active requirement SHALL be refused with a stated
reason.

#### Scenario: A deactivated requirement is archived

- **GIVEN** an inspection requirement whose `deactivated_at` is non-null and whose `archived_at`
  is null
- **WHEN** a `coordinator` archives the requirement
- **THEN** its `archived_at` is set
- **AND** its `deactivated_at` and existing scheduled inspections are unchanged

#### Scenario: An active requirement cannot be archived

- **GIVEN** an inspection requirement whose `deactivated_at` is null
- **WHEN** a `coordinator` attempts to archive it
- **THEN** the request is refused with a stated reason
- **AND** its `archived_at` remains null

#### Scenario: Archiving does not rewrite the annual schedule

- **GIVEN** a deactivated requirement that historically owed periods in the selected year
- **WHEN** the requirement is archived
- **THEN** those periods remain in the annual schedule projection
- **AND** existing scheduled inspections remain visible

### Requirement: Archived inspection requirements are hidden by default and can be restored

The scheduling surface SHALL omit requirements whose `archived_at` is non-null from the default
requirements table. It SHALL offer a `coordinator` a control to show archived requirements,
identify them as `Archived`, and restore one when no other non-archived requirement exists for the
same `site_id` and `template_id`. Restoration SHALL clear `archived_at` while leaving
`deactivated_at` non-null. Accounts without scheduling administration permission SHALL NOT receive
archive or restore controls.

#### Scenario: Archived requirements are hidden by default

- **GIVEN** the selected site has one current requirement and one requirement whose `archived_at`
  is non-null
- **WHEN** the scheduling surface opens
- **THEN** the current requirement is shown
- **AND** the archived requirement is omitted

#### Scenario: A coordinator shows and restores an archived requirement

- **GIVEN** an archived requirement with no other non-archived requirement for the same `site_id`
  and `template_id`
- **WHEN** a `coordinator` shows archived requirements and restores it
- **THEN** its `archived_at` is cleared
- **AND** its `deactivated_at` remains non-null
- **AND** it returns to the default table as `Deactivated`

#### Scenario: A superseded archived requirement cannot be restored

- **GIVEN** an archived requirement and another non-archived requirement with the same `site_id`
  and `template_id`
- **WHEN** a `coordinator` attempts to restore the archived requirement
- **THEN** the request is refused with a stated reason
- **AND** its `archived_at` remains set

#### Scenario: A reader cannot archive or restore requirements

- **WHEN** an account without scheduling administration permission shows the requirements table
- **THEN** the table does not offer archive or restore controls

## ADDED Requirements

### Requirement: The account assigned to an inspection is labelled by the assignment, not by a role

The system SHALL label the account referenced by `inspection.inspector_id` as **Assigned to** wherever
the scheduling console, the annual plan of a requirement and the period dialog show that account or
offer the control that chooses it. Those surfaces SHALL NOT label it "Inspector", because `inspector`
names a role and the assigned account MAY hold any of the three roles.

The field `inspector_id`, the endpoint that lists the accounts eligible to be assigned, and the rule
that decides eligibility SHALL be unchanged by this label.

#### Scenario: A coordinator assigned to a period is not shown under a role name

- **GIVEN** a scheduled inspection whose `inspector_id` references an active `coordinator` account
- **WHEN** a coordinator views that period in the annual plan and in its period dialog
- **THEN** the account is shown under the label `Assigned to`
- **AND** no column, field or control of those views is labelled `Inspector`

#### Scenario: The assignment control carries the same label

- **GIVEN** an opened period that can be assigned
- **WHEN** a coordinator opens the operation that chooses its account
- **THEN** the control that selects the account is labelled `Assigned to`
