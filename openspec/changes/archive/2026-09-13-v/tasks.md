## 1. Decisión y documentos

- [x] 1.1 Escribir `docs/adr/024-renombre-de-roles.md` (design D1): los roles pasan a ser
      `coordinator`, `inspector` y `management`; "Assigned to" es el nombre en pantalla de
      `inspector_id`. Supersede solo la consecuencia de ADR-022 sobre `inspector` y la recomendación
      de la nota de vocabulario de §4, y deja registrado el trato de las escaladas y entradas de
      auditoría históricas (D3). En ADR-022, completar solo el campo **Superada por** con
      "ADR-024 (parcial: vocabulario)", sin reescribir su contenido.
- [x] 1.2 En `docs/Requisitos_V1.2.md` §4, nota de vocabulario: agregar una línea que remita a
      ADR-024 como la elección vigente (`inspector` como rol, `inspector_id` como campo que se
      muestra "Assigned to"), sin borrar el razonamiento original.
- [x] 1.3 Actualizar README y CLAUDE.md donde nombran `hs_coordinator`, `jhsc_member`,
      "H&S coordinator" o "JHSC member", incluidos los ejemplos de `--role`.

## 2. Esquema

- [x] 2.1 Escribir `apps/api/drizzle/0048_rename_roles.sql` en el orden del design D2, con
      `--> statement-breakpoint` entre statements: DROP de `app_user_role_check`; bloque `DO` que
      declara `app.site_ids` con todos los sitios y convierte `hs_coordinator → coordinator` y
      `jhsc_member → inspector`; guarda que falla si queda un rol fuera del conjunto; ADD del CHECK
      `('coordinator','inspector','management')`.
- [x] 2.2 En la misma migración: DROP + CREATE de la política `incident_visibility` sobre `incident`
      (`AS RESTRICTIVE FOR ALL`, `USING` y `WITH CHECK` con `('coordinator','management')`), y
      `CREATE OR REPLACE FUNCTION hs_action_verifier_guard()` con el cuerpo de `0042`,
      `actor_role = 'coordinator'` y el `HINT` con "the coordinator".
- [x] 2.3 En la misma migración (design D3, tabla inmutable, solo DDL): reemplazar
      `corrective_action_escalation_level_check` por
      `level IN ('coordinator','management','hs_coordinator')`, y crear el trigger `BEFORE INSERT`
      `hs_escalation_level_current()` que rechaza `NEW.level = 'hs_coordinator'`. El comentario de
      cabecera declara que no se escribe ninguna fila de la tabla inmutable.
- [x] 2.4 Revisar REVOKE/RLS: la migración no concede ni revoca privilegios y deja FORCE RLS como
      está. Dejarlo dicho en la cabecera junto con los GRANT vigentes de 0047.
- [x] 2.5 Agregar la entrada `0048_rename_roles` a `apps/api/drizzle/meta/_journal.json`.
- [x] 2.6 Actualizar los espejos Drizzle: `ROLES` en `apps/api/src/db/schema/identity.ts` y el
      nivel en `apps/api/src/db/schema/actions.ts`, con el comentario del valor histórico.

## 3. Contratos

- [x] 3.1 `packages/contracts/src/identity.ts`: `ROLES = ['coordinator','inspector','management']`,
      `isAdministrator` con `coordinator`, `ROLE_LABELS` según D5, y el comentario del vocabulario
      reescrito para citar ADR-024. Revisar los schemas que nombran un literal de rol
      (`promote_to`, creación de cuenta, invitación).
- [x] 3.2 Actualizar los tests de contracts que usan los identificadores viejos.

## 4. API

- [x] 4.1 `actions/escalation.service.ts`: niveles `coordinator`/`management` en `ESCALATION_LEVELS`,
      `ESCALATION_DAYS`, `ESCALATION_RECIPIENT_ROLE` y `NOTIFICATION_KIND`, más `LEVEL_ALIASES`
      (`coordinator` ↔ `hs_coordinator`) usado por `overdueWithoutEscalation` para no repetir un
      primer nivel ya emitido. Actualizar `escalation.spec.ts`.
- [x] 4.2 `actions/actions.service.ts` y `actions.repository.ts`: comparaciones de rol y mensajes
      ("Only the coordinator or the person who raised the finding…").
- [x] 4.3 `incidents/incidents.service.ts` y `incidents.repository.ts`: roles permitidos,
      `notifyCoordinators` (`u.role = 'coordinator'`) y mensajes.
