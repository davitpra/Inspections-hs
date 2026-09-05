## Why

The Closed finding stage proves that corrective work was accepted, but it currently withholds the
before/after photographs on which that decision was based. Readers need to inspect the accepted
evidence from the same read-only lifecycle record instead of seeing only counts in Verification.

This change does not close a new stage of `requisitos-v1.2` §7; it completes the existing corrective
action read-back by making already-recorded evidence actually reviewable after closure.

## What Changes

- Present the photographs from the final work-completion declaration accepted by each closure,
  grouped as Before and After in the Closed stage.
- Exclude evidence from completion declarations that were subsequently rejected.
- Issue short-lived, authenticated download URLs only after the evidence row is read within the
  requester's site scope.
- Keep closure readable when the accepted declaration contains no photographs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `findings`: Closed lifecycle records expose the before/after photographs accepted by the final
  verification decision.
- `actions`: Site-scoped readers can obtain short-lived download URLs for recorded corrective-action
  evidence.

## Impact

- `packages/contracts`: signed evidence-download response.
- `apps/api/src/uploads`: scoped evidence lookup and presigned S3 GET support.
- `apps/web/src/api/actions.ts`: evidence download client.
- `apps/web/src/routes/InspectionFindingsRoute`: accepted-evidence selection and responsive gallery.
- S3 application policy: add `GetObject` while retaining no delete permission.
