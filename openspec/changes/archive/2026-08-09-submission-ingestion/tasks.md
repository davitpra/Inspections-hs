## 1. El esquema: migración `0009_inspection_submissions.sql`

- [x] 1.1 Escribir `apps/api/drizzle/0009_inspection_submissions.sql` **a mano**
      (`drizzle-kit generate` sigue prohibido, ADR-004), abriendo con el comentario de
      cabecera que declare: crea dos tablas inmutables nuevas, no altera datos, y por qué
      cada barrera está donde está (D6).
- [x] 1.2 `ALTER TABLE template_version_item ADD CONSTRAINT template_version_item_id_key_uq
      UNIQUE (id, item_key)`. Es `ADD CONSTRAINT` sobre una tabla inmutable: legal, mismo
      precedente que 0008 §2. Sirve de destino a la FK compuesta de 3.4.
- [x] 1.3 `CREATE TABLE inspection` con `id`, `site_id` (FK a `site`),
      `scheduled_inspection_id` (FK), `template_version_id` (FK), `client_submission_id`,
      `submitted_by` (FK a `app_user`, `NOT NULL`), `signed_at`, `received_at`
      (`DEFAULT now()`) y `answer_count`. Más `UNIQUE (id, site_id)`, destino de la FK
      compuesta de `inspection_answer`.
- [x] 1.4 Los dos únicos que son la garantía del change:
      `UNIQUE (client_submission_id)` —la idempotencia (D2)— y
      `UNIQUE (scheduled_inspection_id)` —un envío por inspección programada—, cada uno con
      el comentario de qué requisito sostiene.
- [x] 1.5 `CREATE TABLE inspection_answer` con `id`, `inspection_id`, `site_id`,
      `template_version_item_id`, `item_key`, `value jsonb NOT NULL`; FK compuesta
      `(inspection_id, site_id)` → `inspection (id, site_id)`; FK compuesta
      `(template_version_item_id, item_key)` → `template_version_item (id, item_key)`;
      `UNIQUE (inspection_id, item_key)`.
- [x] 1.6 Índices de recurrencia (D8): `inspection_answer (site_id, item_key)` y
      `inspection_answer (inspection_id)`, más `inspection (site_id, received_at)`. El
      comentario dice para qué consulta de la etapa 7 existen.
- [x] 1.7 Trigger `hs_inspection_freeze_guard` `BEFORE INSERT ON inspection`: rechaza con
      SQLSTATE `HS002` si `template_version_id` no es el de su `scheduled_inspection_id`, o
      si esa inspección programada está cancelada.
- [x] 1.8 Trigger `hs_inspection_answer_guard` `BEFORE INSERT ON inspection_answer`: rechaza
      con `HS002` si el `template_version_item_id` pertenece a una versión distinta de la de
      su `inspection`.
- [x] 1.9 `hs_audit_entry_at(site, kind, body, occurred_at)` y `hs_identity_audit_entry`
      delegando en ella con `now()` (D7). Ningún trigger existente cambia de comportamiento
      y eso se afirma con un test de 6.2.
- [x] 1.10 Trigger `inspection_audit` `AFTER INSERT ON inspection`: una entrada
      `inspection.submitted` con `inspection_id`, `scheduled_inspection_id`, `site_id`,
      `template_version_id`, `client_submission_id`, `submitted_by` y `answer_count`, con
      `occurred_at := NEW.signed_at`. Ninguna entrada por respuesta.
- [x] 1.11 `SELECT hs_make_immutable('inspection')` y `('inspection_answer')`;
      `SELECT hs_apply_site_isolation(...)` sobre las dos; `GRANT SELECT, INSERT` y
      **ningún** `GRANT UPDATE` sobre ninguna columna, con el comentario que diga que la
      ausencia es el requisito.
- [x] 1.12 Actualizar a mano el espejo Drizzle en `apps/api/src/db/schema/inspections.ts`
      con las dos tablas y el comentario de ADR-004 que ya usan las otras; exportar los tipos
      desde `schema/index.ts`.

## 2. Funciones puras del envío

- [x] 2.1 `apps/api/src/inspections/submission.ts`: `mergePhotoAnswers(answers, photos)`
      (D4) — vuelca las object keys bajo su `item_key`, y devuelve una colisión explícita
      cuando la misma key viene en los dos mapas.
