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

## 15. Crear tampoco es un diálogo

Revisión de las secciones 7 y 14, cuyas cabeceras decían «Crear sigue siendo un diálogo». Deja de
serlo, y por el mismo motivo por el que dejó de serlo avanzar: el modal tapaba la pregunta, lo
prescrito y lo observado justo cuando había que comprometerse sobre ellos. Ahora el botón de
`raised` no abre nada — escribe el borrador en el mismo bloque, y el indicador adelanta la etapa a
la que ese borrador llegaría, marcada como no registrada.

- [x] 15.1 Reescribir `CreateActionForm.tsx` como formulario a la vista: se van el `<dialog>`, el
  `showModal`, `returnFocusTo`, el encabezado «New commitment» con `CheckIcon` y el recuadro que
  repetía el hallazgo —todo eso ya está en la ficha—. Se conservan sin tocar la consulta del
  roster, la validación con `futureDueAt` y `createActionRequestSchema`, los `aria-invalid`, el
  guardado contra doble envío y las tres invalidaciones del `onSuccess`. Firma nueva: `finding`
  recortado a `Pick<Finding, 'id'>`, `onCancel` y `onCreated`.
- [x] 15.2 El foco entra al `<select>` de Assignee al montar: el botón que abrió el borrador no
  sobrevive, y sin esto el foco cae al `body`.
- [x] 15.3 `FindingNextStep.tsx` recibe `finding`, `drafting`, `onDraft` y `onDraftEnd` en lugar de
  `onAttempt`, y dibuja el botón O el borrador, nunca los dos. Cancelar y crear cierran el borrador
  y devuelven el foco a la ficha con el `returnFocus()` que ya existía para el paso de avance.
- [x] 15.4 `FindingStepper.tsx` gana `draft?: boolean`: el segmento vigente suma
  `finding__stage--draft` conservando `aria-current="step"`, y el encabezado del bloque escribe
  «Draft — no action created yet» en el lugar donde iría el plazo, que en `raised` siempre está
  vacío. La distinción no queda en la forma sola (ADR-012).
- [x] 15.5 En `index.tsx`, `drafting: string | null` —el id del hallazgo con borrador abierto, uno
  a la vez— reemplaza a `Overlay`, `overlay`, `openOverlay` y `returnFocusTo`; el render del
  diálogo fuera del bucle desaparece con ellos. El indicador recibe `current={isDrafting ?
  'assigned' : finding.state}`, y `findingDeadline` sigue leyendo `finding.state`: un plazo bajo
  una etapa que no ocurrió sería una fecha inventada.
- [x] 15.6 Estilos: borrar el bloque `.actions-create-dialog*` entero, que se queda sin usos, y
  agregar `.finding__create-field`, `.finding__create-actions` y `.finding__stage--draft` con
  tokens semánticos existentes. Vocabulario propio y no `action-detail__*`, por lo mismo que ya
  decía el comentario del diálogo borrado. En el corte de 68rem el filete punteado del borrador
  pasa a la izquierda y las dos salidas toman el ancho del renglón (ADR-010).
- [x] 15.7 El docblock de `focusable` en `components/ReportItem.tsx` deja de hablar de un diálogo:
  el foco vuelve a la ficha porque el control que lo tenía no sobrevive al paso.
- [x] 15.8 En `index.test.tsx`, `openCreation` devuelve la región «Next step» en vez de un
  `dialog`, y el `describe('el compromiso')` gana las pruebas del invariante nuevo: la etapa se
  adelanta a Assigned marcada como borrador, `Cancel` la devuelve a Raised sin crear nada, y el
  botón que abre el borrador no convive con el borrador.
- [x] 15.9 Actualizar `design.md`, el requisito de `specs/findings/spec.md` de este change —la
  composición se acepta dentro del paso, y el adelanto del indicador debe declararse no
  registrado— y esta sección. Las casillas de 7 y 14 no se reescriben.
