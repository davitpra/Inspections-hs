## 1. El motor: máquina de estados y plazo, sin base de datos

- [x] 1.1 `packages/contracts/src/actions.ts`: `ACTION_STATES = ['open', 'in_progress',
      'awaiting_verification', 'closed']` con su `z.enum`, y el comentario que diga que la
      migración `0011` escribe la misma lista en su `CHECK` y que un test de integración las
      compara (precedente 0007).
- [x] 1.2 En el mismo archivo, `TRANSITIONS` como **tabla de datos** (D3): `from`, `to`, `roles`
      y `requires`, con las cinco filas del diseño. `assignee` va en `roles` como posición
      relativa a la acción y no como rol de `ROLES`, con el comentario que lo explique.
- [x] 1.3 `transitionFor(from, to)` devuelve la fila o `undefined`. Sin `switch` y sin
      `if` encadenados: la tabla es el dato y la función solo la consulta.
- [x] 1.4 `actions.test.ts` con tabla de casos: los 20 pares ordenados de los cuatro estados más
      los cinco pares que salen de `null`, afirmando aceptados y rechazados uno por uno; que
      `closed` no acepta ninguna salida; y que toda fila con `requires: ['not_executor']` sale de
      `awaiting_verification`.
- [x] 1.5 `DUE_DAYS_BY_SEVERITY` —`catastrophic` 3, `major` 7, `moderate` 14, `minor` 30,
      `negligible` 60— con el cartel de «configuración en código, no regla legal autoritativa»
      (D5), y `dueAt(severity, from): Date` como función pura.
- [x] 1.6 Test de `dueAt` con las cinco severidades desde el mismo instante, afirmando 3/7/14/30/60
      días, y un caso que cruza un cambio de horario de Ontario afirmando el comportamiento que D5
      acepta.
- [x] 1.7 Exportar todo desde `packages/contracts/src/index.ts` y cubrirlo en `index.test.ts`.

## 2. El contrato: acciones y notificaciones

- [x] 2.1 En `actions.ts`, `createActionRequestSchema`: `finding_id`, `assignee_person_id`,
      `description` (10..2000), `remediation_group_id` opcional. **`due_at` y `severity` no están
      en el request**: los calcula el servidor (D5), con el comentario que lo diga.
- [x] 2.2 `transitionRequestSchema`: `to` (estado), `note` opcional, `reason` opcional y
      `evidence` como lista de `{ kind: 'before' | 'after', object_key }`. Un `refine` que exija
      `reason` cuando el destino es `in_progress` desde `awaiting_verification`, y al menos una
      evidencia `after` cuando el destino es `awaiting_verification`.
- [x] 2.3 `actionSchema` de lectura: la acción, su hallazgo, su responsable, `due_at`, `severity`,
      el estado **derivado**, `overdue` calculado contra el reloj, los niveles de escalamiento
      alcanzados y sus eventos con evidencia. **Sin campo `status` almacenado**, con el comentario
      que diga que el estado viene de los eventos.
- [x] 2.4 `packages/contracts/src/notifications.ts`: agregar `corrective_action_assigned`,
      `corrective_action_overdue_supervisor` y `corrective_action_overdue_management` a
      `NOTIFICATION_KINDS`, cada uno con su payload propio.
- [x] 2.5 **BREAKING** (D11): `notificationSchema` pasa a `z.discriminatedUnion('kind', ...)` con
      las cuatro variantes. Actualizar `notifications.test.ts` y agregar el caso de un `kind`
      desconocido que la unión rechaza.
- [x] 2.6 `presignUploadRequestSchema` gana la forma de la evidencia: `action_id` en lugar de
      `scheduled_inspection_id` o `draft_finding_id` (D9). Tests de contrato de las tres formas.

## 3. El esquema: migración `0011_corrective_actions.sql`

- [x] 3.1 Escribir `apps/api/drizzle/0011_corrective_actions.sql` **a mano** (`drizzle-kit
      generate` sigue prohibido, ADR-004), abriendo con el comentario de cabecera: crea cuatro
      tablas inmutables nuevas, **no altera ninguna tabla existente**, qué requisito sostiene cada
      barrera, y la lista de SQLSTATE nuevos `HS004`..`HS007` en el mismo espacio que los
      anteriores.
