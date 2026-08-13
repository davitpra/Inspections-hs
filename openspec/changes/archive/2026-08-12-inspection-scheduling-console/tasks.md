## 0. Nota de esquema

**Este change no trae migración.** No crea tabla, no altera columna, no agrega política y no otorga
privilegios: los `GRANT SELECT` sobre `site`, `template`, `template_version`, `app_user` y
`user_site_scope` ya están en 0003, 0004 y 0005. La regla «toda tarea que toque el esquema incluye
la migración SQL con REVOKE/RLS» no tiene sujeto acá, y queda dicho en vez de callado.

## 1. Los contratos

- [x] 1.1 `packages/contracts/src/templates.ts` nuevo con `templateOptionSchema` —`id`, `name`,
      `latest_version` (entero positivo), `latest_version_id`—. **No va en
      `template-document.ts`**: ese archivo es la forma del documento que consume
      `packages/forms`, y un DTO de listado ahí lo arrastraría al service worker.
- [x] 1.2 En `packages/contracts/src/inspections.ts`, `inspectorOptionSchema` —`id`,
      `employee_number`, `first_name`, `last_name`, los tres últimos nullable—. El comentario dice
      que `id` es `app_user.id` y **no** `person.id`, y que por eso no se reusa
      `personOptionSchema` aunque los campos coincidan: un selector que enviara un id de persona
      daría 400 en cada asignación.
- [x] 1.3 En el mismo archivo, agregar a `scheduledInspectionSchema` el campo `status`
      (`periodStatusSchema` importado de `./compliance.js`) y `inspector_name` nullable; y a
      `inspectionScheduleSchema` el campo `default_inspector_name` nullable. Verificar que la
      dirección del import no crea ciclo (`compliance.ts` no importa `inspections.ts`).
- [x] 1.4 Exportar lo nuevo desde `packages/contracts/src/index.ts`.
- [x] 1.5 `packages/contracts/src/inspections.test.ts` nuevo: los dos esquemas de opción, los
      nombres nullable y el `status`, en el estilo de `catalog.test.ts`.

## 2. Los tres refactors, sin cambio de comportamiento

Aterrizan **antes** que nada nuevo y con la suite verde, para que el guard de regresión signifique
algo.

- [x] 2.1 `apps/api/src/templates/published-version.sql.ts`: la resolución de «la versión publicada
      más alta» en un solo lugar. La consumen `requirePublishedTemplate`
      (`inspections.service.ts`), `open-period.service.ts` y el listado nuevo. Si el listado y el
      congelador discrepan, la pantalla muestra v2 y la inspección abre contra v3.
- [x] 2.2 `apps/api/src/inspections/period-status.sql.ts`: el `CASE` de los cuatro estados,
      parametrizado por alias de tabla y placeholder de reloj, extraído de
      `apps/api/src/reporting/compliance.sql.ts`. Lo consumen `COMPLIANCE_PERIODS_SQL` y
      `SCHEDULED_SELECT`. Una sola copia de la frontera `America/Toronto`.
- [x] 2.3 `apps/api/src/inspections/inspector-eligibility.ts`: las tres condiciones —cuenta activa,
      rol `jhsc_member`, alcance vigente— como fragmentos, más un helper de existencia de alcance
      parametrizado por placeholder (los índices difieren entre las dos consultas).
      `requireInspector` se reescribe sobre los fragmentos **conservando sus tres mensajes
      distintos**; `inspection-period.int-spec.ts` los afirma con `/management/` y
      `new RegExp(SITE_A)`.
- [x] 2.4 Correr `pnpm --filter api test:int` y confirmar verde antes de seguir.

## 3. La API: los agregados

- [x] 3.1 `SCHEDULED_SELECT` gana `LEFT JOIN inspection i ON i.scheduled_inspection_id = si.id` y
      el `status` de 2.2, más `LEFT JOIN app_user LEFT JOIN person` para `inspector_name`.
      `SCHEDULE_SELECT` gana el mismo join para `default_inspector_name`. **`LEFT` y no `INNER`**:
      `person` está aislada por sitio y su `site_id` es una columna propia y mutable, así que un
      inner join borraría del resultado a un asignado cuya persona está en la otra planta (D3).
