## 1. One importer, two entry points

- [ ] 1.1 Split `apps/api/src/roster/apply-roster.ts` into `applyRosterRows(client, parsed,
      scope, options)` — the current body, receiving a `PoolClient` already inside a scoped
      transaction — and a thin `applyRoster(pool, …)` that wraps it in `withSiteScope` for the
      server command.
- [ ] 1.2 Keep `apps/api/scripts/roster-import.mjs` working unchanged, and confirm
      `test/roster-import.int-spec.ts` still passes against the wrapped entry point.
- [ ] 1.3 Verify the transaction boundary is unchanged: applied rows, the `roster_import`
      record, the per-site breakdown and the rejections still commit together, and a failure
      leaves none of them.

## 2. The HTTP surface

- [ ] 2.1 Add `roster_file_unusable` (400) and `roster_file_too_large` (413) to
      `RosterErrorCode` in `roster.errors.ts`, each with its factory, and a forbidden factory
      worded for the import.
- [ ] 2.2 Add `RosterService.import(session, file)`: reuse the private `requireCoordinator`,
      parse with `parseRosterCsv`, translate `RosterFileError` into `roster_file_unusable`,
      and run `applyRosterRows` inside `this.db.withSessionClient(session, …)` so the scope
      and `imported_by` come from the session and never from the request.
- [ ] 2.3 Add `POST people/import` to `roster.controller.ts`: single-file
      `multipart/form-data`, a 2 MB limit declared on the upload interceptor, UTF-8 text
      passed to the service, and `source_filename` taken from the uploaded file name. Refuse a
      request carrying no file or more than one.
- [ ] 2.4 Return 200 with the `rosterImportReport` however many rows were rejected, including
      when every row was rejected.
- [ ] 2.5 Update the controller and service docblocks — both currently state that the roster
      surface is read-only — to say what is now writable and what still is not.

## 3. Integration coverage

- [ ] 3.1 Add the endpoint's cases to `test/roster-import.int-spec.ts` (or a companion file):
      a coordinator importing a file for a site in scope, a file mixing an in-scope and an
      out-of-scope `site_code`, and a re-import of the same file leaving the roster identical
      with a second import record.
- [ ] 3.2 Cover refusal: every non-`hs_coordinator` role is refused, and no `person` row and no
      `roster_import` record is written.
- [ ] 3.3 Cover the unusable file: a header missing `employee_number` and a non-CSV payload
      both return 400 and write nothing.
- [ ] 3.4 Assert the endpoint and the server command produce the same counts and the same
      rejections, with the same row numbers, for the same file under the same scope.

## 4. Client transport

- [ ] 4.1 Add `importRoster({ file })` to `apps/web/src/api/roster.ts`, posting
      `multipart/form-data` and parsing the response with `rosterImportReportSchema` — no cast.
- [ ] 4.2 Extend the request helper in `apps/web/src/api/request.ts` only as far as sending a
      `FormData` body requires: keep the auth header and the error-code handling, and let the
      browser set the multipart boundary instead of setting `content-type` by hand.

## 5. The console

- [ ] 5.1 Add `ImportDialog.tsx` to `routes/RosterRoute/`: a file input accepting `.csv`, the
      mutation, pending and error states, and `queryKeys.roster(siteId)` invalidated on
      success.
- [ ] 5.2 Show the report inside the dialog — rows read, applied and rejected, plus each
      rejection with its row number and reason — and do not close the dialog automatically
      when the import finishes.
- [ ] 5.3 Mount the dialog from `index.tsx` outside the table, like the four existing dialogs,
      with an "Import roster" action in the toolbar shown only to the coordinator.
- [ ] 5.4 Add the report's pure logic to `presentation.ts` with cases in `presentation.test.ts`:
      the one-line summary, the ordering of rejections, and the button text per state.
- [ ] 5.5 Rewrite the `.notice-card` in `index.tsx`, which today sends the coordinator to a CSV
      they cannot upload, and add the import path to the route docblock.
- [ ] 5.6 Extend `index.test.tsx`: the action is absent for a non-coordinator, a successful
      import shows the counts and refreshes the table, an import with rejections lists them,
      and an unusable file shows the error without closing the dialog.

## 6. Checks

- [ ] 6.1 No migration is part of this change: `person`, `roster_import`, `roster_import_site`
      and `roster_import_rejection` already exist with their grants, policies and audit
      trigger, and no new privilege is granted to `hs_app`.
- [ ] 6.2 Run `pnpm lint`, `pnpm -r build`, `pnpm typecheck`, `pnpm test`, and
      `pnpm --filter api test:int` for the roster specs.
