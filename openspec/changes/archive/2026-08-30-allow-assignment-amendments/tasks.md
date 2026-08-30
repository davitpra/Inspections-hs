## 1. Decision and contracts

- [x] 1.1 Record ADR-018 for append-only assignment amendments and the explicit start boundary.
- [x] 1.2 Add amendment request, history and effective commitment contracts with unit tests.

## 2. Persistence

- [x] 2.1 Add the Drizzle schema mirror and SQL migration for the immutable amendment table, including audit, RLS, REVOKE and grants.
- [x] 2.2 Add repository writes and effective-value/history projections with concurrency protection.

## 3. API behavior

- [x] 3.1 Stop automatic `open` to `in_progress` creation and expose the amendment command.
- [x] 3.2 Enforce parent-equivalent authorization, open-state validation, roster validation and effective-assignee transition authorization.
- [x] 3.3 Use the effective deadline for escalation and notify newly assigned people.
- [x] 3.4 Cover creation, amendments, authorization, concurrency, RLS and engine-enforced immutability in integration tests.

## 4. Findings interface

- [x] 4.1 Add the amendment API client and permission predicate.
- [x] 4.2 Add the inline `Edit assignment` form with current values, validation, focus handling and cache invalidation.
- [x] 4.3 Present original and amended commitments in the read-only Assigned record.
- [x] 4.4 Update route and presentation tests for the persistent Assigned stage and editing boundary.

## 5. Verification

- [x] 5.1 Validate the OpenSpec change strictly.
- [x] 5.2 Run lint, recursive build, typecheck, unit tests and corrective-action integration tests.
