Las secciones 1-7 conservan el historial completado de la primera implementación, basada en una
proyección local. La revisión aprobada en las secciones 8-13 reemplaza esa arquitectura: las tareas
nuevas retiran la proyección y hacen que `finding_state_event` sea la fuente de verdad.

## 1. La proyección pura (historial supersedido)

- [x] 1.1 En `apps/web/src/routes/InspectionFindingsRoute/presentation.ts`, junto a
  `actionsByFinding` y `futureDueAt`, añadir `FINDING_STAGES` —`raised`, `assigned`,
  `in_progress`, `verification`, `closed`— y `STAGE_LABELS`, con el docblock que explica por
  qué las etapas son una proyección y no un estado guardado (ADR-002).
- [x] 1.2 Añadir `findingStage(actions)`: sin acciones, `raised`; con acciones, la etapa de la
  acción MENOS avanzada; `closed` solo cuando todas tienen `state` `closed`. Añadir
  `blockingActions(actions)`, las que están paradas en esa etapa, ordenadas por `due_at` más
  cercano primero.
- [x] 1.3 Añadir `stageStatus(stage, current)` → `'done' | 'current' | 'todo'`, que es lo que
  el indicador dibuja por segmento.
- [x] 1.4 Añadir la lectura del plazo del hallazgo: el `due_at` más cercano entre las acciones
  que lo bloquean, leído con `dueIn` de `presentation/inspections.ts` sobre el día de
  `formatDay`, con el día civil recibido POR PARÁMETRO como ya hace `futureDueAt` con el
  reloj. Sin acciones, sin plazo.
- [x] 1.5 Añadir `nextStep(...)`: qué acto sigue, quién lo debe y qué control lo ejecuta.
  Deriva de `transitionsFrom` filtrado por `canAttempt` y etiquetado con `transitionLabel`; la
  etapa `raised` sale de `canCreateAction`. **No reimplementar ninguna regla en un `switch`.**
  Devolver también el caso «no hay nada que la sesión pueda intentar» con el nombre de quién
  se espera (`assignee_name`, o el rol cuando es una etapa que no depende de una persona).
- [x] 1.6 Escribir `presentation.test.ts` para las cinco funciones: el hallazgo sin acciones,
  la acción menos avanzada fijando la etapa con una cerrada al lado, el cierre que exige todas
  cerradas, el plazo más cercano entre dos que bloquean, el vencido, y el próximo paso por
  rol —coordinador en `raised`, responsable en `open`, verificador en `awaiting_verification`,
  y el `jhsc_member` que no puede intentar nada.

## 2. Permisos

- [x] 2.1 En `apps/web/src/permissions/actions.ts`, estrechar el segundo parámetro de
  `canAttempt` de `Action` a `Pick<Action, 'assignee_person_id'>`, que es lo único que lee, y
  anotar en el docblock por qué: el listado trae `ActionSummary` sin `events`. Comprobar que
  `ActionProgressPanel` sigue tipando sin cambios y que `actions.test.ts` no pierde cobertura.

## 3. Los componentes

- [x] 3.1 Crear `FindingStepper.tsx` en la carpeta de la ruta: los cinco segmentos, puro y sin
  hooks, como `<ol>` con `aria-current="step"` en el vigente y el nombre de cada etapa escrito.
  El color acompaña y no carga la información.
- [x] 3.2 Crear `FindingNextStep.tsx`: qué tiene que pasar, quién lo debe y UN solo control
  primario. Cuando la sesión no puede intentar nada, sin control y con el nombre de quién se
  espera. Recibe los manejadores ya armados, como `FindingCommitments`: quién es dueño del
  foco y del diálogo se decide en la ruta.
- [x] 3.3 Reformular `FindingCommitments.tsx`: el `Update` por acción baja a control secundario
  —el camino principal pasa a ser el próximo paso— y la creación se ofrece al coordinador en
  toda etapa sin competir con el control primario. Conservar los tres estados de la lista
  (hay acciones, no hay ninguna, no se pudo leer): cero no se afirma sin haber leído.
- [x] 3.4 En `index.tsx`, reemplazar el placeholder `<p>progressive bar</p>` por la composición
  dentro de `ReportItem` y en este orden: `FindingReadout`, `FindingStepper`, `FindingNextStep`
  y `FindingCommitments`. La unión `Overlay` no cambia: el próximo paso solo elige cuál de los
  dos diálogos abre y sobre qué acción. Con `actions.isError` no se dibuja ninguna etapa.