- [x] 3.2 `CREATE TABLE corrective_action` con `id`, `site_id`, `finding_id NOT NULL` (D13, con el
      comentario de la deuda de la etapa 6), `assignee_person_id`, `description`, `severity`,
      `due_at`, `remediation_group_id` nullable **sin semántica**, `created_by`, `created_at`.
      Más `UNIQUE (id, site_id)` como destino de las FK compuestas de las otras tres.
      **Ninguna columna `status`**, con el comentario que diga que la ausencia es el requisito.
- [x] 3.3 La FK compuesta `(finding_id, site_id)` → `finding (id, site_id)`, y
      `assignee_person_id` → `person (id)` **a secas**: 0005 documenta que `person` no lleva
      `UNIQUE (site_id, id)` a propósito, porque `person.site_id` es mutable y congelar el par
      reescribiría o invalidaría los registros al transferir a alguien. Reproducir ese comentario
      acá y verificar el sitio del responsable al crear la acción (tarea 4.3), no con una FK.
- [x] 3.4 Los `CHECK` de `corrective_action`: `char_length(description) >= 10` y `severity` contra
      la lista cerrada de 0010, cada uno con el comentario de qué requisito sostiene.
- [x] 3.5 `CREATE TABLE corrective_action_event` con `id`, `action_id`, `site_id`, `position int`,
      `from_state`, `to_state`, `actor_user_id`, `note`, `reason`, `occurred_at`,
      `recorded_at DEFAULT now()`; FK compuesta `(action_id, site_id)`; `UNIQUE (action_id,
      position)` (D2) y `UNIQUE (id, site_id)` para la evidencia.
- [x] 3.6 Los `CHECK` del evento: `(from_state IS NULL) = (position = 0)`, `to_state` en la lista
      cerrada, y `reason NOT NULL` cuando `from_state = 'awaiting_verification' AND to_state =
      'in_progress'`.
- [x] 3.7 `hs_action_transition_guard()` (D4, `HS004`): `BEFORE INSERT` que lee el evento de mayor
      `position` de la acción y falla si `NEW.from_state` no es su `to_state`, si el par no está en
      la tabla de transiciones o si el estado actual es `closed`. El comentario debe decir que
      **esta guarda no cierra la carrera** y que la concurrencia la resuelve el único de 3.5.
- [x] 3.8 `hs_action_verifier_guard()` (D6, `HS005`): `BEFORE INSERT` sobre los eventos que salen
      de `awaiting_verification`; busca el evento de mayor `position` con `to_state =
      'awaiting_verification'` y falla si su `actor_user_id` es el de `NEW`. El comentario debe
      decir por qué se compara contra el autor del completado y no contra `assignee_person_id`.
- [x] 3.9 `CREATE TABLE corrective_action_evidence` con `id`, `event_id`, `action_id`, `site_id`,
      `kind` (`before` | `after`), `object_key`, `created_at`; FK compuestas `(event_id, site_id)`
      y `(action_id, site_id)`; `UNIQUE (event_id, object_key)`.
- [x] 3.10 `CONSTRAINT TRIGGER` `DEFERRABLE INITIALLY DEFERRED` sobre `corrective_action_event`
      (D7, `HS006`): al commit, un evento con `to_state = 'awaiting_verification'` sin ninguna fila
      de evidencia `after` falla.
- [x] 3.11 `CONSTRAINT TRIGGER` `DEFERRABLE INITIALLY DEFERRED` sobre `corrective_action` (D8,
      `HS007`): al commit, una acción sin ningún evento falla.
- [x] 3.12 `CREATE TABLE corrective_action_escalation` con `id`, `action_id`, `site_id`, `level`
      (`supervisor` | `management`), `due_at`, `days_overdue`, `escalated_at`; FK compuesta
      `(action_id, site_id)`; `UNIQUE (action_id, level)` (D10), con el comentario que diga que
      **ese único es la idempotencia del cron**.
- [x] 3.13 Índices: `corrective_action_event (action_id, position DESC)` —el `DISTINCT ON` de
      D1—, `corrective_action (site_id, due_at)` —la barrida del cron—,
      `corrective_action (finding_id)` y `corrective_action (site_id,
      assignee_person_id)`. Cada uno con el comentario de qué consulta sirve.
- [x] 3.14 Triggers de auditoría `AFTER INSERT` vía `hs_audit_entry_at`: `action.created`,
      `action.transitioned` (con el `actor_user_id` del evento), `action.evidence_added` y
      `action.escalated` (con `actor_user_id` nulo, porque es acto del planificador).
