## Context

See `proposal.md` for motivation. The current state that matters:

- `person` has `ENABLE` and `FORCE ROW LEVEL SECURITY`, and one permissive policy,
  `person_site_isolation`, for every command (`*`):
  `site_id = ANY (string_to_array(current_setting('app.site_ids', true), ',')::uuid[])`.
- `app_user` and `user_site_scope` have no RLS, and `hs_app` has `SELECT` on both (0005).
- `findRoster` (`apps/api/src/roster/roster.repository.ts`) reads
  `person p LEFT JOIN app_user u … WHERE p.site_id = $1`. `$1` selects a site within the scope; it
  is not a security boundary (ADR-002).
- The per-person writes lock `person` before writing. They use `SELECT … FOR UPDATE` in
  `deactivatePerson` and `updatePerson`, and `FOR KEY SHARE` in `account.service.ts` (promote,
  demote, reissue, remove access).
- The other reads of `person` either filter by `site_id = $1` (the incident and finding pickers)
  or compare `row.site_id !== siteId` after reading by `id` (the action and incident assignee
  validations).

**Tables touched:** `person` (partially mutable). A policy is added; no column, grant, trigger or
existing policy changes. No immutable table is touched.

## Goals / Non-Goals

**Goals:**
- A site's People list shows the management accounts that hold scope over that site, for everyone
  who can read that list.
- The database enforces that such a row cannot be modified from a site that is not the person's
  own.

**Non-Goals:**
- Per-site roles. The role is still a single value on `app_user`.
- Listing coordinators or inspectors outside their home site. The exception covers `management`
  only, as requested.
- Offering the management person from another site in the pickers (incident subject, finding
  assignee). Those pickers keep filtering by the site of the record.
- Editing a management person from a site that is not their own.

## Decisions

### D1 — A second permissive `SELECT` policy on `person`, not a wider `person_site_isolation`

Migration `0051` adds:

```sql
CREATE POLICY person_management_scope_read ON person
  FOR SELECT
  USING (EXISTS (
    SELECT 1
      FROM app_user u
      JOIN user_site_scope s ON s.user_id = u.id
     WHERE u.person_id = person.id
       AND u.role = 'management'
       AND hs_account_is_active(u)
       AND s.revoked_at IS NULL
       AND s.site_id = ANY (string_to_array(current_setting('app.site_ids', true), ',')::uuid[])
  ));
```

Permissive policies are combined with OR, so a `SELECT` sees a row if either policy accepts it. A
`SELECT … FOR UPDATE` or `FOR KEY SHARE` also has to pass the `UPDATE` policies, and only
`person_site_isolation` applies to `UPDATE`. A lock over a management person from another site
therefore finds no row, and the existing services answer "not found / not in your scope" without
any change. Read-only is enforced by the database, as ADR-002 and ADR-004 require, not only by the
UI.

Alternative considered: `ALTER POLICY person_site_isolation` to add the `OR EXISTS …`. That
policy covers every command, so the change would also open `UPDATE` and the locks, which is the
opposite of read-only. Rejected.

Alternative considered: a `SECURITY DEFINER` function that returns the management people of one
site. `FORCE ROW LEVEL SECURITY` applies to the owner as well, so the function would still need to
alter `app.site_ids` inside itself. That scope would be built by hand, which ADR-011 rules out.
Rejected.

The policy uses `hs_account_is_active(u)` (0046: `deactivated_at IS NULL`), the same predicate
that `findRoster` and `findAccountDetail` use. A deactivated management account stops being
visible outside its site, just as it stops being able to act there. The function is `STABLE` and
reads nothing but its argument, so calling it inside the policy does not recurse and needs no
extra grant.

### D2 — `findRoster` widens its selection clause, and not its security

```sql
WHERE (p.site_id = $1
       OR EXISTS (SELECT 1 FROM user_site_scope s
                   WHERE s.user_id = u.id AND s.site_id = $1 AND s.revoked_at IS NULL
                     AND u.role = 'management' AND hs_account_is_active(u)))
```

This clause does not decide who can see what; RLS still does (D1). It only says which rows make up
the list for `$1`. A person with scope over several sites appears once per list, because the query
reads `person`, which has one row per person.

### D3 — A site outside the scope answers `[]` in the service

A coordinator whose scope is only Glencoe can read the St. Thomas management person under D1.
Without a check, `GET /people?site_id=<st-thomas>` would return that single person as "the People
list of St. Thomas", a list that coordinator has no right to. The requirement "A site outside the
scope returns nothing" breaks. `RosterService.list` returns `[]` when
`!session.siteIds.includes(query.site_id)`. `create` already makes the same explicit check, and
`listInspectorCandidates` does too.

This is not the site isolation: the rows it would hide are ones RLS already lets that coordinator
read through the Glencoe list. It is the consistency of the list with the site it names.

### D4 — "Foreign row" is `person.site_id !== siteId`, computed on the client

No contract field is added. `PersonWithAccount.site_id` is already the home site, and the console
already knows the selected site. Two pure functions go into `RosterRoute/presentation.ts`:
`isBasedElsewhere(person, siteId)` and `basedAtLabel(siteName)`, which returns "Based at <site>".
`rowActions` gets `siteId` and returns `[]` for a foreign row. `RosterTable` hides the "More
actions" button when the list is empty, which is already how a row with no action is shown, and
adds the "Based at …" line under the name.

The summary counts stay over the whole list (`rosterCounts(all)`), including those rows, because
the counts describe what the list shows.

## Risks / Trade-offs

- [The management person now resolves in other reads of `person` from other sites. The action
  assignee name, the incident witness, and `GET /accounts/:id` show their name and account.] →
  Accepted. That is the same information the People list now shows. The writes stay refused by
  D1, and the pickers do not offer them because they filter by `site_id`.
- [Validation error text changes. Assigning the management person from another site now fails
  with "works at another site" instead of "not a person within your scope".] → Both are 4xx
  answers with the same outcome. No test asserts on that text for this case.
- [Policy cost: an `EXISTS` per row of `person` that the first policy rejects.] → About 200
  people, indexed by `app_user.person_id` (unique) and `user_site_scope_active_idx`. It is
  negligible.
- [Future pressure to include coordinators too.] → The role is written into the policy on
  purpose. Widening it is a spec change, not a constant.

## Migration Plan

`0051_management_visible_across_scope.sql`, written by hand (never `drizzle-kit generate`), is
additive. Rollback is `DROP POLICY person_management_scope_read ON person;` in a later migration.
The code in D2 and D3 still works without the policy: the other-site rows simply do not appear.