- [x] 3.5 Titular `ActionProgressDialog` por el paso que se está dando (`transitionLabel`) en
  vez de «Update corrective action», conservando `ActionTimeline` al lado como el resumen que
  el verificador lee antes de aprobar.

## 4. Estilos

- [x] 4.1 Añadir a `apps/web/src/index.css`, junto al bloque `.finding__*`, los estilos del
  indicador de etapas y del aviso de próximo paso, con tokens semánticos existentes para
  hecho, vigente y pendiente. Ningún color literal —`scripts/check-tokens.mjs` falla el build
  (ADR-012)— y ningún token nuevo salvo que no exista ninguno que sirva, en cuyo caso se
  agrega al bloque de tokens con su contraste medido.
- [x] 4.2 Comprobar el ancho de teléfono: los cinco segmentos y el aviso con su botón tienen
  que caer en columna sin sacar la ficha de la tarjeta, como ya hace `.finding__commitments`.

## 5. Tests de la ruta

- [x] 5.1 En `index.test.tsx`, cubrir la etapa dibujada por hallazgo —sin acciones, con la
  menos avanzada mandando, y todas cerradas— y el próximo paso ofrecido por rol, incluido el
  lector que no puede intentar nada y lee a quién se espera.
- [x] 5.2 Cubrir que con `listActions` caído no se presenta ninguna etapa y sigue apareciendo
  el aviso de que los compromisos necesitan conexión.
- [x] 5.3 Cubrir que al avanzar un paso la pantalla sigue en el recorte de hallazgos y el
  hallazgo aparece en su nueva etapa con el próximo paso recalculado.

## 6. Validación

- [x] 6.1 Ejecutar `pnpm -r build` antes de `pnpm typecheck`, y después `pnpm lint` y
  `pnpm test`. El build de web corre además `check-tokens.mjs` y `check-service-worker.mjs`.
- [ ] 6.2 Comprobar a mano el recorrido en `/findings/$id` con los cuatro roles y con un
  hallazgo de dos acciones en etapas distintas.
- [x] 6.3 Ejecutar `openspec validate ciclo-de-vida-del-hallazgo --strict`.

## 7. Avanzar dentro de la ficha, sin diálogo

Revisión del diseño original (sección 3 y `design.md`, «Cada paso se ejecuta en su diálogo»):
`ActionProgressDialog` tapaba la pregunta, lo prescrito y lo observado justo cuando había que
decidir sobre ellos. Crear sigue siendo un diálogo; avanzar se despliega en la ficha.

- [x] 7.1 Partir el formulario de `ActionProgressPanel` en un componente propio,
  `components/ActionTransitionForm.tsx` —campos, botones por transición, rechazo del
  servidor y la mutación—, con `action` recortado a `Pick<Action, 'id' | 'state' |
  'assignee_person_id'>` para que le sirva tanto a `/actions/$id` como al `ActionSummary`
  del listado. `ActionProgressPanel` conserva el marco de `/actions/$id` y delega el
  formulario al componente nuevo; su API pública no cambia.
- [x] 7.2 En `presentation.ts`, `FindingNextStep.control` de `kind: 'progress'` pasa a llevar
  el `ActionSummary` entero (`action`) en vez de `actionId`: el formulario necesita `state` y
  `assignee_person_id`, y `nextStep` ya resolvió cuál acción es.
- [x] 7.3 Reescribir `FindingNextStep.tsx` como disclosure: el botón del paso despliega
  `ActionTransitionForm` debajo de la copia («Collapse» cuando está abierto, para no repetir
  el mismo nombre que el botón de envío del formulario) y el foco vuelve al botón, o a la
  ficha si el paso desapareció porque la acción se cerró.
- [x] 7.4 En `index.tsx`, `Overlay` queda con un solo miembro (`create`); borrar
  `ActionProgressDialog.tsx`, que se queda sin usos.
- [x] 7.5 Estilos: `.finding__next-step` pasa de renglón a columna
  (`.finding__next-step-head` es el renglón de antes), y se agrega
  `.finding__next-step-form`, con tokens semánticos existentes.
- [x] 7.6 Reescribir el `describe('avance de la acción')` de `index.test.tsx` — su
  `openProgress` pulsaba un botón `Update` que ya no existe en el código (era de
  `FindingCommitments`, retirado antes de esta sección) — cubriendo el despliegue en la
  ficha, `Cancel` y el rechazo del servidor.
