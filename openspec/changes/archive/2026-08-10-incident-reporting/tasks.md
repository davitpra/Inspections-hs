## 1. El dominio del incidente en `packages/contracts`, sin base de datos

- [x] 1.1 `packages/contracts/src/incidents.ts`: `INCIDENT_CLASSIFICATIONS = ['first_aid',
      'health_care', 'lost_time_or_modified_work', 'critical_injury', 'occupational_illness']` con
      su `z.enum`, y el comentario que diga que **`near_miss` no está y esa ausencia es el
      requisito** (pregunta cerrada 8, riesgo F), que el camino del casi-accidente es el hallazgo
      manual, y que la migración `0012` escribe la misma lista en su `CHECK` con un test de
      integración que las compara (precedente 0007).
- [x] 1.2 `INCIDENT_STATES = ['reported', 'under_investigation', 'closed']` con su `z.enum` y el
      mismo comentario sobre el `CHECK` duplicado.
- [x] 1.3 `INCIDENT_TRANSITIONS` como **tabla de datos** con la forma que ya usa `actions.ts`
      (`from`, `to`, `roles`, `requires`): las cinco filas de §4 —`null`→`reported`,
      `reported`→`under_investigation`, `reported`→`closed`, `under_investigation`→`closed`,
      `closed`→`under_investigation`—, con `requires` cubriendo `reason`, `root_cause` y
      `no_open_actions`. `incidentTransitionFor(from, to)` consulta la tabla y no encadena `if`.
- [x] 1.4 `INVESTIGATION_REQUIRED_CLASSIFICATIONS = ['critical_injury',
      'lost_time_or_modified_work', 'occupational_illness']`, con el cartel textual de §4:
      configuración en código, **no regla legal autoritativa**, a confirmar contra las obligaciones
      concretas del empleador bajo la OHSA antes de producción.
- [x] 1.5 Las dos selecciones cerradas del cuerpo del formulario: `BODY_PARTS` (categoría gruesa) y
      `ON_SITE_TREATMENTS`, cada una con el comentario que marque el límite —**no hay diagnóstico,
      parte médico ni restricción funcional, y no los va a haber** (§4, riesgo G-bis)—.
- [x] 1.6 `INCIDENT_FORM_VERSIONS: Record<number, readonly IncidentFieldName[]>` con la versión 1 =
      los nueve campos guiados de §4, y `CURRENT_INCIDENT_FORM_VERSION = 1` (D15). El comentario
      explica por qué el registro existe: sin él, «vacío porque no aplicaba» y «vacío porque no
      existía» son indistinguibles en un registro inmutable.
- [x] 1.7 `incidents.test.ts`, primera parte: los pares ordenados de los tres estados más los que
      salen de `null`, aceptados y rechazados uno por uno; que las tres clasificaciones de 1.4
      rechazan `reported`→`closed` y que las otras dos lo aceptan con `reason`; que `near_miss` no
      valida.

## 2. Los relojes regulatorios como funciones puras

- [x] 2.1 `packages/contracts/src/regulatory-clocks.ts`: el tipo `RegulatoryClock` con `authority`
      (`mlitsd` | `wsib`), `obligation`, `countsFrom` (`occurrence` | `report`), `dueAt` o
      `immediate: true`, y `citation` (D5). El archivo abre con el cartel de configuración en
      código y no dictamen legal.
- [x] 2.2 `ontarioStatutoryHolidays(year): Date[]` derivado por regla (D6): los cuatro de fecha
      fija, los cuatro de n-ésimo día de semana —Family Day, Victoria Day como el lunes anterior al
      25 de mayo, Labour Day, Thanksgiving— y el Viernes Santo por el cómputo de la Pascua. Sin
      lista por año, y con el comentario que explique por qué una lista sería una bomba de tiempo.
- [x] 2.3 `addBusinessDays(from, n)`: salta sábados, domingos y los feriados de 2.2, en
      `America/Toronto`. Sin ajuste del feriado que cae en fin de semana, con el comentario que
      diga por qué es irrelevante para contar días hábiles.