- [x] 3.15 `hs_make_immutable` y `hs_apply_site_isolation` sobre las cuatro tablas;
      `GRANT SELECT, INSERT` para `hs_app` y **ningún** `GRANT UPDATE` sobre ninguna columna, con
      el comentario que diga que la ausencia es el requisito.
- [x] 3.16 Espejo Drizzle a mano en `apps/api/src/db/schema/actions.ts`, con el comentario de
      ADR-004 y sin ningún tipo `*Update`; exportar desde el índice del esquema.

## 4. El módulo `actions` de la API

- [x] 4.1 `apps/api/src/actions/object-key.ts`: `actionObjectKeyPrefix(siteId, actionId)` y
      `foreignEvidenceKeys(...)` (D9), función propia y no un parámetro de las anteriores, con el
      comentario que reproduzca el razonamiento de `findings/object-key.ts`. Test unitario.
- [x] 4.2 `actions.repository.ts`: `insertAction`, `insertEvent` —que calcula `position` como la
      última + 1 dentro de la transacción—, `insertEvidence`, y `currentState` / `listActions` con
      el `LEFT JOIN LATERAL` de D1. Todo bajo `withSessionClient`; **ningún `WHERE site_id`**.
- [x] 4.3 `actions.service.ts` — creación: verifica rol `hs_coordinator`, lee la clasificación
      vigente del hallazgo, rechaza con `finding_not_classified` si no hay, copia `severity`,
      calcula `due_at` con `dueAt`, e inserta acción + primer evento en una transacción.
- [x] 4.4 `actions.service.ts` — transición: resuelve el estado actual, consulta `transitionFor`,
      resuelve `assignee` contra `app_user.person_id`, verifica `not_executor`, valida las object
      keys de la evidencia con `foreignEvidenceKeys`, e inserta evento + evidencia en una
      transacción. `actor_user_id` **siempre de la sesión**.
- [x] 4.5 `actions.errors.ts` con `finding_not_classified`, `invalid_assignee`,
      `invalid_transition`, `evidence_required`, `invalid_evidence`, `verifier_is_executor`,
      `action_not_found`, y el mapeo de los SQLSTATE `HS004`..`HS007` a esos códigos.
- [x] 4.6 `actions.controller.ts`: `POST /findings/:id/actions`, `GET /actions`,
      `GET /actions/:id`, `POST /actions/:id/transitions`. Una acción de otro sitio responde
      `action_not_found`, indistinguible de una inexistente.
- [x] 4.7 La notificación de asignación: al crear, si la persona asignada tiene cuenta activa, una
      fila de `notification` de kind `corrective_action_assigned` en la misma transacción. Sin
      cuenta, ninguna notificación y la acción se crea igual.
- [x] 4.8 `actions.module.ts` y registro en `app.module.ts`. `actions` importa `findings` e
      `identity` y **no importa `inspections`** (D16).

## 5. El escalamiento con pg-boss

- [x] 5.1 `job-registry.ts`: `JobPayloads` gana `'actions.escalate-overdue': { now?: string }`,
      más `ESCALATE_OVERDUE_JOB` y su cron diario, borrando de paso la línea del comentario que
      decía que este trabajo faltaba.
- [x] 5.2 `actions/escalation.service.ts`: por sitio, busca acciones cuyo estado derivado no es
      `closed` y cuyo `due_at` pasó los umbrales; `INSERT ... ON CONFLICT (action_id, level) DO
      NOTHING`; **solo si la fila se creó**, escribe las notificaciones a las cuentas activas del
      rol correspondiente del sitio (D10).
- [x] 5.3 Enganchar el handler en el arranque, junto a `inspections.open-period`, con el mismo
      manejo de `JOBS_ENABLED=false`.
- [x] 5.4 Test unitario del cálculo de umbrales con `now` inyectado: 2 días (nada), 4 días
      (supervisor), 8 días (los dos), acción cerrada (nada).

## 6. Tests de integración

- [x] 6.1 `apps/api/test/corrective-actions.int-spec.ts`: el recorrido completo de R3 —crear,
      iniciar, completar con evidencia, verificar con otra cuenta, cerrar— afirmando el estado
      derivado en cada paso y que ninguna fila fue modificada.
