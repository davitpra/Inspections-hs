## 1. Contrato

- [x] 1.1 En `packages/contracts/src/identity.ts`, agregar `createPersonRequestSchema` como
      `z.strictObject({ site_id: z.uuid(), employee_number: employeeNumberSchema, first_name:
nameSchema, last_name: nameSchema })` y su tipo `CreatePersonRequest`. La respuesta es
      `personSchema`, que ya existe — no crear un esquema nuevo para ella.
- [x] 1.2 Reescribir el docblock de `rosterQuerySchema`, que hoy afirma que no hay ningún
      esquema de escritura en el archivo, y decir qué es lo único que se puede escribir.
- [x] 1.3 Exportar lo nuevo desde el índice del paquete y cubrir en el `.test.ts` de identity
      el trim de los nombres, el rechazo del `employee_number` que no cumple
      `EMPLOYEE_NUMBER_PATTERN`, y el rechazo de una clave de más (`strictObject`).

## 2. API — el alta

- [x] 2.1 `apps/api/src/roster/roster.errors.ts`: agregar a `RosterErrorCode` los códigos
      `person_employee_number_taken` (409 CONFLICT) y `person_site_out_of_scope` (403 FORBIDDEN),
      con sus constructoras. El mensaje del primero nombra solo el número que el llamador tipeó —
      ver design D3—; actualizar el docblock que hoy explica por qué no hay errores de persona.
- [x] 2.2 `apps/api/src/roster/roster.repository.ts`: `insertPerson(client, input)` con
      `INSERT INTO person (employee_number, first_name, last_name, site_id) VALUES (…) ON CONFLICT
(employee_number) DO NOTHING RETURNING id, site_id, employee_number, first_name, last_name,
deactivated_at`, devolviendo `Person | null` (`null` = número tomado). Comentar por qué NO se
      reusa `upsertPerson` (design D2) y por qué `ON CONFLICT` y no un SELECT previo.
- [x] 2.3 `apps/api/src/roster/roster.service.ts`: `create(session, input)` que llame a
      `requireCoordinator`, comprobar `session.siteIds.includes(input.site_id)` → `personSiteOutOfScope()`
      (design D4, y comentar por qué acá sí y en `list` no), y `withSessionClient` →
      `insertPerson`; `null` → `personEmployeeNumberTaken()`. Reescribir el docblock de cabecera de
      la clase, que hoy dice que la única escritura es el CSV, y dejar contestada la pregunta que
      ese mismo docblock dejó abierta (el CSV gana, design D1).
- [x] 2.4 `apps/api/src/roster/roster.controller.ts`: `@Post('people')` con
      `createPersonRequestSchema.parse(body)` y 201. Reescribir el docblock que afirma que no hay
      escritura por persona: ahora hay alta, y sigue sin haber corrección.
- [x] 2.5 `apps/api/test/roster-create-person.int-spec.ts`, en la línea de
      `roster-administration.int-spec.ts`: alta correcta y su aparición en `GET /people?site_id=…`;
      duplicado dentro de la planta; duplicado contra una persona de una planta fuera del alcance
      (misma respuesta, y la persona existente intacta); `site_id` fuera del alcance; rol no
      coordinador; y que el INSERT dejó `person.created` en `audit_log`.
- [x] 2.6 Un caso de integración que cubra la precedencia (design D1 / spec «The CSV import
      takes precedence»): alta a mano, después importar un CSV con ese mismo `employee_number` con
      otro apellido y otro `site_code`, y comprobar que la fila queda con lo del archivo y cuenta
      como aplicada, no rechazada.

## 3. Web — el cliente y el permiso

- [x] 3.1 `apps/web/src/api/roster.ts`: `createPerson(input)` → `post('/people', …, (value) =>
personSchema.parse(value))`. Corregir el docblock de cabecera, que hoy dice «no hay
      escrituras por persona».
- [x] 3.2 `apps/web/src/permissions/session.ts`: `canAddPersonToRoster(account)`
      (`role === 'hs_coordinator'`), con su caso en `session.test.ts`. Predicado propio, no reuso de
      `canImportRoster`.

## 4. Web — la pantalla

- [x] 4.1 `apps/web/src/routes/RosterRoute/AddPersonDialog.tsx` (nuevo), calcado del patrón de
      `ImportDialog.tsx`: `showModal()` en `useEffect` con `returnFocusTo` y `trigger?.focus()` en
      el cleanup, `useId()` por campo, `onCancel` bloqueado mientras `isPending`, cierre con
      `dialogRef.current?.close()` y desmontaje desde `onClose`. Tres campos (employee number,
      first name, last name), recibe `siteId` y `siteName` y dice en texto de qué planta es el
      alta. En éxito invalida `queryKeys.roster(siteId)` —el sitio concreto, no el prefijo— y
      cierra; en error muestra `role="alert"` con el mensaje del `RequestError` sin cerrar.
- [x] 4.2 `apps/web/src/routes/RosterRoute/presentation.ts`: `addPersonButtonText(state)` en la
      línea de `importButtonText`, y su caso en `presentation.test.ts`. Actualizar el docblock del
      archivo, que hoy dice que el único write es importar el CSV entero.
- [x] 4.3 `apps/web/src/routes/RosterRoute/index.tsx`: `addTriggerRef`, estado `adding`, el
      botón «Add person» en `.scheduling__top` junto al `SitePicker` y oculto cuando `noActiveSite`
      (design D6), montaje condicional del diálogo, y `canAddPersonToRoster` pasado desde
      `RosterRoute` igual que los otros dos permisos. Reescribir el texto del `notice-card` para
      que nombre las dos formas de meter gente en la lista y siga diciendo que corregir es del CSV.
- [x] 4.4 Estilos: reusar `.modal` y `.modal__actions`. Si hace falta una clase nueva, solo
      tokens de `index.css` — `scripts/check-tokens.mjs` falla el build ante cualquier color
      literal.
- [x] 4.5 `apps/web/src/routes/RosterRoute/index.test.tsx`: extender el mock de
      `../../api/roster` con `createPerson`, y agregar los casos — el diálogo se abre desde el
      encabezado; el alta manda el `site_id` que el selector muestra; el roster se invalida y la
      persona aparece; el foco vuelve al trigger al cerrar; el error del servidor se ve sin cerrar
      el diálogo; y un rol que no es coordinador no ve el botón.

## 5. Cierre

- [x] 5.1 `pnpm -r build && pnpm typecheck && pnpm lint`, después `pnpm test` y el int-spec
      nuevo (`pnpm --filter api exec vitest run --config vitest.integration.config.mts
test/roster-create-person.int-spec.ts`).
- [x] 5.2 Recorrido manual con `pnpm dev` como coordinador: alta con número nuevo → fila con la
      píldora «Worker» y el botón «Invite to JHSC»; alta con número repetido → error visible sin
      cerrar; después un CSV con ese número y otro apellido → gana el archivo.
- [x] 5.3 `openspec validate add-person-to-roster-by-hand --strict` y archivar con
      `/opsx:archive`.