- [x] 2.4 `regulatoryClocks({ classification, occurredAt, reportedAt }): RegulatoryClock[]` — las
      obligaciones del MLITSD desde `occurredAt` (aviso inmediato + informe escrito a las 48 h para
      `critical_injury`; aviso escrito a los 4 días para `health_care`,
      `lost_time_or_modified_work` y `occupational_illness`; ninguna para `first_aid`) y la del
      WSIB desde `reportedAt` (Form 7 a los 3 días hábiles para las cuatro clasificaciones que no
      son `first_aid`). Una sola función para las dos autoridades (D5).
- [x] 2.5 Tabla de casos en `regulatory-clocks.test.ts`: las cinco clasificaciones × qué relojes
      devuelven; el caso del reporte tardío afirmando que los del MLITSD ya están vencidos y el del
      WSIB recién arranca; los tres días hábiles cruzando un fin de semana; los tres días hábiles
      cruzando Canada Day; y los feriados derivados para varios años consecutivos, con el Viernes
      Santo moviéndose.
- [x] 2.6 Test que afirme que el módulo no importa nada de Node ni abre conexiones: las reglas de
      ADR-008 se prueban en milisegundos.

## 3. El contrato de transporte: request, respuesta, Form 7 y notificación

- [x] 3.1 `reportIncidentRequestSchema`: `subject_person_id`, `classification`, `occurred_at`,
      `location_id`, `task_performed`, `equipment_involved`, `what_happened`, `body_part`,
      `on_site_treatment`, `immediate_action`, `narrative_language`, `witness_person_ids` (lista,
      puede ser vacía). **`reported_by`, `reported_at` y `form_version` no están en el request**:
      los pone el servidor, con el comentario que lo diga.
- [x] 3.2 `incidentTransitionRequestSchema`: `to`, `note` opcional, `reason` opcional, `method`
      opcional para la apertura de la investigación. `refine` que exija `reason` en
      `reported`→`closed` y en `closed`→`under_investigation`, y `method` en
      `reported`→`under_investigation`.
- [x] 3.3 `incidentSchema` de lectura: el incidente, su estado **derivado**, sus relojes calculados,
      sus testigos, su investigación con causas, y `fields_of_version` para que la pantalla
      distinga el campo que no existía del campo vacío. **Sin columna de estado y sin columna de
      plazo**, con el comentario que lo explique.
- [x] 3.4 `recordCauseRequestSchema` (`statement`, `is_root`, `parent_cause_id` opcional) y el
      esquema de lectura de la investigación.
- [x] 3.5 `FORM7_MAPPINGS: Record<number, Form7Mapping>` (D16), paralelo a
      `INCIDENT_FORM_VERSIONS`, marcando explícitamente los campos del Form 7 que el sistema **no
      almacena** para que la pantalla los etiquete como no almacenados y no como vacíos.
- [x] 3.6 `packages/contracts/src/notifications.ts`: `incident_reported` como quinto miembro de
      `NOTIFICATION_KINDS`, con su payload —`incident_id`, `site_id`, `classification`,
      `occurred_at`, `reported_at`— y el comentario de D11 sobre por qué **no** lleva el nombre ni
      el número de empleado del sujeto.
- [x] 3.7 Exportar todo desde `packages/contracts/src/index.ts` y cubrirlo en `index.test.ts`.

## 4. La migración `0012_incidents.sql`

- [x] 4.1 Encabezado del archivo con el mapa de garantías, en el formato de 0011: qué requisito
      resuelve cada mecanismo y con qué herramienta.
- [x] 4.2 `incident`: `id`, `site_id`, `form_version`, `classification`, `subject_person_id`,
      `reported_by`, `occurred_at`, `reported_at`, `location_id`, los campos guiados,
      `narrative_language`, `created_at`. `CHECK` de las cinco clasificaciones, de `body_part`, de
      `on_site_treatment` y de `occurred_at <= reported_at`. `UNIQUE (id, site_id)` como destino de
      las FK compuestas de las hijas. **Sin columna de estado y sin columna de plazo.**
