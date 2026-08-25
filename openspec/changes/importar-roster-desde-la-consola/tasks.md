## 1. One importer, two entry points

- [x] 1.1 Split `apps/api/src/roster/apply-roster.ts` into
      `applyRosterRows(client, parsed, scope, options)` —the current body, receiving a
      `PoolClient` already inside a scoped transaction— and a thin `applyRoster(pool, …)`
      that wraps it in `withSiteScope` for the server command.
- [x] 1.2 Make the upsert safe when an `employee_number` exists outside the active RLS
      scope: insert with `ON CONFLICT DO NOTHING`, update only a visible existing person,
      and turn a zero-row update into a non-disclosing row rejection instead of aborting
      the transaction. Cover new, visible-existing and hidden-existing people against
      Postgres.
- [x] 1.3 Normalize CSV syntax errors from `csv-parse` as `RosterFileError` without
      swallowing unrelated failures, and add parser cases for malformed quoting, a missing
      required header and an empty payload.
- [x] 1.4 Keep `apps/api/scripts/roster-import.mjs` working unchanged, and confirm
      `test/roster-import.int-spec.ts` still passes against the wrapped entry point.
- [x] 1.5 Verify the transaction boundary through both wrappers: applied rows, the
      `roster_import` record, the per-site breakdown, audit entries and rejections commit
      together, and a deliberately late failure leaves none of them.

## 2. The HTTP surface

- [x] 2.1 Add `roster_file_unusable` (400) and `roster_file_too_large` (413) to
      `RosterErrorCode` in `roster.errors.ts`, with factories for malformed/unusable
      uploads and oversized files, plus a `roster_forbidden` factory worded for import.
- [x] 2.2 Add the Multer typing required by the controller to the API dev dependencies and
      update the lockfile. Translate expected Multer failures locally: a missing `file`, a
      second file or an unexpected field becomes `roster_file_unusable`; `LIMIT_FILE_SIZE`
      becomes `roster_file_too_large`. Preserve the structured `{ code, message }` body.
- [x] 2.3 Add `RosterService.import(session, file)`: reuse the private
      `requireCoordinator`, parse with `parseRosterCsv`, translate `RosterFileError` into
      `roster_file_unusable`, and run `applyRosterRows` inside
      `this.db.withSessionClient(session, …)` so scope and `imported_by` come only from the
      guarded session.
- [x] 2.4 Add `POST people/import` to `roster.controller.ts`: exactly one multipart field
      named `file`, a 2 MiB limit declared on the upload interceptor, UTF-8 text passed to
      the service, and a non-empty basename from the uploaded filename used as
      `source_filename`. Do not inspect or require the uploaded MIME type.
- [x] 2.5 Return 200 with `rosterImportReport` however many rows were rejected, including
      when every row was rejected.
- [x] 2.6 Update the controller, service and app route docblocks that currently call the
      roster surface read-only: whole-file import is writable; per-person create, rename,
      transfer and deactivation remain unavailable.

## 3. Integration coverage

- [x] 3.1 Exercise the real HTTP stack, including the auth guard and multipart interceptor:
      a coordinator imports a file for a site in scope; a file mixes in-scope and
      out-of-scope `site_code` values; and request body/query fields attempting to name a
      wider site or scope do not affect the session scope. Assert `source_filename` and
      `imported_by` came from the upload and session.
- [x] 3.2 Re-import the same file and assert names, sites and active states converge to the
      same roster while a second import record is appended. Include an `inactive` row and
      compare inactive state rather than requiring `deactivated_at` timestamp equality.
- [x] 3.3 Refuse every non-`hs_coordinator` role, using rows that would both create and
      update people, and assert no `person`, `roster_import` or audit row changes.
- [x] 3.4 Cover malformed uploads: no `file`, two `file` parts, an unexpected field, an
      unusable filename, a missing `employee_number` header and malformed CSV syntax all
      return 400 with `roster_file_unusable` and write nothing.