- [ ] 15.10 `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `openspec validate ciclo-de-vida-del-hallazgo --strict`.

## 16. Empezar el trabajo no pide nota

`ActionTransitionForm` dibujaba el textarea «Note (Optional)» en toda transición, incluida
`open → in_progress`. En la etapa Assigned eso deja un campo de texto justo debajo de la copia
que dice «No additional information is required», y delante del único botón que importa: la
persona, la descripción y el plazo ya se escribieron al crear la acción, y la nota es la
oportunidad de escribir lo mismo otra vez. En las otras tres transiciones —declarar el trabajo
hecho, verificar y devolver— sí hay algo que decir, así que el campo no se borra: se condiciona.

- [x] 16.1 `presentation/actions.ts` gana `TRANSITION_TAKES_NOTE` y `transitionTakesNote`, tabla
  por PAR de estados al lado de `TRANSITION_LABELS` y con el mismo argumento: el par es la
  unidad de decisión, no el destino. Solo `open->in_progress` es `false`; el default es admitir
  la nota, para que una transición nueva no se quede muda por olvido. Su prueba en
  `actions.test.ts` cubre los cuatro pares de `TRANSITIONS`.
- [x] 16.2 `components/ActionTransitionForm.tsx` envuelve el `<label>` de Note en la misma forma
  condicional que ya usan `EvidencePicker` y `Reason`: se dibuja si alguna transición disponible
  lo admite. El estado `note` y su limpieza no se tocan —oculto vale `''` y el `mutationFn` ya lo
  manda como `undefined`—, y el contrato tampoco: `note` es opcional en `transitionRequestSchema`.
- [x] 16.3 En `index.test.tsx`, la prueba del paso sin desplegar afirma ahora que en Assigned no
  hay campo de nota y que el botón «Start work» es todo el paso.
- [x] 16.4 El requisito de `specs/findings/spec.md` declara que no se presenta campo de nota en
  una transición que no la admite, con su escenario.

## 17. Asignar es arrancar

`open` era una parada con una sola salida y ninguna decisión: quien creaba la acción ya había
dicho la persona, el trabajo y la fecha, y el botón «Start work» que venía después solo agregaba
una espera entre el compromiso y el trabajo. La creación pasa a escribir los dos eventos.

- [x] 17.1 `ActionsService.createForParent` escribe, en la misma transacción y con el mismo actor
  e instante, `null → open` y `open → in_progress`. La autorización de crear cubre los dos: es un
  acto, no dos decisiones. Vale para el hallazgo y para la investigación —el mismo motor para los
  dos padres, que es lo que hace cierto que el incidente use el motor de la acción correctiva—.
- [x] 17.2 `TRANSITIONS`, la guarda de `0011` y `ACTION_STATES` NO se tocan: `open` sigue siendo
  el estado en el que una acción nace y el de las abiertas antes de este cambio, que se siguen
  empezando a mano desde la UI. Sin migración nueva.
- [x] 17.3 En `apps/web`, el borrador sigue adelantando el indicador a `assigned` —la etapa que
  escribe; adelantarlo hasta `in_progress` dibujaría Assigned cumplida sin marca de borrador— y que
  el trabajo arranque en el mismo acto lo dice la copia del paso `raised`: «The work is under way
  as soon as the action is created». `STAGE_BY_ACTION_STATE` conserva `open → assigned` y anota
  por qué.
- [x] 17.4 `corrective-actions.int-spec.ts` e `incidents.int-spec.ts`: `awaitingVerification` deja
  de arrancar el trabajo, el recorrido de R3 empieza en `in_progress`, y las pruebas del motor que
  necesitaban un par prohibido o una posición con hueco lo toman del estado vigente. La auditoría
  del origen del hallazgo pasa de dos eslabones a tres.
- [x] 17.5 `demo-content.mjs`: ningún paso del plan arranca en `open`, y la acción vencida que se
  escribe a mano suma su evento de arranque para tener la forma que la API produce.
- [x] 17.6 Delta de specs de `actions` en este change —la creación escribe el arranque, `open`
  sigue existiendo para lo abierto antes— y los escenarios de `findings` que enumeraban el
  agregado evento a evento.
- [ ] 17.7 `pnpm -r build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter api test:int`,
  `openspec validate ciclo-de-vida-del-hallazgo --strict`.

## 17. Las etapas alcanzadas se pueden leer

El indicador de etapas era decorativo y la ficha solo contaba el presente: quién asignó, con qué
nota se declaró el trabajo hecho o por qué lo devolvieron no se podía leer sin salir a
`/actions/$id`. Ese es justamente el registro que se defiende ante un regulador, y estaba a dos
clics de la pregunta que lo abrió. Elegir una etapa ya alcanzada abre acá mismo lo que quedó
registrado en ella; volver a la vigente devuelve el próximo paso intacto. Es navegación de
LECTURA: no agrega ninguna transición ni cambia quién puede ejecutar qué.

- [x] 17.1 `presentation.ts` gana lo decidible sin renderizar, con su prueba en
  `presentation.test.ts`: `readableStages` (las alcanzadas, que son las únicas con registro),
  `resolveStage` (la elegida si todavía se puede leer, y si no la vigente — se defiende del único
  retroceso que existe, `awaiting_verification → in_progress`), `stepThroughStages` (flechas, sin
  envolver en los extremos) y `eventsInStage` (los eventos de una acción mapeados a etapa con la
  MISMA tabla que usa `blockingActions`; un trabajo devuelto deja dos vueltas por In progress y
  las dos se leen).
- [x] 17.2 `FindingStepper` deja de ser decorativo: el `<ol>` es un `tablist`, cada etapa
  alcanzada es un `role="tab"` con roving tabindex y flechas/Home/End, y las futuras siguen siendo
  texto plano. `aria-current="step"` se conserva sobre la etapa vigente y no lo reemplaza
  `aria-selected`: en qué etapa está el hallazgo y cuál se está leyendo son dos cosas distintas.
- [x] 17.3 `FindingStageRecord.tsx` dibuja el panel. `raised` sale del propio hallazgo —observado,
  registrado y cuántas fotos— sin consultar nada; el resto pide `GET /actions/:id` con
  `queryKeys.action(id)` —la misma clave que `/actions/$id`, así que abrir el detalle después no
  cuesta una llamada— y **reutiliza `ActionEventList`**, que se exporta desde `ActionTimeline.tsx`:
  un evento tiene que leerse igual en las dos pantallas. Con la lectura caída lo dice, en vez de
  afirmar que la etapa no registró nada.
- [x] 17.4 `FindingLifecycle.tsx` es dueño de la selección y compone el indicador con el panel.
  `null` es «la vigente», así que avanzar el hallazgo no deja una selección obsoleta. **Nada se
  abre solo**: el panel se dibuja cuando hay paso que ofrecer o cuando alguien eligió una etapa —un
  recorte con cuarenta hallazgos cerrados no puede gastar cuarenta detalles para contestar una
  pregunta que nadie hizo—. Con un borrador abierto no se navega: el formulario se perdería al
  cambiar de panel y el indicador ya está adelantado a una etapa que no ocurrió.
- [x] 17.5 `index.css` gana `.finding__stage-tab` —el botón es todo el segmento, hereda color y
  peso del `li` y solo agrega la rejilla— y `.finding__stage-record`, con el filete neutro: el paso
  se queda con el azul porque es el único llamado a la acción de la ficha, y lo que ya ocurrió es
  lectura.
- [x] 17.6 En `index.test.tsx`, `aria-current` se busca donde ahora vive y se agrega la navegación:
  abrir una etapa alcanzada muestra su nota y retira el paso, el ciclo no se mueve, volver devuelve
  el paso, las flechas recorren, una etapa futura no es un control, `Raised` no consulta ninguna
  acción, sin red se dice, una etapa que nadie abrió no gasta consulta y con el borrador abierto
  los tabs están deshabilitados.
- [x] 17.7 El requisito de `specs/findings/spec.md` declara la lectura de una etapa alcanzada, que
  es de solo lectura, que una etapa no alcanzada no se ofrece y que un registro ilegible no se
  informa como vacío, con sus tres escenarios.