- [x] 4.4 `auth/`: `account.service.ts` (promoción/democión), `account.errors.ts`
      ("promoted to coordinator", "demoted to inspector", "Only an inspector account can have access
      removed here"), `account.repository.ts`, `account.controller.ts`, `auth.controller.ts`,
      `invitation.service.ts`, `session.service.ts`.
- [x] 4.5 `roster/`, `templates/`, `catalog/` (sites y locations), `findings/findings.service.ts`,
      `inspections/inspections.service.ts` e `inspector-eligibility.ts`: comparaciones, comentarios y
      mensajes "Only the coordinator…". Sin tocar `inspector_id` ni los nombres de candidatos.
- [x] 4.6 `grep -rn "hs_coordinator\|jhsc_member\|H&S coordinator\|HS coordinator\|JHSC member"
      apps/api/src` debe devolver solo `LEVEL_ALIASES` y su comentario.

## 5. Web

- [x] 5.1 `permissions/session.ts` y su test: predicados con `coordinator`; `canPromote` y
      `canDemote` con los roles nuevos.
- [x] 5.2 `routes/RosterRoute`: `presentation.ts` (etiquetas de promover/degradar en minúscula,
      `accountRoleLabel`), `PromoteDialog.tsx`, `DemoteDialog.tsx`, sus tests e `index.test.tsx`.
- [x] 5.3 Avisos "Only H&S coordinators and management…" → "Only coordinators and management…" en
      `TemplatesRoute`, `TemplateDraftRoute`, `RosterRoute`, `LocationsRoute` y `ReportIncidentRoute`,
      con sus tests; "the HS coordinator" → "the coordinator" en `IncidentRoute` y
      `AcceptInvitationRoute/presentation.ts`.
- [x] 5.4 "Inspector" → "Assigned to" como etiqueta de la cuenta asignada (spec inspections, ADDED):
      `components/PeriodDialog.tsx`, `ScheduleRequirementRoute/RequirementPeriodRow.tsx`,
      `ScheduleRequirementRoute/AssignInspectorDialog.tsx`, `SchedulingRoute/RequirementRow.tsx`
      (incluido su `data-label` de teléfono) y los tests que buscan esas etiquetas.
- [x] 5.5 `components/AccountChip.test.tsx` y `presentation/account.test.ts`: "Coordinator" e
      "Inspector".
- [x] 5.6 Recorrer los fixtures y mocks de `apps/web/src` que construyen sesiones con
      `role: 'hs_coordinator' | 'jhsc_member'`.

## 6. Scripts y seeds

- [x] 6.1 `apps/api/seeds/004_bootstrap_coordinator.sql`: `role` `coordinator`.
- [x] 6.2 `apps/api/scripts/create-account.mjs` (`INTERNAL_ROLES`, `SINGLE_SITE_ROLES`, ayuda y
      avisos), `roster-import.mjs`, `demo-data.mjs`, `demo-content.mjs` y los comentarios de
      `bootstrap-invitation.mjs` y `reset-password.mjs`.

## 7. Tests de integración

- [x] 7.1 `apps/api/test/helpers/identity.ts` y todos los `*.int-spec.ts` que crean cuentas o afirman
      roles, mensajes o niveles con los valores viejos.
- [x] 7.2 Nuevo `apps/api/test/rename-roles-migration.int-spec.ts`, con el patrón de
      `reduce-roles-migration.int-spec.ts`: las cuentas se convierten conservando credencial y
      alcance; se escribe `user.role_changed` con `previous_role` viejo por sitio; el CHECK rechaza
      `hs_coordinator` y `jhsc_member`; `incident_visibility` deja ver a `coordinator`; el verificador
      acepta al `coordinator` que ejecutó; una escalada `hs_coordinator` previa sigue intacta y no se
      repite; un INSERT nuevo con `hs_coordinator` es rechazado; las cadenas verifican; los GRANT de
      `app_user` son los de 0047.

## 8. Verificación

- [x] 8.1 `pnpm -r build && pnpm typecheck && pnpm lint && pnpm test` (cuando el usuario lo pida).
- [x] 8.2 `pnpm --filter api test:int` (cuando el usuario lo pida).
- [x] 8.3 `grep` final en todo el repo, sin contar `openspec/changes/archive`, migraciones
      anteriores a 0048 y ADRs antiguas: los nombres viejos solo aparecen en `LEVEL_ALIASES`, la
      migración 0048 y los tests de datos históricos.
- [ ] 8.4 Migrar la base de localhost:5433 sin resetear credenciales, iniciar sesión con una cuenta
      real y confirmar "Coordinator"/"Inspector" en el chip y "Assigned to" en la programación.