- [x] 3.5 Cover the upload boundary: 2 MiB + 1 returns 413 with
      `roster_file_too_large`, writes nothing, and a legal file is not rejected based on
      its declared MIME type.
- [x] 3.6 Cover result semantics: partial rejection and all rows rejected both return 200,
      persist a consistent import report and preserve the file row numbers. Cover an
      `employee_number` hidden by RLS and assert it is rejected without aborting valid rows
      or revealing its site.
- [x] 3.7 Assert the endpoint and server command produce the same counts and rejections,
      with the same row numbers and reasons, for the same file under the same scope.

## 4. Client transport

- [x] 4.1 Make authenticated domain failures honestly typed and add a request error that
      preserves `code` and `message`; keep the session-ending decision restricted to a 401
      carrying `session_ended`. Cover roster codes, a non-JSON failure and a network error.
- [x] 4.2 Extend `apps/web/src/api/request.ts` only as far as a `FormData` body requires:
      pass the same `FormData` instance without JSON serialization, keep authentication and
      response parsing, and omit `content-type` so the browser supplies the multipart
      boundary. Keep all existing JSON calls unchanged and test both paths directly.
- [x] 4.3 Add `importRoster({ file })` to `apps/web/src/api/roster.ts`, append the file under
      the exact field name `file`, post to `/people/import`, and parse the response with
      `rosterImportReportSchema` —no cast. Test the path, field, filename and rejection of
      an invalid response.

## 5. The console

- [x] 5.1 Add and test `canImportRoster(account)` in `src/permissions/session.ts`, separate
      from roster-reading and invitation decisions even though only `hs_coordinator` passes
      it today.
- [x] 5.2 Add `ImportDialog.tsx` to `routes/RosterRoute/` with explicit `empty`, `ready`,
      `pending`, `success` and `error` behavior: prevent empty and duplicate submissions,
      prevent closing while pending, clear stale output when the file changes, and start
      clean whenever the dialog is mounted.
- [x] 5.3 On success invalidate the `queryKeys.roster()` prefix, not only the currently
      selected site, because one import can create, transfer or deactivate people across
      every site in the session scope.
- [x] 5.4 Keep the report in the open dialog: show rows read, applied and rejected, followed
      by every rejection with row number and reason in an independently scrollable region.
      Explain that rows for any administered site may be applied.
- [x] 5.5 Add the report's pure logic to `presentation.ts` with cases in
      `presentation.test.ts`: the one-line summary, a non-mutating ascending order by
      `row_number`, and the submit button text for each state.
- [x] 5.6 Mount the dialog from `index.tsx` outside the table like the four existing
      dialogs, with an `Import roster` toolbar action shown only when `canImportRoster`
      allows it. Rewrite `.notice-card` to point to that action and update the route/API
      docblocks and test names that currently claim all roster operations are read-only.
- [x] 5.7 Give the dialog an accessible name, a label for the file input, announced pending,
      error and result states, semantic rejection output, disabled controls while pending,
      and focus restoration to the `Import roster` trigger.
- [x] 5.8 Extend `index.test.tsx`: the action is absent for a non-coordinator; submit is
      disabled without a file; pending prevents a second submit and close; success refreshes
      all cached rosters and leaves counts visible; partial and total rejection list rows in
      order; 400 and 413 errors retain the dialog; changing the file clears stale output;
      and closing/reopening starts clean and restores focus.

## 6. Checks

- [x] 6.1 No migration is part of this change: `person` already has its grants, RLS and
      audit trigger; `roster_import`, `roster_import_site` and
      `roster_import_rejection` are already global append-only tables without RLS, with
      audit derived from the per-site breakdown. Grant no new privilege to `hs_app`.
- [x] 6.2 Run focused parser, request-helper, roster client, presentation, route and roster
      integration tests while implementing.
- [x] 6.3 Run `pnpm lint`, `pnpm -r build`, `pnpm typecheck`, `pnpm test`, and
      `pnpm --filter api test:int` for the roster specs.
