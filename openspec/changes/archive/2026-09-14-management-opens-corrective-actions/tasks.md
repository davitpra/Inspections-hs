## 1. Contratos — la tabla de transiciones

- [x] 1.1 En `packages/contracts/src/actions.ts`, agregar `'management'` a las filas `null → open`,
  `open → in_progress` e `in_progress → awaiting_verification` de `TRANSITIONS` (design D1), y
  actualizar el docblock de la tabla citando ADR-025.
- [x] 1.2 Reescribir el docblock de `TRANSITION_REQUIREMENTS` / `not_executor`: la regla exceptúa a
  `coordinator` y `management` (ADR-019, ADR-025) y sigue entera para `inspector`.
- [x] 1.3 `packages/contracts/src/actions.test.ts`: la fila de creación nombra
  `['coordinator', 'management']`; las dos de ejecución incluyen `management`; `VERIFIER_ROLES`
  sigue siendo `['coordinator', 'management']`; `inspector` sigue sin aparecer como rol en ninguna
  fila.

## 2. Esquema — la guarda del verificador

- [x] 2.1 Crear `apps/api/drizzle/0050_administrator_verifier_exception.sql` con
  `CREATE OR REPLACE FUNCTION hs_action_verifier_guard()` copiando el cuerpo de
  `0048_rename_roles.sql`, con `IF actor_role IN ('coordinator', 'management') THEN RETURN NEW;`
  y el `HINT` actualizado. Encabezado en español citando R3, ADR-002, ADR-019 y ADR-025, y
  declarando que no altera tablas, GRANTs, REVOKEs ni RLS (design D3).
- [x] 2.2 Registrar la migración en `apps/api/drizzle/meta/_journal.json` siguiendo la forma de
  `0049_correct_employee_number`.

## 3. API — `ActionsService`

- [x] 3.1 En `apps/api/src/actions/actions.service.ts`, `create`: reemplazar
  `session.role !== 'coordinator'` por `!isAdministrator(session.role)`, conservando la relación con
  `finding.reportedBy`; mensaje de `forbidden` a «Only an administrator or the person who raised
  the finding…».
- [x] 3.2 `replaceAssignment`: la misma sustitución y el mismo ajuste de mensaje.
- [x] 3.3 `transition`: el adelanto de `not_executor` pasa a `!isAdministrator(session.role)`;
  reescribir el comentario que decía que la excepción no se extiende a `management`.
- [x] 3.4 `createForInvestigation`: `!isAdministrator(session.role)` y mensaje «Only an
  administrator opens a corrective action».
- [x] 3.5 Actualizar los docblocks de `create`, `createForInvestigation` y `requireActor` que
  nombran al coordinador como único actor administrativo, incluido el que actúa en nombre de una
  persona sin cuenta.

## 4. Web — permisos

- [x] 4.1 `apps/web/src/permissions/actions.ts`: `canCreateAction` devuelve
  `isAdministrator(account.role) || account.userId === finding.reported_by` (design D2); docblocks
  de `canCreateAction`, `canEditAssignment` y `canAttempt` citando ADR-025.
- [x] 4.2 Revisar `apps/web/src/routes/InspectionFindingsRoute/presentation.ts` y
  `FindingNextStep.tsx` por textos que afirmen que solo el coordinador abre, corrige o actúa en
  nombre del responsable, o que ninguna cuenta verifica lo que declaró hecho.

## 5. Tests

- [x] 5.1 `apps/api/test/corrective-actions.int-spec.ts`: `management` que no reportó abre la
  acción (invierte «otro JHSC y management que no reportó reciben forbidden», dejando el
  `forbidden` del otro inspector); `management` corrige la asignación de un hallazgo ajeno y un
  inspector que no reportó recibe `forbidden`; `management` avanza en nombre de una persona sin
  cuenta; `management` cierra y rechaza lo que declaró hecho (invierte «un reportante management
  no puede verificar…» y «gerencia tampoco puede verificar…»); un INSERT directo con actor
  `management` ejecutor commitea; un INSERT directo con actor `inspector` ejecutor falla con
  `HS005`; una cuenta degradada a `inspector` pierde la excepción en el INSERT directo.
- [x] 5.2 Mismo archivo: recorrer `ROLES` e insertar directamente un cierre por el ejecutor de cada
  rol, comparando la aceptación del motor con `isAdministrator` (riesgo de divergencia del design).
- [x] 5.3 `apps/api/test/incidents.int-spec.ts`: `createForInvestigation` acepta a `management` y
  rechaza a un `inspector` con `forbidden`; «la acción de una investigación recorre el mismo
  ciclo…» deja de esperar `verifier_is_executor` del `management` ejecutor y pasa a esperar el
  cierre.
- [x] 5.4 `apps/web/src/permissions/actions.test.ts`: `canCreateAction` y `canEditAssignment` se
  ofrecen a `management` sin haber reportado; `canAttempt` ofrece a `management` las dos filas de
  ejecución (invierte «management que no es responsable no puede declararla hecha»); un
  `inspector` que no reportó sigue sin nada.
- [x] 5.5 `apps/web/src/routes/InspectionFindingsRoute/presentation.test.ts`: `nextStep` ofrece
  crear a `management` en un hallazgo `raised` ajeno, `Start work` en uno `assigned` de otra
  persona y `editableAssignment` en `assigned` (revisar la aserción de la línea ~423).
- [x] 5.6 `apps/web/src/routes/InspectionFindingsRoute/index.test.tsx`: un `management` que no
  reportó ve y abre la composición de la acción; revisar los casos de las líneas ~898 y ~1123 que
  montan una sesión `management`.

## 6. Papeleo

- [x] 6.1 `docs/adr/025-management-y-las-acciones-correctivas.md`: supera en parte a ADR-017
  (creación y corrección solo del coordinador) y a ADR-019 (excepción solo del coordinador);
  cita ADR-021 y ADR-022 sin superarlas; registra que el control de cuatro ojos de R3 queda sin
  rol verificador sujeto y por qué el trigger se conserva (design D3, D4).
- [x] 6.2 Cabeceras de ADR-017 y ADR-019: `Superada por: ADR-025 (parcial: …)`, única edición
  permitida; fila de ADR-025 y estados de 017/019 en `docs/adr/README.md`.
- [x] 6.3 Enmendar §3 R2/R3 de `docs/Requisitos_V1.2.md` donde nombre al coordinador como único
  que abre la acción o como única excepción al verificador, citando ADR-025.
- [x] 6.4 `openspec validate management-opens-corrective-actions --strict`.

## 7. Verificación (cuando lo pidas)

- [x] 7.1 `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- [x] 7.2 `pnpm --filter api test:int` (corrective-actions e incidents).