- [x] 4.3 `incident_event`: `incident_id`, `site_id`, `position`, `from_state`, `to_state`,
      `actor_user_id`, `note`, `reason`, `occurred_at`, `recorded_at`. `UNIQUE (incident_id,
      position)` contra la bifurcación del stream, `UNIQUE (id, site_id)` y la FK compuesta contra
      `incident`.
- [x] 4.4 `incident_witness` (`incident_id`, `site_id`, `person_id`, `UNIQUE (incident_id,
      person_id)`), `investigation` (`incident_id` con `UNIQUE`, `site_id`, `method`, `opened_by`,
      `opened_at`, `sequence_of_events`, `UNIQUE (id, site_id)`) e `investigation_cause`
      (`investigation_id`, `site_id`, `position`, `statement`, `is_root`, `parent_cause_id`
      nullable, `UNIQUE (investigation_id, position)`), todas con sus FK compuestas.
- [x] 4.5 `SELECT hs_make_immutable(...)` y `SELECT hs_apply_site_isolation(...)` sobre las cinco
      tablas.
- [x] 4.6 La política `RESTRICTIVE` de visibilidad (D2) sobre las cinco: `reported_by =
      current_setting('app.user_id', true)::uuid` **o** `current_setting('app.role', true) IN
      ('hs_coordinator','management')`, con `USING` y `WITH CHECK`. Para las cuatro hijas, la
      condición se evalúa contra el `incident` padre. El comentario explica por qué es `RESTRICTIVE`
      y no una reescritura de `hs_apply_site_isolation`.
- [x] 4.7 `hs_incident_has_open_actions(incident_id uuid) RETURNS boolean`, `STABLE` (D1): resuelve
      el estado vigente de cada `corrective_action` de la investigación del incidente con el mismo
      `DISTINCT ON … ORDER BY position DESC` del repositorio y devuelve verdadero si alguno no es
      `closed`.
- [x] 4.8 El trigger de transición de `incident_event`: que el par `(from_state, to_state)` esté en
      la tabla; que `from_state` sea el estado vigente; que el rol del actor esté permitido; que
      `reason` esté donde se exige; que `to_state = 'closed'` desde `reported` esté prohibido para
      las tres clasificaciones de 1.4; que `to_state = 'closed'` exija una causa con `is_root` y
      `NOT hs_incident_has_open_actions(...)`.
- [x] 4.9 Las restricciones diferidas al commit: un `incident` sin su evento `reported` no existe;
      un incidente cuyo estado vigente es `under_investigation` sin fila de `investigation` no
      existe.
- [x] 4.10 Los triggers de auditoría de los cuatro tipos —`incident.reported`,
      `incident.transitioned`, `investigation.opened`, `investigation.cause_recorded`— con el
      payload que el spec de `audit` fija y **sin narrativa, sin nombre y sin `statement`**.
- [x] 4.11 El `ALTER TABLE corrective_action` (D9, plan de migración paso 8): `ADD COLUMN
      investigation_id uuid`, la FK simple y la compuesta contra `(id, site_id)` de `investigation`,
      `ALTER COLUMN finding_id DROP NOT NULL`, el `CHECK` de exactamente-una como `NOT VALID` y su
      `VALIDATE CONSTRAINT` en la misma migración. Índice por `investigation_id`.
- [x] 4.12 `GRANT SELECT, INSERT` sobre las cinco tablas para el rol de aplicación, y **ningún**
      `GRANT UPDATE` ni `DELETE`. Registrar la migración en `drizzle/meta/_journal.json` a mano;
      `drizzle-kit generate` sigue prohibido (ADR-004).

## 5. El espejo Drizzle

- [x] 5.1 `apps/api/src/db/schema/incidents.ts` con las cinco tablas como espejo a mano del `.sql`,
      con el encabezado de ADR-004 que ya llevan `findings.ts` y `actions.ts`: la fuente de verdad
      es el SQL, no hay tipos `*Update` y esa ausencia es deliberada.
- [x] 5.2 `apps/api/src/db/schema/actions.ts`: agregar `investigationId` nullable, quitar el
      `notNull` de `findingId`, y reemplazar el comentario que decía «la etapa 6 agrega
      `investigationId`» por el que describe el parentesco ya vigente.
