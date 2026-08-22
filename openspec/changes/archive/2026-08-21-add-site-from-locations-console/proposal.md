## Why

A workplace can only come into existence through a SQL seed file run as the migration role. The
`site` table was deliberately closed to the application in `0004_site_location_catalog.sql` §6 —
"`site` se siembra: la API solo lee. Las dos plantas no son un dato que se cree desde una
pantalla." — and nothing since has reopened it. Opening a third plant therefore requires a
developer, a migration-role connection and a deploy.

This closes the remaining registration gap of stage 2 of requirements-v1.2 §7 (Site, Person, User,
auth): the stage built the site as an entity and built its scope, but left the registration of a
site outside the application. It is the same kind of gap that the roster administration console and
the shared-location retirement closed for their own populations.

The Locations console is where this belongs. It is the only screen that renders the plants as
columns, so it is the only place where "this organization has another plant now" is an observable
change rather than an invisible one.

## What Changes

- Reverse, narrowly, the `REVOKE INSERT ON site FROM hs_app` decision recorded in
  `0004_site_location_catalog.sql` §6: grant `INSERT` on `site` to the application role, and
  nothing else.
- Add a coordinator-only `POST /sites` that registers an active `site` from a `code` and a `name`.
- Grant the registering account scope over the new site in the same transaction, so the plant is
  visible to the coordinator who created it instead of being born unreachable.
- Audit the registration in the engine: a new `site.created` entry written by a trigger, in the
  audit chain of the site itself.
- Add an `Add site` control and its registration form to the Locations console header, beside the
  existing `Add location` control.
- Do not grant `UPDATE` or `DELETE` on `site`, do not add a row-level security policy to `site`,
  and do not administer any other account's scope from this console.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `catalog`: An HS coordinator can register a new site from the console, the registration is
  recorded in the audit chain, and the seed files load the initial sites rather than the only ones
  the system can hold.
- `identity`: Registering a site grants that site's scope to the account that registered it, in the
  same transaction.

## Impact

- `packages/contracts` gains the strict site-registration request schema and its export.
- `apps/api` gains `POST /sites`, the coordinator authorization that `SitesService` does not have
  today, and the transactional registration that declares the new site's scope before the first
  audit trigger runs.
- `apps/api/drizzle` gains a migration that grants `INSERT` on `site` and installs the
  `site.created` audit trigger; the hand-maintained Drizzle mirror is updated to match.
- `apps/web` gains the API call, the registration form, the header control, its styling, session
  reload, query invalidation and route tests.
- Integration tests replace the test that pins the application's inability to register a site, and
  cover the granted scope, the audit entries, the authorization refusal and the rollback.
- No table becomes mutable and no row is ever deleted: the change adds an `INSERT` privilege only.
