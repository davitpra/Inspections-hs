## 1. Data Access

- [x] 1.1 Add the parsed `GET /findings` web client and its focused unit test.
- [x] 1.2 Add the shared findings query key and cover its cache-key shape.
- [x] 1.3 Type `createAction` with the shared creation request contract instead of a duplicate inline shape.

## 2. Decisions and Presentation

- [x] 2.1 Add and test the pure `canCreateAction` coordinator predicate in `permissions/actions.ts`.
- [x] 2.2 Add route-local presentation functions that retain every finding, count its existing actions,
  and order the findings deterministically; cover zero, one, and several actions per finding.
- [x] 2.3 Add and test the route-local deadline conversion and validation used by the form.

## 3. Findings Creation UI

- [x] 3.1 Build the route-local findings table with action counts, independent loading/error/empty states,
  and creation controls conditioned by `canCreateAction`.
- [x] 3.2 Build the route-local creation form that loads the selected finding's active site roster,
  validates `assignee_person_id`, `description`, and future `due_at`, and preserves input on failure.
- [x] 3.3 Wire the creation mutation to prevent duplicate submission, invalidate the actions query on
  success, close the form, and expose roster and server failures without optimistic action data.
- [x] 3.4 Compose findings and existing action groups in `ActionsRoute`, keeping either section usable
  when the other query fails and updating the English page guidance.

## 4. Verification

- [x] 4.1 Add route integration tests for a zero-action finding, repeated action creation, site-specific
  assignees, non-coordinator read-only behavior, successful refresh, duplicate prevention, and
  rejected creation with preserved fields.
- [x] 4.2 Run focused web tests for API clients, query keys, permissions, presentation, and
  `ActionsRoute`, and fix all failures.
- [x] 4.3 Run `pnpm lint`, `pnpm -r build`, `pnpm typecheck`, and `pnpm test`; document any unrelated
  pre-existing failure that remains.