- [x] 2.2 En el mismo archivo, `objectKeysOf(answers, photos)` y
      `verifyObjectKeyPrefix(keys, site_id, scheduled_inspection_id)` (D5): toda key —de
      foto y de firma— tiene que empezar con el prefijo de esta inspección.
- [x] 2.3 `submission.spec.ts`, sin base y sin red: la fusión de un ítem de foto sin
      respuesta en `answers`; la colisión; una key de otra inspección; una key de otro sitio;
      la `object_key` de una firma verificada igual que una foto.

## 3. El endpoint

- [x] 3.1 `apps/api/src/inspections/submissions.errors.ts`: `already_submitted`,
      `invalid_submission`, `validation_failed` (con la lista completa de violaciones en el
      cuerpo), `forbidden`, `inspection_not_found`. **Los códigos son exactamente los que
      `apps/web/src/offline/outbox.ts` ya clasifica**; cualquier otro haría que el
      dispositivo reintente para siempre.
- [x] 3.2 `submissions.controller.ts`: `POST /inspection-submissions` (D1), body parseado
      con `inspectionSubmissionSchema`, actor tomado de `@CurrentSession` y nunca del
      payload. Registrar el controlador en `inspections.module.ts`.
- [x] 3.3 `submissions.service.ts` — todo dentro de **una** llamada a `withSessionScope`
      (D3): resolver la `scheduled_inspection` (RLS decide visibilidad, sin `WHERE` de
      sitio) → 404 `inspection_not_found` si no se ve → `forbidden` si el actor no es su
      `inspector_id` o si es `NULL` → `invalid_submission` si está cancelada.
- [x] 3.4 Continuar en el mismo servicio: `invalid_submission` si el `template_version_id`
      del payload no es el congelado; fusionar fotos y verificar prefijos (2.1–2.2); leer
      `template_version.document` y correr `validateAnswers` de `@hs/forms`; `422`
      `validation_failed` con **todas** las violaciones.
- [x] 3.5 El insert idempotente (D2): `INSERT ... ON CONFLICT (client_submission_id) DO
      NOTHING RETURNING *`. Cero filas ⇒ leer la existente y responder `created: false`, con
      el mismo status y la misma forma que la primera aceptación. Una violación del único de
      `scheduled_inspection_id` se traduce a `already_submitted`.
- [x] 3.6 Insertar las respuestas en **una** sentencia (`INSERT ... SELECT` sobre arrays), no
      una por ítem, resolviendo `template_version_item_id` por `(template_version_id,
      item_key)`. Escribir `answer_count` con lo que se insertó.
- [x] 3.7 Dejar escrito, como comentario y sin código, el punto de enganche de la derivación
      de hallazgos entre 3.6 y el commit (D9). Sin interfaz, sin hook, sin puerto vacío.
- [x] 3.8 Responder con `acceptedSubmissionSchema` — `id`, `client_submission_id`,
      `scheduled_inspection_id`, `template_version_id`, `submitted_at`, `submitted_by`,
      `created`— con el **mismo** status en creación y en reenvío.

## 4. Tests de integración: idempotencia y todo-o-nada

- [x] 4.1 `apps/api/test/submission-ingestion.int-spec.ts` sobre Testcontainers, con
      helpers de `test/helpers/scheduling.ts` para dejar una inspección programada lista.
- [x] 4.2 Aceptación: un envío válido crea una `inspection`, N filas de `inspection_answer`
      con su `item_key` y su `template_version_item_id`, y `created: true`.
- [x] 4.3 Reenvío: el mismo payload cuatro veces ⇒ un solo registro, N respuestas, una sola
      entrada de auditoría, `created: false` y el mismo status. **No** un `409`.
- [x] 4.4 Concurrencia: dos posts simultáneos del mismo `client_submission_id` ⇒ los dos
      responden con el mismo `inspection.id` y existe una sola fila.
- [x] 4.5 Segundo envío con otro `client_submission_id` para la misma inspección programada
      ⇒ `already_submitted`, y el registro que queda es el primero.
- [x] 4.6 Todo o nada: un envío al que le falta un `required` deja **cero** filas en las dos
      tablas y cero entradas de auditoría, aun teniendo 39 respuestas válidas; la respuesta
      lista las cuatro violaciones de un payload con cuatro problemas.
