## 1. Migración `0008` — las tres tablas y sus restricciones

- [x] 1.1 Agregar `UNIQUE (id, template_id)` a `template_version` con `ALTER TABLE ... ADD
      CONSTRAINT`, y dejar escrito en el comentario que es legal sobre una tabla inmutable porque
      `hs_make_immutable` bloquea DML y no DDL (precedente: `0005`). Es el destino de la FK
      compuesta de 1.3.
- [x] 1.2 `inspection_schedule` — `id`, `site_id` REFERENCES `site`, `template_id` REFERENCES
      `template`, `default_inspector_id` REFERENCES `app_user` (nulable), `created_at`,
      `created_by`, `deactivated_at`. Único parcial `(site_id, template_id) WHERE deactivated_at IS
      NULL`.
- [x] 1.3 `scheduled_inspection` — `id`, `site_id`, `period_start date` con el `CHECK` de primer día
      del mes (D3: si el motor rechaza `date_trunc`, usar `EXTRACT(day FROM period_start) = 1` y
      dejar el comentario), `period_end` GENERATED ALWAYS STORED, `template_id`,
      `template_version_id`, `inspector_id` REFERENCES `app_user` (nulable), `scheduled_at`,
      `scheduled_by` (nulable — `NULL` es el trabajo automático, D8), `cancelled_at`,
      `cancellation_reason`, más la FK compuesta `(template_version_id, template_id)` contra el
      único de 1.1.
- [x] 1.4 `CHECK` de cancelación: `cancelled_at` y `cancellation_reason` ambos nulos o ambos no
      nulos. La inspección programada no lleva ubicación: la ubicación es del hallazgo.
- [x] 1.5 Único parcial `scheduled_inspection_open_period_uq (site_id, template_id, period_start)
      WHERE cancelled_at IS NULL`, con el comentario de D5: es la garantía de idempotencia, no la
      lógica del trabajo. Y el índice parcial `(inspector_id, period_end) WHERE cancelled_at IS
      NULL` de D10.
- [x] 1.6 `notification` — `id`, `user_id` REFERENCES `app_user`, `site_id`, `kind` con
      `CHECK (kind IN ('inspection_period_opened'))`, `dedupe_key text NOT NULL`, `payload jsonb`,
      `created_at`, `read_at`. `UNIQUE (user_id, kind, dedupe_key)`.

## 2. Migración `0008` — el mecanismo

- [x] 2.1 Trigger `scheduled_inspection_guard`: rechaza cambios en `site_id`, `period_start`,
      `template_id`, `template_version_id`, `scheduled_at` y `scheduled_by`, y rechaza volver
      `cancelled_at` a `NULL`. SQLSTATE del espacio `HS`, como los guards de `0004` y `0005`.
- [x] 2.2 Trigger `inspection_schedule_guard`: solo `default_inspector_id` y `deactivated_at` son
      mutables. Trigger `notification_guard`: solo `read_at`, y no vuelve a `NULL`.
- [x] 2.3 Triggers de prohibición de `DELETE` y `TRUNCATE` en las tres tablas, siguiendo el patrón
      de `0005` (`person_forbid_deletion` / `person_forbid_truncate`).
- [x] 2.4 `GRANT SELECT, INSERT` a `hs_app` en las tres, más `GRANT UPDATE` por columna:
      `(inspector_id, cancelled_at, cancellation_reason)` en `scheduled_inspection`,
      `(default_inspector_id, deactivated_at)` en `inspection_schedule`, `(read_at)` en
      `notification`. Sin `hs_make_immutable`, con el comentario que dice por qué (D2).
- [x] 2.5 `SELECT hs_apply_site_isolation(...)` en las tres tablas.
- [x] 2.6 Triggers de auditoría: alta, reasignación y cancelación de `scheduled_inspection`; alta y
      desactivación de `inspection_schedule`. El payload de la reasignación lleva el
      `inspector_id` anterior y el nuevo, que es lo que exige el escenario de la spec.
- [x] 2.7 Espejo Drizzle a mano en `apps/api/src/db/schema/inspections.ts` y `notifications.ts`, con
      la cabecera de ADR-004 que declara que la fuente de verdad es el `.sql`. Exportarlos desde
      `schema/index.ts`.

## 3. Integración del motor — lo que tiene que fallar

- [x] 3.1 `UPDATE scheduled_inspection SET template_version_id = ...` como `hs_app` falla con
      `42501`, y como `hs_migrator` falla con el SQLSTATE del guard. Los dos escenarios de la spec,
      por separado.
- [x] 3.2 Publicar una versión nueva de una plantilla no cambia ninguna fila de
      `scheduled_inspection`: se compara la fila antes y después.
- [x] 3.3 `DELETE` sobre las tres tablas falla; `cancelled_at` sin `cancellation_reason` falla;
      revertir una cancelación falla.
- [x] 3.4 `period_start` que no es primero de mes falla; `period_end` de febrero devuelve `28` y en
      año bisiesto `29`.
- [x] 3.5 FK compuesta: una fila con `template_id` de A y `template_version_id` de B falla.
- [x] 3.6 El único parcial: segundo insert del mismo `(site_id, template_id, period_start)` no
      cancelado falla; con el primero cancelado, pasa.
- [x] 3.7 Aislamiento: leer `scheduled_inspection` en una transacción sin alcance devuelve cero
      filas, y con el alcance del otro sitio también.

## 4. pg-boss — bootstrap

- [x] 4.1 Agregar `pg-boss` a `apps/api`. Crear el esquema `pgboss` en la migración con dueño
      `hs_migrator`, `USAGE` a `hs_app`, DML sobre sus tablas y `ALTER DEFAULT PRIVILEGES` para las
      que cree en versiones futuras. Comentario explícito de D7: estas tablas quedan fuera del
      régimen de inmutabilidad y del aislamiento por sitio, a propósito.