- [x] 5.3 Exportar desde `apps/api/src/db/schema/index.ts`.

## 6. El rol en la conexión

- [x] 6.1 `apps/api/src/db/site-scope.ts`: `runScoped` fija `app.role` con `set_config($1,$2,true)`
      junto a `app.site_ids` y `app.user_id` (D3), y el tipo del alcance de sesión gana `role`.
- [x] 6.2 `apps/api/src/auth`: la sesión resuelve `role` desde `app_user` **en cada request**, no
      desde el token, con el comentario que explique el modo de falla que evita.
- [x] 6.3 Test de integración: una transacción con sitio pero sin rol no ve ningún incidente aunque
      existan; el rol no sobrevive a la transacción sobre una conexión reusada del pool; un rol
      enviado en el cuerpo o en un header se ignora.

## 7. El módulo `apps/api/src/incidents`

- [x] 7.1 `incidents.module.ts`, `incidents.errors.ts` con los códigos del spec
      (`person_not_active`, `first_person_report_not_supported`, `occurred_at_in_future`,
      `role_not_allowed`, `investigation_required`, `root_cause_required`,
      `incident_has_open_actions`).
- [x] 7.2 `incidents.repository.ts`: insertar el incidente, su primer evento y sus testigos en una
      transacción; leer el incidente con su estado derivado por `DISTINCT ON`; listar por sitio
      dejando que la política RLS haga el recorte y **sin un solo `WHERE` de visibilidad en la
      consulta**.
- [x] 7.3 `incidents.service.ts`: reportar —validar el sujeto activo, que no sea el reportante,
      que la ubicación sea del sitio, fijar `form_version` y `reported_at` del servidor— y calcular
      los relojes con la función pura al leer.
- [x] 7.4 El servicio de transiciones: consultar `INCIDENT_TRANSITIONS`, abrir la `investigation`
      en la misma transacción que la transición a `under_investigation`, registrar causas, y dejar
      que las guardas de SQL sean la segunda defensa y no la única.
- [x] 7.5 La notificación al coordinador dentro de la transacción del reporte (D11), con el payload
      de 3.6 y sin identidad del sujeto.
- [x] 7.6 `incidents.controller.ts`: `POST /incidents`, `GET /incidents`, `GET /incidents/:id`,
      `POST /incidents/:id/transitions`, `POST /incidents/:id/investigation/causes`,
      `GET /incidents/:id/form7`. Ninguna ruta acepta sitio, rol ni actor por parámetro.
- [x] 7.7 Registrar el módulo en `app.module.ts`. **No** agregar `presign/incident` a
      `uploads.controller.ts`: el incidente no acepta fotos (D12).

## 8. El segundo padre en `actions`

- [x] 8.1 `packages/contracts/src/actions.ts`: `createActionRequestSchema` acepta `finding_id` **o**
      `investigation_id` con un `refine` de exactamente-una, y exige `severity` cuando el padre es
      una investigación (D9).
- [x] 8.2 `actions.service.ts` y `actions.repository.ts`: resolver el sitio y la severidad según el
      padre; con investigación, tomar la `severity` del request y calcular `dueAt` con la misma
      función pura.
- [x] 8.3 `actions.test.ts`: los casos nuevos —sin padre, con dos padres, investigación sin
      severidad, severidad ignorada cuando el padre es un hallazgo.
- [x] 8.4 Verificar que el escalamiento, la evidencia, el verificador distinto y la bandeja **no
      distinguen el padre**: un test que recorra el ciclo completo de una acción de investigación.

## 9. Los tests de integración con Testcontainers

- [x] 9.1 `apps/api/test/incidents.int-spec.ts`: las listas duplicadas —clasificaciones, estados,
      métodos, partes del cuerpo, tratamientos— comparadas entre `packages/contracts` y los `CHECK`
      de 0012.
- [x] 9.2 Las dos implementaciones de la tabla de transiciones evaluadas sobre todos los pares
      ordenados y comparadas verdicto a verdicto.