- [x] 6.2 Las transiciones ilegales por los dos caminos: rechazadas por el endpoint con
      `invalid_transition` y por `INSERT` directo con `HS004`. Los 20 pares evaluados por la
      función pura y por la guarda de SQL, comparados celda por celda (D4).
- [x] 6.3 El verificador: el ejecutor no puede cerrar (endpoint y `INSERT` directo); otra cuenta
      sí; el rechazo devuelve a `in_progress` y exige `reason`; el coordinador que completó en
      nombre de una persona sin cuenta tampoco puede verificar (D6).
- [x] 6.4 La evidencia: completar sin evidencia falla al commit con `HS006`; con `before` y
      `after` se guardan las tres filas; una key de otro prefijo se rechaza.
- [x] 6.5 Concurrencia: dos transiciones simultáneas desde el mismo estado, una commitea y la otra
      falla con violación de unicidad en `(action_id, position)`; la acción queda con un solo
      estado vigente (D2).
- [x] 6.6 La acción sin primer evento no commitea (`HS007`); la acción para un hallazgo sin
      clasificar se rechaza; el plazo congelado sobrevive a una reclasificación.
- [x] 6.7 Escalamiento: 30 corridas diarias producen una fila por nivel y una notificación por
      destinatario y nivel; una acción cerrada no escala; una dentro del plazo tampoco; el
      escalamiento no agrega ningún evento al stream.
- [x] 6.8 Las cuatro tablas nuevas: `UPDATE` y `DELETE` fallan para `hs_app` con `42501` y para
      `hs_migrator` con el SQLSTATE del trigger; el aislamiento por sitio y las FK compuestas de
      sitio. **Van en `corrective-actions.int-spec.ts` y no en `immutability.int-spec.ts`**: es
      donde la etapa 4 puso las de `finding`, y donde están las fixtures.
- [x] 6.9 Los cuatro tipos de evento nuevos: payloads completos, `actor_user_id` nulo en
      `action.escalated`, una transición rechazada que no deja entrada, y la cadena del sitio
      íntegra después del recorrido completo. **En el spec del módulo**, por lo mismo que 6.8.

## 7. La web

- [x] 7.1 `apps/web/src/api/actions.ts`: cliente tipado de los cuatro endpoints contra
      `@hs/contracts`.
- [ ] 7.2 **NO HECHO — la premisa no existe.** No hay pantalla de hallazgos en `apps/web`: la web
      es hoy solo la PWA de captura offline (etapa 3), y la etapa 4 no agregó UI. Colgar la lista
      de acciones y el formulario de creación exige antes una pantalla de hallazgos, que es de la
      etapa 4 y no de este change. El endpoint `POST /findings/:id/actions` está implementado y
      probado; le falta el punto de entrada visual. Queda como el único hueco declarado.
- [x] 7.3 `ActionRoute.tsx`: detalle con el stream de eventos en orden, la evidencia de cada uno, y
      los botones que salen de `TRANSITIONS` —no de un `if` escrito a mano en la UI—.
- [x] 7.4 La subida de evidencia usando la presigned URL con el prefijo de la acción, y el envío de
      la transición con las object keys.
- [x] 7.5 La bandeja renderiza los cuatro tipos de notificación y **falla ruidoso** ante un `kind`
      desconocido (D11), en vez de mostrar una tarjeta vacía.
- [x] 7.6 Tests de la web: el detalle muestra el estado derivado y los botones habilitados por
      estado y rol; una acción vencida se muestra como tal.

## 8. Cierre

- [x] 8.1 `pnpm lint`, `pnpm -r typecheck` y las suites de unidad en verde (453 tests), más los
      tests de integración: 459/460. **El único rojo es previo a este change** —
      `inspection-period.int-spec.ts > la aplicación entera arranca…` falla en `master` porque el
      arranque del `AppModule` completo exige `S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`
      y ese test no las define. Verificado con `git stash`. No se toca acá: es de la etapa 3.
- [x] 8.2 Anotar en `docs/adr/005-pg-boss-not-bullmq.md` que el escalamiento —el trabajo que el ADR
      nombra primero— está implementado, sin reescribir la decisión.
- [x] 8.3 Verificar contra `openspec/changes/corrective-action-lifecycle/specs/` que cada
      requisito tiene su escenario cubierto por un test, y anotar el que no.
