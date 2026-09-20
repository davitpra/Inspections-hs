## 1. Schema

- [x] 1.1 Create `apps/api/drizzle/0051_management_visible_across_scope.sql`, written by hand after `0050_administrator_verifier_exception` and registered in `meta/_journal.json`. It holds `CREATE POLICY person_management_scope_read ON person FOR SELECT USING (EXISTS …)` as in design D1 (`role = 'management'`, `hs_account_is_active(u)`, unrevoked `user_site_scope` for a site in `app.site_ids`). It must not alter `person_site_isolation`, add grants, lift any REVOKE or change RLS on any other table.
- [x] 1.2 Add the new policy to the header of the migration: why it is `SELECT` only, why `person_site_isolation` is not widened, and that it touches no immutable table.
- [x] 1.3 Integration test (`apps/api/test/identity.int-spec.ts`). A transaction with scope `glencoe` only sees the St. Thomas management person and no other St. Thomas person. The same person disappears when the account is deactivated or not `management`, or when its `glencoe` scope row is revoked.
- [x] 1.4 Integration test with the same scope: `UPDATE person` over that person affects 0 rows, and `SELECT … FOR UPDATE` and `SELECT … FOR KEY SHARE` return no row. Also check that the owner role sees the same as `hs_app`, because of `FORCE`.

## 2. API

- [x] 2.1 In `apps/api/src/roster/roster.repository.ts` (`findRoster`), widen the selection clause as in design D2 (`p.site_id = $1 OR EXISTS …` over `user_site_scope` for `$1`, `role = 'management'`, `hs_account_is_active(u)`). Update the header comment to explain that the clause selects rows and RLS still isolates them.
- [x] 2.2 In `roster.service.ts` (`list`), return `[]` when `query.site_id` is not in `session.siteIds` (design D3), with a comment that explains why this is not site isolation.
- [x] 2.3 Integration test for `GET /people`. A coordinator whose scope is only Glencoe gets the St. Thomas management person in Glencoe's list, with `site_id` from St. Thomas and `role` `management`. That same coordinator gets `[]` for St. Thomas. A management person with scope over both sites appears once in each list. A revoked scope makes the person disappear from Glencoe's list.
- [x] 2.4 Integration test: from a Glencoe-only scope, `PATCH /people/:id` and the account writes (promote, demote, remove access, reissue) over the St. Thomas management person are refused, with nothing written.

## 3. People console

- [x] 3.1 In `apps/web/src/routes/RosterRoute/presentation.ts`, add `isBasedElsewhere(person, siteId)` and `basedAtLabel(siteName)` ("Based at <site>"). Change `rowActions` so it receives `siteId` and returns `[]` for a row based at another site.
- [x] 3.2 Add tests for those functions to `presentation.test.ts`: a row based elsewhere offers no actions even with all permissions, and a row from the selected site keeps its current actions.
- [x] 3.3 In `RosterTable.tsx`, pass `siteId` (and a `siteName` resolver) from `index.tsx`. Show "Based at …" under the name of a row based elsewhere. The actions menu is already hidden when `rowActions` returns `[]`.
- [x] 3.4 Add a case to `index.test.tsx`: the roster for Glencoe includes a `management` person with `site_id` from St. Thomas. That person shows "Based at St. Thomas" and no "More actions" button, and the counts include them.
