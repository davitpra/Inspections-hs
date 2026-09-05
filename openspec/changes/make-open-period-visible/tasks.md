## 1. Database And API

- [x] 1.1 Add migration `0045` with column-scoped UPDATE permission, unchanged RLS, monotonic and closed-record guards, and `inspection.visibility_advanced` auditing.
- [x] 1.2 Add the coordinator-only make-visible service operation and action endpoint returning the persisted `ScheduledInspection`.
- [x] 1.3 Add API and PostgreSQL integration coverage for success, role, site scope, assignment, closed records, reversal and audit behavior.

## 2. Scheduling UI

- [x] 2.1 Add the web API call and pure eligibility rule for `Make visible`.
- [x] 2.2 Add the route-owned confirmation dialog with pending, success and attributable error states.
- [x] 2.3 Add `Make visible` to eligible period row menus and refresh scheduled and pending readings after success.
- [x] 2.4 Cover menu eligibility, confirmation, mutation and failure behavior in presentation and route tests.

## 3. Verification

- [ ] 3.1 Build packages before typecheck, run lint and unit tests, and run the relevant Postgres integration suites.
