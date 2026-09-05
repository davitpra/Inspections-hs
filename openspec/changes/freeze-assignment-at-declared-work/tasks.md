## 1. Domain Decision And Persistence

- [x] 1.1 Add the ADR that supersedes ADR-020 and defines the declaration of work done as the assignment freeze boundary.
- [x] 1.2 Add the handwritten SQL migration that replaces the guard body, stating that grants, revokes and RLS are unchanged and that no data is converted.
- [x] 1.3 Update the Drizzle schema comments to match the migrated boundary.

## 2. Contracts And API

- [x] 2.1 Publish the editable-state list and its predicate from `packages/contracts`.
- [x] 2.2 Apply the shared predicate in the replacement service and restate the refusal message.

## 3. Findings User Interface

- [x] 3.1 Decide `Edit assignment` on the action state through the shared predicate, so Verification offers the step without the editor.

## 4. Verification

- [x] 4.1 Update integration tests for the engine and service refusal from `awaiting_verification`, the reopening of editing after refusal, and the race between editing and declaring the work done.
- [x] 4.2 Update route and presentation tests for a Verification step with no assignment editor.
- [ ] 4.3 Run OpenSpec validation, build before typecheck, lint, unit tests and focused PostgreSQL integration tests.
