## Why

Coordinators can add a worker individually but currently cannot correct that action without preparing and importing a complete roster CSV. Allowing an active person shown as a Worker, meaning they have no active account, to be retired from their row closes that operational gap while preserving historical references and database-enforced immutability.

## What Changes

- Allow an H&S coordinator to deactivate an active person with no active account from the roster row after explicit confirmation.
- Add a person-specific deactivation endpoint that sets `person.deactivated_at` and relies on site RLS and the existing database audit trigger.
- Remove the deactivated person from the default active roster after success.
- Refuse the operation for people with an active account, inactive people, callers outside the person's site scope, and roles other than `hs_coordinator`.
- Keep rename, transfer, reactivation, and physical deletion unavailable as row-level actions.
- This extends the Stage 2 identity and roster administration work in requisitos-v1.2 §7; it does not close a new stage because Stage 2 is already implemented.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity`: Permit narrowly scoped row-level deactivation of an active person who has no active account.

## Impact

- `openspec/specs/identity/spec.md` changes from CSV-only person deactivation to a constrained worker deactivation operation.
- `packages/contracts` gains the deactivation request/response contract if required by the HTTP shape.
- `apps/api/src/roster` gains the endpoint, service rule, and repository update; the existing person audit trigger remains the audit source.
- `apps/web/src/api/roster.ts` and `apps/web/src/routes/RosterRoute/` gain the mutation, row action, confirmation dialog, cache invalidation, and tests.
- No schema migration or new dependency is required because `person.deactivated_at`, its update privilege, RLS, and audit trigger already exist.