- [x] 7.7 La historia completa de la acción se lee solo en `/actions/$id`: la ficha del
  hallazgo no la despliega, `ActionEventList` vuelve a ser privado de `ActionTimeline.tsx`
  y el requisito de esta sección lo dice explícitamente.
- [x] 7.8 Actualizar `design.md` y esta sección; añadir el requisito MODIFICADO
  correspondiente en `specs/findings/spec.md` de este change.
- [x] 7.9 `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `openspec validate ciclo-de-vida-del-hallazgo --strict`.

## 8. Contrato del estado persistido

- [x] 8.1 En `packages/contracts/src/findings.ts`, definir `FINDING_STATES` con `raised`,
  `assigned`, `in_progress`, `verification` y `closed`, exportar `findingStateSchema` y
  `FindingState`, y añadir `state` obligatorio a `findingSchema`; no añadir estado a ningún
  contrato de escritura.
- [x] 8.2 Actualizar las fixtures y pruebas de contracts para aceptar los cinco estados, rechazar
  valores ajenos y demostrar que todo `Finding` de lista o inspección enviada exige `state`.

## 9. Migración 0040 y esquema

- [x] 9.1 Escribir a mano `apps/api/drizzle/0040_finding_state_events.sql`: crear
  `finding_state_event` con identidad, `finding_id`, `site_id`, `position`, `from_state`,
  `to_state`, `source_action_event_id` y `recorded_at`; añadir checks de estados y origen, FKs
  compuestas, índice de lectura y único `(finding_id, position)`.
- [x] 9.2 En 0040, crear el trigger que añade `NULL → raised` al insertar todo hallazgo y una
  restricción diferida que impide confirmar un hallazgo sin evento inicial, dentro de la misma
  transacción para hallazgos derivados y manuales.
- [x] 9.3 En 0040, crear el trigger `AFTER INSERT` de `corrective_action_event` que ignora acciones
  de investigación, calcula el estado por la acción menos avanzada del hallazgo y añade un evento
  solo cuando cambia el agregado, referenciando el evento causal. Cubrir avance y regresión,
  incluidos rechazo de verificación y nueva acción sobre un hallazgo cerrado.
- [x] 9.4 En 0040, backfillear cada hallazgo existente con un evento baseline en posición `0`
  que capture su agregado vigente al migrar. No inventar una historia retroactiva a partir de
  acciones anteriores: el stream propio empieza con esa fotografía y registra los cambios futuros.
- [x] 9.5 En 0040, enlazar cada INSERT posterior a la migración al mecanismo de auditoría, ejecutar
  `hs_apply_site_isolation('finding_state_event')` y `hs_make_immutable('finding_state_event')`,
  conceder solo SELECT/INSERT necesarios a `hs_app` y escribir REVOKE explícito de
  UPDATE/DELETE/TRUNCATE.
- [x] 9.6 Modelar `findingStateEvent` y sus relaciones en `apps/api/src/db/schema/findings.ts`,
  exportarlo desde el índice del esquema y mantener el esquema Drizzle fuera de contracts.

## 10. Lecturas de API

- [x] 10.1 Adaptar el repositorio de findings para seleccionar el último `to_state` por
  `position DESC` y mapearlo a `Finding.state`, tratando la ausencia de evento como corrupción y
  no como `raised` implícito.
- [x] 10.2 Propagar `state` por todas las respuestas actuales que contienen `Finding`: lista de
  hallazgos, creación manual y lectura de inspección enviada, sin crear un endpoint para escribir
  estado ni introducir una dependencia `findings → actions`.
- [x] 10.3 Actualizar las pruebas de contrato e integración HTTP/servicio para comprobar el
  contrato obligatorio y que el scope HTTP continúa llegando por `DbService.withSession*`.

## 11. Web y cachés

- [x] 11.1 Retirar `findingStage(actions)` y sus pruebas de proyección; hacer que
  `InspectionFindingsRoute` y `FindingStepper` lean exclusivamente `finding.state`, y que la API
  de `/findings` transporte ese estado, manteniendo las acciones para plazo, permisos y próximo paso.
- [x] 11.2 Mantener visible el estado persistido aunque falle `listActions`; en ese caso ocultar
  únicamente plazo, compromiso bloqueante y control dependiente de acciones, sin reinterpretar el
  hallazgo como `raised`.
- [x] 11.3 Después de crear una acción, invalidar `queryKeys.actions()`, `queryKeys.findings()` y
  el prefijo `queryKeys.submittedInspection()` además de cerrar el formulario solo tras éxito.
- [x] 11.4 Después de avanzar una acción, invalidar `queryKeys.action(id)`,
  `queryKeys.actions()`, `queryKeys.findings()` y `queryKeys.submittedInspection()` para que cada
  lectura vuelva a obtener `finding.state` del último evento.
- [x] 11.5 Actualizar pruebas de presentación y rutas para los cinco estados del contrato, estado
  visible con acciones no disponibles, rechazo sin avance y refresco de la inspección tras cada
  mutación; cubrir las regresiones automáticas en integración del motor.

## 12. Integración, auditoría e inmutabilidad

- [x] 12.1 Añadir pruebas de integración para el evento inicial atómico en hallazgos derivados y
  manuales, incluida la imposibilidad de confirmar un hallazgo sin posición `0`.
- [x] 12.2 Probar la derivación por acción menos avanzada, cierre solo con todas cerradas, ausencia
  de eventos duplicados cuando el agregado no cambia, rechazo `verification → in_progress` y
  creación de acción `closed → assigned`.
- [x] 12.3 Probar que dos acciones distintas del mismo hallazgo avanzan concurrentemente bajo el
  lock transaccional y dejan un único agregado correcto, sin bifurcar el stream.
- [x] 12.4 Probar RLS de lectura por sitio, REVOKE para `hs_app`, triggers contra
  UPDATE/DELETE/TRUNCATE para el rol dueño y presencia del INSERT en la cadena de auditoría.
- [ ] 12.5 Probar el backfill de 0040 sobre hallazgos sin acciones, con acciones en etapas
  distintas y cerrados, verificando posiciones, causas, orden y estado vigente.

## 13. Validación de la revisión

- [x] 13.1 Ejecutar `pnpm -r build` antes de `pnpm typecheck`, y después `pnpm lint`, `pnpm test`
  y `pnpm --filter api test:int`.
- [ ] 13.2 Comprobar manualmente en `/findings` y `/findings/$id` los cinco estados, el rechazo de
  verificación y una acción nueva sobre un hallazgo cerrado con los roles permitidos.
- [x] 13.3 Ejecutar `openspec validate ciclo-de-vida-del-hallazgo --strict`.

## 14. El paso se ejecuta sin desplegarlo

Revisión de la sección 7 (7.3, el disclosure): para el único acto principal que la pantalla
ofrece hacían falta dos pulsaciones —una para revelar el formulario y otra para enviarlo—, y el
botón que revelaba repetía el nombre del paso que ya estaba en el `h3` del bloque. Crear sigue
siendo un diálogo; avanzar deja de ser algo que abrir y se dibuja.

- [x] 14.1 `FindingNextStep.tsx` pierde el estado del disclosure —`open`, `pending`, el `useId`,
  el `aria-expanded`/`aria-controls` y el botón «Collapse»— y dibuja `ActionTransitionForm`
  siempre que el paso sea `kind: 'progress'`. El encabezado se queda con la copia y, solo para
  `kind: 'create'`, el botón que abre el diálogo.
- [x] 14.2 La vuelta del foco se conserva y se simplifica: al tener éxito la transición el botón
  que lo tenía no sobrevive —la transición ofrecida es otra, o el paso desaparece porque la
  acción se cerró—, así que `onDone` enfoca la ficha capturada con `enclosingReportItem`. Ya no
  hay un ramal que devuelva el foco al botón del paso.
- [x] 14.3 `ActionTransitionForm` pierde `onCancel` y su botón `Cancel` —sin disclosure no hay
  nada que cerrar sin enviar— y `onPendingChange` con su `useEffect`, que se queda sin
  llamadores; `ActionProgressPanel` deja de hacer de pasamanos de ese prop.
- [x] 14.4 Estilos: solo los comentarios de `.finding__next-step` y `.finding__next-step-form`,
  que describían el formulario como algo que el botón desplegaba. Ninguna regla cambia.
- [x] 14.5 En `index.test.tsx`, el `describe('avance de la acción')` deja de desplegar antes de
  enviar y gana la prueba del invariante nuevo: con un paso de `kind: 'progress'` los campos y
  el botón de la transición están dibujados desde la carga, y no existe «Collapse» ni «Cancel».
- [x] 14.6 Actualizar `design.md`, el requisito MODIFICADO de `specs/findings/spec.md` y esta
  sección. Las casillas de la sección 7 no se reescriben: describen lo que se hizo entonces.
- [ ] 14.7 `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `openspec validate ciclo-de-vida-del-hallazgo --strict`.
