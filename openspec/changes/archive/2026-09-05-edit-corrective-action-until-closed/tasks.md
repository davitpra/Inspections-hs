## 1. Domain Decision And Persistence

- [x] 1.1 Add the ADR that supersedes ADR-018 and defines closure as the assignment freeze boundary.
- [x] 1.2 Add the handwritten SQL migration that consolidates development amendments, retires their table, installs the conditional action guard with exact REVOKE/GRANT rules, preserves RLS, captures the closing snapshot, and supports notification withdrawal.
- [x] 1.3 Update the Drizzle schema to match the migrated action and notification tables.

## 2. Contracts And API

- [x] 2.1 Replace amendment/history contracts with the complete assignment replacement request and current-only action detail.
- [x] 2.2 Replace the amendment repository/service/controller flow with `PUT /actions/:id/assignment`, preserving authorization, validation and closure locking.
- [x] 2.3 Simplify action, transition, notification and escalation queries to read current fields directly and withdraw stale assignee inbox items.

## 3. Findings User Interface

- [x] 3.1 Present only the current assignment in the Assigned record and remove history labels and styles.
- [x] 3.2 Offer the assignment editor to authorized readers in every non-closed finding state and refresh all affected readings after replacement.

## 4. Verification

- [x] 4.1 Update contract, repository, service and integration tests for replacement, engine freeze, closing audit snapshot, escalation preservation and notification withdrawal.
- [x] 4.2 Update route and permission tests for current-only presentation and editing through verification.
- [x] 4.3 Run OpenSpec validation, build before typecheck, lint, unit tests and focused PostgreSQL integration tests.