- [x] 4.7 Versión: un envío que nombra otra versión publicada de la misma plantilla ⇒
      `invalid_submission`; un `INSERT` directo con esa discrepancia ⇒ `HS002`.
- [x] 4.8 Fotos: un ítem de foto satisfecho solo por `photos`; una key con el prefijo de
      otra inspección ⇒ `invalid_submission`; un blob en base64 ⇒ rechazado por el contrato
      antes de tocar la base.
- [x] 4.9 Alcance y autoría: otro inspector del mismo sitio ⇒ `forbidden`; una inspección de
      Glencoe desde una sesión de St. Thomas ⇒ `inspection_not_found`, con un cuerpo que no
      dice nada de esa inspección; una inspección cancelada ⇒ `invalid_submission`.

## 5. Tests de integración: inmutabilidad y aislamiento

- [x] 5.1 Extender `apps/api/test/immutability.int-spec.ts`: `UPDATE` de
      `inspection_answer.value` y de `inspection.submitted_by` con el rol de la aplicación ⇒
      `42501`; con el rol de migración ⇒ `HS002`/`HS001` del trigger, no error de privilegio.
- [x] 5.2 `DELETE` y `TRUNCATE` sobre las dos tablas, con los dos roles ⇒ fallan y las filas
      siguen ahí.
- [x] 5.3 Aislamiento: una transacción con alcance de una sola planta no ve las inspecciones
      ni las respuestas de la otra; sin alcance declarado no ve nada; un `INSERT` con
      `site_id` fuera del alcance es rechazado por la política.
- [x] 5.4 Una `inspection_answer` cuyo `site_id` difiere del de su `inspection` ⇒ violación
      de la FK compuesta; un `item_key` que no es el del `template_version_item_id` ⇒
      violación de la FK compuesta; el mismo ítem dos veces ⇒ violación del único.

## 6. Tests de integración: la cadena de auditoría

- [x] 6.1 Extender `apps/api/test/audit-chain.int-spec.ts`: un envío aceptado agrega
      **exactamente un** eslabón, con `occurred_at` = `signed_at` del dispositivo y
      `recorded_at` del servidor, y con `answer_count` en el payload. Una inspección de 200
      respuestas sigue agregando uno solo.
- [x] 6.2 `hs_audit_entry_at` no cambió el comportamiento de lo existente: los eventos de
      `scheduled_inspection` y de `person` siguen escribiendo `occurred_at = recorded_at`.
- [x] 6.3 Un reenvío no agrega eslabón; veinte rechazos seguidos no agregan ninguno; la
      cadena del sitio verifica intacta después de todo lo anterior.
- [x] 6.4 La agrupación por `item_key` de dos inspecciones contra versiones distintas cae en
      un solo grupo, con `template_version_item_id` distintos — el spike 3 visto desde el
      lado de las respuestas, y la prueba de que el índice de D8 sirve a la consulta que va a
      existir.

## 7. El recorrido completo del spike 1

- [ ] 7.1 Ejecutar las tareas end-to-end que `offline-inspection-capture` dejó escritas sin
      marcar: capturar una inspección con el Android real en modo avión, reconectar y
      verificar que la cola se vacía y el registro aparece.
      **PENDIENTE — requiere el dispositivo físico.** Todo lo que se puede verificar sin
      él está verde: el servicio real, contra Postgres real, incluida la concurrencia del
      mismo `client_submission_id`.
- [ ] 7.2 Con el dispositivo en avión, forzar dos reintentos del mismo envío y comprobar
      contra la base que hay un solo registro y una sola entrada de auditoría.
      **PENDIENTE — requiere el dispositivo físico.** La propiedad ya está probada del
      lado del servidor (`submission-ingestion.int-spec.ts`, `audit-chain.int-spec.ts`);
      lo que falta es el recorrido real.
- [x] 7.3 Verificar que `apps/web` no necesitó ni un cambio de código para esto. Si hizo
      falta tocarlo, el contrato de `packages/contracts/src/submissions.ts` se implementó
      mal y se corrige del lado del servidor.
- [x] 7.4 `pnpm lint`, `pnpm test`, `pnpm test:int` y `pnpm build` en verde; actualizar
      `docs/adr/001` y `docs/adr/008` solo si el recorrido reveló algo que contradiga su
      texto.