- [x] 3.2 `createSchedule` mapea `23505` a un error dedicado que nombra el sitio y la plantilla, en
      `inspections.errors.ts`. Hoy sale como 500 y nadie lo nota porque no hay formulario.
- [x] 3.3 `apps/api/src/catalog/` nuevo —módulo, controller, service— con `GET /sites`:
      `WHERE id = ANY($1)` sobre `session.siteIds`, ordenado por `name`, **sin** filtrar
      `deactivated_at`. Comentario de cabecera en el registro de `locationPackage`, explicando por
      qué el `WHERE` no es un rodeo a la política (D1). Sin comprobación de rol.
- [x] 3.4 `apps/api/src/templates/` nuevo —módulo, controller, service— con `GET /templates`, solo
      las que tienen versión publicada, usando 2.1. Sin recorte y sin comprobación de rol; el
      comentario dice por qué `template` no lleva `site_id` ni política.
- [x] 3.5 `GET /inspector-candidates?site_id=` en `InspectionsController`, usando los fragmentos de
      2.3 y `LEFT JOIN person`, ordenado por apellido con nulos al final. **Dos** comprobaciones
      explícitas: `requireCoordinator` y que el `site_id` esté en `session.siteIds`, esta última
      documentada como «acá el endpoint sí es la frontera, porque `app_user` y `user_site_scope` no
      llevan política» (D8).
- [x] 3.6 Registrar `CatalogModule` y `TemplatesModule` en `apps/api/src/app.module.ts`.

## 4. El int-spec

- [x] 4.1 `apps/api/test/scheduling-console.int-spec.ts` nuevo, con `startTestDatabase` y
      `createSchedulingStack` (`inspection-scheduling.int-spec.ts` prueba el motor y ya es largo).
- [x] 4.2 **El test que ata las dos mitades**: toda cuenta que devuelve el listado de candidatos es
      aceptada por `assignInspector`, y toda cuenta rechazada con `inspector_invalid` está ausente
      del listado. Es la propiedad que hace que el selector no pueda ofrecer un 400.
- [x] 4.3 El listado excluye `management`, cuenta desactivada, alcance revocado y `jhsc_member`
      con alcance solo en la otra planta.
- [x] 4.4 El candidato cuya `person` está fuera del alcance del lector **sigue apareciendo**, con
      nombres nulos, y su asignación se acepta (el `LEFT JOIN` de D3).
- [x] 4.5 Un `jhsc_member` pidiendo el listado recibe `forbidden`; un coordinador pidiendo un sitio
      fuera de su alcance también, y sin filas.
- [x] 4.6 `GET /sites` devuelve exactamente `session.siteIds`; alcance vacío devuelve `[]`; un
      sitio desactivado se devuelve marcado.
- [x] 4.7 `GET /templates` omite la plantilla sin versión publicada, y su `latest_version_id` es el
      mismo `template_version_id` que congela `schedule()` para esa plantilla.
- [x] 4.8 **Anti-divergencia**: para un sitio y rango fijos, el `status` de `listScheduled` coincide
      con el que da `COMPLIANCE_PERIODS_SQL` para el mismo `scheduled_inspection_id`. Más el caso
      de sincronización tardía (`signed_at` antes de `period_end`, `received_at` después →
      `completed`) y el cancelado con motivo.
- [x] 4.9 `inspector_name` presente, y **todavía presente** después de desactivar al asignado,
      mientras esa cuenta ya no aparece entre los candidatos.
- [x] 4.10 La regla duplicada devuelve el error mapeado y no un fallo sin manejar.
- [x] 4.11 Confirmar que `inspection-period.int-spec.ts` sigue verde tras el refactor de 2.3.

## 5. El cliente web

- [x] 5.1 `apps/web/src/api/inspections.ts` nuevo, con los helpers locales `get/post/patch` sobre
      `sessionClient.request<unknown>` y **parseo contra el contrato, nunca cast**, como
      `api/actions.ts`. Exporta `listSchedules`, `createSchedule`, `updateSchedule`,
      `listScheduled`, `assignInspector`, `cancelScheduledInspection`, `listSites`, `listTemplates`
      e `listInspectorCandidates`. Cabecera: ONLINE, fuera de Dexie y del service worker — una
      asignación en cola sería un inspector que no sabe que fue asignado.