- [x] 9.3 La inmutabilidad de las cinco tablas: `UPDATE` como rol de aplicación (SQLSTATE `42501`),
      `UPDATE` como rol de migración (SQLSTATE del trigger), `DELETE` y `TRUNCATE`.
- [x] 9.4 La visibilidad: dos supervisores del mismo sitio, coordinador, gerencia, transacción sin
      rol, y un `SELECT *` crudo dentro de la transacción del supervisor.
- [x] 9.5 La guarda de cierre: acción `open`, acción `awaiting_verification`, todas cerradas,
      incidente sin acciones, inserción directa del evento de cierre, y el caso de la reapertura con
      una acción nueva abierta.
- [x] 9.6 La investigación obligatoria para las tres clasificaciones, por endpoint y por inserción
      directa; y el cierre sin causa raíz.
- [x] 9.7 Las restricciones diferidas: incidente sin evento de reporte, incidente en investigación
      sin `investigation`.
- [x] 9.8 La auditoría: un evento por reporte, uno por transición, uno por causa; que el payload no
      lleve narrativa, nombre ni `statement`; que la cadena por sitio verifique con incidentes de
      las dos plantas en paralelo; que un reporte rechazado no deje entrada.
- [x] 9.9 El `ALTER` de 4.11 sobre una base con acciones preexistentes: ninguna fila se reescribe,
      todas satisfacen el `CHECK`, y una acción con dos padres o sin padre es rechazada.

## 10. La web

- [x] 10.1 `apps/web/src/api/incidents.ts` con las llamadas tipadas contra `@hs/contracts`.
- [x] 10.2 `ReportIncidentRoute.tsx`: los nueve campos guiados en formulario corto, el selector de
      persona que muestra número de empleado y nombre y **nada más**, el selector de testigos con el
      mismo componente, y el selector de idioma de la narrativa. Sin cuadro de texto libre único y
      sin adjuntos.
- [x] 10.3 `IncidentRoute.tsx`: el detalle con estado derivado, los relojes con su cita y su estado
      —incluido «vencido», visible y no escondido—, los testigos, y el aviso de que **el envío al
      organismo lo hace una persona**.
- [x] 10.4 La investigación en la misma pantalla: método, secuencia de eventos, causas con su
      marca de raíz, y las acciones correctivas con el botón de crear una nueva con severidad
      explícita.
- [x] 10.5 `Form7Route.tsx`: solo lectura, mapeo por `form_version`, copiar por campo y copiar
      todo, y los campos no almacenados etiquetados como tales (D16). Sin descarga y sin PDF.
- [x] 10.6 La bandeja muestra `incident_reported` y enlaza al detalle; seguir el enlace sin permiso
      da lo mismo que un id inexistente.
- [x] 10.7 Rutas en `router.tsx` y tests de los componentes: que el formulario rechace el envío
      incompleto, que el detalle muestre un reloj vencido, y que el supervisor no vea el incidente
      ajeno en la lista.

## 11. Cierre

- [x] 11.1 `pnpm lint`, `pnpm typecheck`, `pnpm test` y los tests de integración en verde.
      **Con una excepción declarada y ajena a este change**: `inspection-period.int-spec.ts >
      la aplicación entera arranca y para limpio` falla porque el harness de integración no
      carga `.env` y `ObjectStorageService` no encuentra `S3_BUCKET`. Verificado contra el
      árbol limpio —con este change guardado en un stash— y falla igual. No se arregla acá:
      es una tarea del harness, no de la etapa 6.
- [x] 11.2 `openspec validate incident-reporting --strict` sin hallazgos.
- [x] 11.3 `docs/adr/005-pg-boss-not-bullmq.md`: dejar anotado que el tercer trabajo —notificaciones
      diferidas al coordinador— sigue sin reclamar, porque este change notifica dentro de la
      transacción del reporte.
- [x] 11.4 Revisar contra `design.md` las tres Open Questions y registrar en el change lo que el
      cliente responda sobre la visibilidad del miembro del JHSC y del auditor externo.