- [x] 4.2 `apps/api/src/jobs/` — `JobsService` con `schema: 'pgboss'`, arranque en
      `onApplicationBootstrap` y `stop({ graceful: true })` en `onModuleDestroy`, todo como
      `hs_app`. **Corrección sobre el plan original:** el `start()` NO instala el esquema. pg-boss 12
      no tiene opción `migrate` en el constructor, y meter una conexión de `hs_migrator` en el
      proceso de la API violaría lo que `DbService` tiene escrito. La instalación es
      `scripts/jobs-install.mjs` + `pnpm db:jobs:install`, un paso de despliegue al lado de
      `pnpm db:migrate`; el arranque solo verifica con `isInstalled()` y falla ruidoso si falta.
- [x] 4.3 Un registro tipado de trabajos (nombre → payload) para que el escalamiento de la etapa 5
      se cuelgue sin rediseñar nada, y para que un `send` con payload equivocado no compile.
- [x] 4.4 Test: dos réplicas arrancan, registran el mismo cron y paran sin romper; y el grafo de
      módulos ENTERO arranca con el planificador adentro y deja el cron registrado. El segundo caso
      es el que prueba que `OpenPeriodService` registra después de que el planificador arrancó —
      por eso `InspectionsModule` importa `JobsModule` explícitamente pese a ser `@Global`.

## 5. El trabajo de apertura del período

- [x] 5.1 Handler `inspections.open-period`: resuelve los sitios activos con la conexión sin
      alcance, abre `withSiteScope` con todos ellos y `userId: null`, y para cada regla activa
      inserta la ocurrencia del período con `ON CONFLICT DO NOTHING ... RETURNING id`.
- [x] 5.2 El período sale de la fecha civil en `America/Toronto`, no de UTC. El handler recibe el
      "ahora" como parámetro para que el test pueda pasarle `2026-09-01T02:00:00Z` y exigir
      `period_start = 2026-08-01`.
- [x] 5.3 La versión que se congela es la de mayor `version` publicada de la plantilla de la regla,
      resuelta en el momento del insert. `inspector_id` sale de `default_inspector_id` de la regla.
- [x] 5.4 Registrar el cron diario con `tz: 'America/Toronto'` y `singletonKey`, dejando escrito que
      el singleton evita el trabajo redundante pero que la garantía es el índice de 1.5. Diario y no
      mensual: un cron mensual que cae el día que el servidor está caído pierde el período entero.
- [x] 5.5 Tests del handler invocándolo directamente, sin reloj: correr dos veces deja una fila y la
      segunda corrida reporta cero; dos inserts concurrentes dejan una fila y ninguno falla; una
      regla desactivada no abre nada y sus períodos anteriores quedan intactos.

## 6. Notificación al coordinador

- [x] 6.1 Al final del handler, y solo por los sitios donde se creó al menos una ocurrencia,
      insertar una `notification` por cada `hs_coordinator` activo cuyo alcance vigente incluya ese
      sitio, con `kind = 'inspection_period_opened'`, `dedupe_key = '<site_id>:<period_start>'` y el
      payload con el período y lo abierto. `ON CONFLICT DO NOTHING`.
- [x] 6.2 `GET /notifications` (las propias, no leídas primero) y `POST /notifications/:id/read`.
- [x] 6.3 Tests: se notifica al coordinador con alcance en el sitio; una segunda corrida no genera
      una segunda notificación; una corrida que no abre nada no notifica; un coordinador sin alcance
      en el sitio no recibe nada; `UPDATE` de `payload`/`kind`/`user_id`/`site_id` falla y el de
      `read_at` pasa.

## 7. Endpoints

- [x] 7.1 Contratos en `packages/contracts`: reglas, programación manual, reasignación,
      cancelación, pendientes y notificaciones. Sin dependencias de Node.
- [x] 7.2 Reglas — `POST /inspection-schedules`, `GET /inspection-schedules`,
      `PATCH /inspection-schedules/:id` (inspector por defecto, desactivación). Solo
      `hs_coordinator`. Rechazar la regla cuya plantilla no tiene ninguna versión publicada.
- [x] 7.3 `POST /scheduled-inspections` (programación fuera de calendario),
      `PATCH /scheduled-inspections/:id/inspector`, `POST /scheduled-inspections/:id/cancel`
      (motivo obligatorio), `GET /scheduled-inspections` del sitio. Solo `hs_coordinator`.
- [x] 7.4 Validación del inspector: rol `jhsc_member` y alcance vigente que incluya el `site_id` de
      la inspección. El mensaje nombra el rol o el sitio que falta, según el caso.
- [x] 7.5 `GET /me/pending-inspections` — `inspector_id` del solicitante, `cancelled_at IS NULL`,
      `ORDER BY period_end`, con el flag de vencido calculado contra la fecha civil de
      `America/Toronto`. **Sin `WHERE site_id`**: recorta la política.
- [x] 7.6 Tests de endpoint: un `jhsc_member` no puede reasignar; un `supervisor` no puede crear una
      regla; el pendiente de A no incluye lo de B; el período anterior aparece primero y marcado
      como vencido; una inspección cancelada desaparece del pendiente; la reasignación deja entrada
      de auditoría con actor, valor anterior y nuevo.

## 8. Cierre

- [x] 8.1 Seeds: una regla activa por sitio contra la plantilla de inspección mensual, para que un
      entorno recién levantado tenga qué abrir.
- [x] 8.2 `pnpm typecheck`, `pnpm lint` y `pnpm test` verdes, incluida la suite de integración
      contra Postgres.
- [x] 8.3 `openspec validate inspection-scheduling --strict`.
