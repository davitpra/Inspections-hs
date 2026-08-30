## Context

See `proposal.md` for the motivation. The current web application registers three online-only
routes for corrective actions, while `InspectionFindingsRoute` already reads summaries, creates
actions, performs transitions and loads action details by reached lifecycle stage. The current
stage panel renders those details as a technical event stream, even though the reader's question
is what was decided through the `Next step` controls. The two surfaces share API clients, query
keys and transition controls, but no longer need to share event rendering.

ADR-008 keeps `actions` as a domain module and permits `findings` to consume its readings through
the existing application composition. ADR-002 and ADR-004 govern the immutable, site-scoped
records that remain unchanged. This change does not touch an immutable table or any other table.

## Goals / Non-Goals

**Goals:**

- Remove every routable and navigational frontend surface under `/actions`.
- Preserve the complete inspection-finding workflow and present the decisions taken in every
  reached stage in `findings/$id`.
- Remove only code and styles proven exclusive to the retired routes.

**Non-Goals:**

- Removing or reducing the corrective-actions domain, API, contracts or database model.
- Designing a replacement UI for actions from investigations or manual findings.
- Redirecting or preserving old route compatibility.
- Redesigning the broad `GET /actions` projection used by the findings screen.
- Changing immutable events or introducing a second persisted decision record.

## Decisions

### Remove routes rather than hide navigation

The router definitions, route folders and navigation metadata are removed together. A hidden
workspace would preserve an accidental product surface and its maintenance cost. Redirects were
considered, but an action does not always map to an inspection finding and silently choosing a
partial destination would be incorrect.

### Keep action reads and writes shared by findings

`GET /actions` remains the source of summaries grouped by finding, and `GET /actions/:id` remains
the source loaded on demand for reached-stage decisions. The event records remain the immutable
source, but a pure presentation projection translates them into the business acts exposed by
`FindingNextStep`: creating the commitment, starting or resuming work, declaring work done, and
verifying or returning it. Introducing finding-specific endpoints or persisted decision rows was
considered, but either would expand a frontend change into an API or schema redesign and duplicate
facts already recorded under ADR-002 and ADR-004.

The projection associates each destination with the finding stage it affected, but its output is
not an event-shaped object. It carries the decision label and only the values the corresponding
control submitted:

- Raised reads observation facts directly from the finding and does not load actions.
- Assigned reads the created commitment's responsible person, description and deadline.
- In progress names work starting when no values were requested, identifies automatic start as an
  outcome of the created commitment, or presents a verification return with its required reason
  and optional note.
- Verification names the declaration that work was done, with optional note and before/after
  evidence counts.
- Closed names verification and includes its optional note.

The automatic `open` to `in_progress` event written during creation lets In progress state that the
commitment put the work under way, but it is not presented as a second user decision: the created
commitment is one act. Historical actions that really required `Start work` remain readable as
that decision. Multiple actions and repeated passes through a stage are merged by recorded order
without collapsing entries.

### Remove event presentation at the route boundary

The independent history card, deadline summary, escalation summary and progress panel are
removed. `ActionTransitionForm`, the evidence picker, transition labels and permission decisions
remain because the findings lifecycle consumes them directly. `FindingStageRecord` remains the
tabpanel shell and owns the Raised facts plus the new decision presentation. Its `StageEvents`
child and `eventsInStage` helper are removed; a pure stage-decision projection lives in the route's
`presentation.ts` with focused tests.

`ActionEventList` and its timeline styles are removed if tracing imports after route deletion
proves that nothing else consumes them. Decision markup and styles use the finding route's
namespace rather than retaining `action-detail` names from a deleted screen.

### Keep the stage panel lazy and read-only

Opening Raised makes no action request. Opening another reached stage requests all actions tied to
the finding through their existing `queryKeys.action(id)` entries, exactly when the panel needs
their immutable details. A failed detail read produces one connection warning and never an empty
decision claim. Selecting a past stage changes only the tabpanel; `finding.state` and the current
`Next step` remain authoritative and no transition is rendered in a past panel.

### Accept no UI for non-inspection parents

Actions tied to investigations and manual findings remain valid persisted domain records and
continue to participate in incident closure, escalation, notification and audit workflows. This
change deliberately provides no v1 application route for reading them.

## Risks / Trade-offs

- [Existing bookmarks and shared action URLs return not found] -> Treat this as the explicit
  breaking behavior; do not add ambiguous redirects.
- [Shared code is mistaken for route-owned code] -> Trace imports and retain API clients, query
  keys, transitions, permissions and styles consumed by findings; remove event rendering only
  after the decision projection replaces its last use.
- [Automatic creation events appear as two user decisions] -> Collapse the creation pair into the
  single commitment the user submitted, while retaining manual starts for historical `open`
  actions.
- [A verification return overwrites the original start] -> Keep every projected decision and sort
  repeated and parallel entries by recorded event order.
- [Dirty worktree changes overlap the cleanup] -> Apply narrow edits and never replace or revert
  unrelated lifecycle work already present.
- [Non-inspection actions become invisible in the UI] -> Preserve all server behavior and record
  the deliberate product limitation in the specs.

## Migration Plan

1. Deploy the static client without the route definitions and navigation entry.
2. Leave the API and database deployment unchanged.
3. Verify inspection findings can create, advance and read submitted decisions by reached stage
   inline, without an event timeline.

Rollback consists of restoring the frontend route registrations and their exclusive components;
no data rollback or migration is required.
