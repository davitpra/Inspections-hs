## Why

The People list of a site shows only the people whose `person.site_id` is that site. A
`management` account holds the same role on every site of its scope, but its person belongs to one
site, so it shows up only in that site's list. In the local data, Alex (`management`, scope over
St. Thomas and Glencoe, person at St. Thomas) is missing from Glencoe's People list, even though
they have management authority there. Because of `person_site_isolation`, a coordinator whose scope
is only Glencoe cannot even find out who holds management authority over their site.

This closes no stage of `Requisitos_V1.2.md` §7. It extends stage 2 (Sitio, Persona, Usuario and
the roster), which is already implemented: the People console shows who can act at a site, not
only who is on that site's roster file.

## What Changes

- The People list of a site (`GET /people?site_id=…`) also returns every person whose account has
  role `management`, is active (`deactivated_at IS NULL`) and holds an active `user_site_scope` row for that site, even when
  the person belongs to another site. Their row keeps the real `site_id`, which is their home site.
- Everyone who can read that site's People list sees those rows, including a coordinator whose
  scope does not contain the home site of the management person.
- Visibility is widened by a new `SELECT`-only row-level security policy on `person`, not by a
  filter in the endpoint. The existing `person_site_isolation` policy stays as it is, and it still
  governs every write and every row lock (`FOR UPDATE`, `FOR KEY SHARE`). A management person
  outside the home site can therefore be read and never modified from a site that is not theirs.
- In the console, a row whose `site_id` is not the selected site is read-only: it has no actions
  menu, and it names the person's home site ("Based at St. Thomas"). Editing, promoting, demoting
  and removing access are still done from the home site.
- The summary counts ("People at this site", "With app access", "Invited") include those rows,
  because they describe the list shown.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity`: a person is still isolated by site, with one exception. A person whose active
  `management` account holds active scope on a site can be read, but not written, from a
  transaction whose scope contains that site. The People list of a site includes those people and
  marks them as based elsewhere.

## Impact

**Schema.** New migration `0051_management_visible_across_scope.sql`. It adds the permissive
policy `person_management_scope_read` `FOR SELECT` on `person`, which reads `app_user` and
`user_site_scope`. `hs_app` already has `SELECT` on both tables, and neither has RLS, so the policy
cannot recurse. It adds no grants, alters no table and does not touch `person_site_isolation`.

**Other reads of `person`.** The site pickers (incidents, findings) and the assignee validations
(actions, incidents) already filter or compare `site_id` explicitly, so what they offer or accept
stays the same. Only the error text changes for a management person from another site: "works at
another site" instead of "not within your scope". Joins that resolve a name (the assignee of an
action, the witness of an incident) now resolve that person's name where they used to get none.
`GET /accounts/:id` can now return the account of a visible management person. The writes over
that account (promote, demote, reissue, remove access) are still refused, because they lock
`person`.

**Contracts.** None. `PersonWithAccount` already carries `site_id`.

**API.** `apps/api/src/roster/roster.repository.ts` (`findRoster`).

**Web.** `RosterRoute` (`presentation.ts`, `RosterTable.tsx`).

**Tests.** `apps/api/test/identity.int-spec.ts` (the new policy, including that writes and locks
still fail) and the roster tests. On the web side, `presentation.test.ts` and `index.test.tsx`.

**Docs.** None. ADR-002 still holds: the isolation is still expressed as RLS.