- [x] 5.2 **No** tocar la llamada inline a `/me/pending-inspections` de `PendingRoute.tsx`: está en
      el camino offline y no es de este change.

## 6. La pantalla

- [x] 6.1 `apps/web/src/routes/scheduling-presentation.ts`: estado → etiqueta y clase
      (`.period--completed|missed|cancelled|open` ya existen), y la etiqueta de lo no asignado.
      Módulo puro y testeable, patrón de `action-permissions.ts`. **Sin colores nuevos**:
      `apps/web/scripts/check-tokens.mjs` falla el build ante un literal.
- [x] 6.2 `apps/web/src/routes/SchedulingRoute.tsx`: selector de sitio (`.filters`, degradando a
      texto si el alcance tiene un solo sitio), sección de reglas y sección de programadas.
      `canAdminister = account?.role === 'hs_coordinator'` inline, con el comentario de por qué la
      duplicación cliente/servidor es deliberada. Solo lectura para los demás roles.
- [x] 6.3 Asignar, cancelar con motivo (obligatorio, 1..500, avisando que no se deshace), crear
      regla y desactivarla (la confirmación dice *qué deja de pasar*, no «¿estás seguro?»). El
      selector de plantillas **excluye las que ya tienen regla activa en ese sitio** — la mitad
      cliente del 23505.
- [x] 6.4 Ruta `/scheduling` en `apps/web/src/app/router.tsx` con el comentario de ONLINE en el
      registro de `recurrenceRoute`/`complianceRoute`, agregada a `addChildren`. **No tocar
      `sw.ts`**, y no colgarla de `/inspections/` porque `CAPTURE_ROUTES` matchea ese prefijo (D6).
- [x] 6.5 Link en `Shell()` condicionado a `hs_coordinator` — el primero que lo hace, y el
      comentario lo deja como precedente y no como descuido.

## 7. Los tests web

- [x] 7.1 `scheduling-presentation.test.ts`: los cuatro estados y lo no asignado.
- [x] 7.2 `SchedulingRoute.test.tsx` con `renderRoute()` local, `vi.mock` del módulo de api y de
      `useAppSession`, `cleanup()` explícito en `afterEach` (`globals: false`).
- [x] 7.3 `describe('quién puede administrar')`: el coordinador ve asignar, cancelar y nueva regla;
      un `jhsc_member` ve las dos listas y ninguno de los tres controles.
- [x] 7.4 `describe('lo que no tiene inspector')`: la fila con `inspector_id` nulo se marca, y
      asignar llama a `assignInspector` con el id elegido e invalida las queries correctas.
- [x] 7.5 El camino `inspector_invalid`: la mutación falla, la pantalla muestra el mensaje del
      servidor y la fila conserva su inspector anterior (sin update optimista).
- [x] 7.6 Cancelar sin motivo no se puede enviar.
- [x] 7.7 «Nombres y no UUIDs»: ningún uuid de 36 caracteres aparece en las filas renderizadas, en
      el estilo del test de ComplianceRoute que afirma que no se muestra ningún porcentaje.

## 8. Cierre

- [x] 8.1 `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter api test:int`.
- [x] 8.2 `pnpm --filter web build` — corre `check-tokens.mjs` y `check-service-worker.mjs`.
- [ ] 8.3 Recorrido a mano del criterio de aceptación: como coordinador asignar una inspección sin
      dueño; salir; entrar como ese `jhsc_member`; **confirmar que ahora aparece en `/`**. Ese es
      el criterio, no la pantalla. **PENDIENTE**: exige levantar Postgres, MinIO, la API y el PWA
      con `demo:data` corrido; la propiedad equivalente está cubierta automáticamente por el test
      «todo lo que ofrece, la asignación lo acepta» y por el int-spec de asignación, pero el
      recorrido de punta a punta no se hizo.
- [x] 8.4 Actualizar `proposal.md` con lo que se haya descubierto en el camino, si algo cambió.
