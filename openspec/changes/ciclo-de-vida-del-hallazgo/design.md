## Context

Ver `proposal.md` — Why. La primera implementación calculó la etapa en
`InspectionFindingsRoute/presentation.ts` desde `ActionSummary[]`. Esa solución ya entregó el
stepper y el próximo paso, pero el cálculo local no es una fuente de verdad auditable y no sirve a
la lista de hallazgos ni a otras lecturas que no tengan las acciones.

ADR-002 y ADR-004 prohíben resolverlo con `finding.state`: tanto `finding` como
`corrective_action` son inmutables. ADR-008 permite que `actions` referencie datos de `findings`,
pero no que `findings` llame al módulo de acciones; por eso la derivación transversal debe quedar
en la base, en la costura atómica donde se inserta `corrective_action_event`.

Este change **sí toca tablas inmutables**: crea `finding_state_event`, append-only, y añade
triggers sobre `finding` y `corrective_action_event`. No modifica filas históricas de `finding` ni
añade una columna de estado.

## Goals / Non-Goals

**Goals:**

- Hacer auditable cada cambio del ciclo `raised → assigned → in_progress → verification →
  closed`, incluidas las regresiones.
- Garantizar en PostgreSQL que un hallazgo nunca exista sin evento inicial y que un evento de
  acción no pueda confirmarse sin el evento de hallazgo que cause cuando cambia el agregado.
- Exponer el estado vigente en `Finding` y hacer que todas las superficies lean el mismo valor.
- Conservar el próximo paso y los detalles de acciones ya implementados.

**Non-Goals:**

- Añadir una columna mutable o una API para escribir directamente el estado del hallazgo.
- Cambiar la máquina, permisos, evidencias o escalamiento de acciones correctivas.
- Exponer en esta revisión la historia completa de `finding_state_event` mediante un endpoint.
- Convertir el estado `closed` en terminal: una nueva acción puede reabrir operativamente el
  hallazgo al producir un evento `assigned`.

## Decisions

### `finding_state_event` es la única fuente de verdad

La tabla guarda `id`, `finding_id`, `site_id`, `position`, `from_state`, `to_state`,
`source_action_event_id`, `actor_user_id`, `occurred_at` y `recorded_at`. El evento inicial tiene `position = 0`,
`from_state = NULL`, `to_state = 'raised'` y causa nula. Los eventos posteriores referencian el
`corrective_action_event` que causó el recálculo. Un único `(finding_id, position)` evita bifurcar
el stream y la FK compuesta conserva el sitio.

La alternativa de una columna `finding.state` abarata la lectura, pero crea dos verdades o exige
UPDATE sobre una tabla inmutable. La alternativa de seguir calculando en cada consumidor no deja
historia y hace depender el significado del hallazgo de qué joins tenga una pantalla. Ambas se
descartan por ADR-002.

El esquema Drizzle vive en `apps/api`; `packages/contracts` solo publica `FINDING_STATES`, su
schema y `Finding.state`.

### La base escribe el evento inicial y los eventos derivados

Un trigger sobre `finding` inserta el evento inicial dentro de la misma transacción. La garantía
se completa con una restricción diferida que impide confirmar un hallazgo sin evento, siguiendo
el patrón que ya protege acciones y fotos.

Un trigger `AFTER INSERT` sobre `corrective_action_event` localiza el hallazgo padre. Si la acción
pertenece a una investigación no hace nada; si pertenece a un hallazgo, lee el último estado de
cada acción de ese hallazgo, ordena `open < in_progress < awaiting_verification < closed` y deriva:

- ninguna acción: `raised`;
- al menos una acción: el mapeo de la menos avanzada;
- todas cerradas: `closed`.

Solo inserta `finding_state_event` cuando el resultado difiere del último evento del hallazgo. Al
ser trigger de la misma sentencia causal, un rollback elimina los dos eventos. La creación de una
acción ya incluye su evento `NULL → open`, por lo que el mismo camino lleva `raised` o incluso
`closed` a `assigned`. El rechazo `awaiting_verification → in_progress` lleva el agregado a
`in_progress` salvo que otra acción menos avanzada determine un estado anterior.

La alternativa de hacerlo en `ActionsService` viola la defensa en profundidad: un seed, una
migración o un futuro writer podría insertar el evento de acción sin actualizar el hallazgo.
El servicio sí toma un advisory lock transaccional por `finding_id` antes de insertar acciones o
transiciones: no escribe el estado, solo serializa dos acciones distintas para que el segundo
trigger lea el agregado confirmado por el primero. La fila inmutable de `finding` no se bloquea
con `FOR UPDATE`, operación que correctamente no tiene concedida.

### La API obtiene el estado del último evento

Los repositorios que construyen un `Finding`, incluida la lectura de una inspección enviada, usan
una subconsulta lateral al último `finding_state_event` por `position DESC`. La ausencia de evento
es corrupción y no se convierte silenciosamente en `raised`. No aparece un endpoint de mutación ni
un campo de entrada para estado.

### La UI consume `finding.state` y conserva las acciones para el próximo paso

`findingStage(actions)` y su supuesto «si no hay acciones, raised» se retiran. `FindingStepper`
recibe `finding.state`. Las acciones siguen siendo necesarias para identificar el compromiso que
bloquea, calcular el plazo y ofrecer una transición permitida; el estado del hallazgo ya no depende
de que esa consulta haya terminado.

Crear o avanzar una acción invalida `queryKeys.actions()`, el detalle `queryKeys.action(id)` cuando
corresponda, `queryKeys.findings()` y el prefijo `queryKeys.submittedInspection()`. Así se refrescan
la lista y cualquier reporte o recorte de inspección que contenga `Finding.state`. Esta amplitud es
deliberada: el formulario compartido no siempre conoce el identificador de la inspección.

La composición, accesibilidad y tokens de ADR-012 de la implementación anterior permanecen. El
próximo paso no se despliega: `ActionTransitionForm` se dibuja dentro del bloque, así que el único
acto principal de la pantalla se envía con una sola pulsación y los botones del formulario son sus
únicos controles. La historia completa de la acción tampoco está en la ficha: se lee en
`/actions/$id`, la pantalla propia de la acción, y la ficha se queda con el próximo paso.

### La migración `0040` establece un baseline antes de habilitar escrituras

La migración crea tabla, checks, índices, FKs y funciones; inserta para cada hallazgo histórico el
estado agregado vigente en posición `0`. No fabrica una historia retroactiva que el sistema todavía
no registraba. Después instala los triggers para nuevas escrituras, registra el stream en auditoría,
ejecuta `hs_make_immutable` y `hs_apply_site_isolation`, concede solo SELECT/INSERT a `hs_app` y
hace REVOKE explícito de UPDATE/DELETE/TRUNCATE.

El despliegue aplica `0040` antes de publicar contratos/API/web. El rollback de aplicación es
compatible con la tabla adicional, pero la migración no se revierte borrando evidencia; una
corrección se entrega hacia adelante.

## Risks / Trade-offs

- **Dos acciones cambian concurrentemente y ninguna observa a la otra.** → `ActionsService`
  serializa por `finding_id` con un advisory lock transaccional; el único
  `(finding_id, position)` sigue siendo la última barrera contra bifurcaciones fuera de ese camino.
- **El backfill aparenta una historia que no se registró.** → Crea un solo baseline con el agregado
  vigente al migrar y deja explícito que el stream histórico comienza allí.
- **Una consulta olvida unir el último evento.** → El contrato hace `state` obligatorio y las
  pruebas cubren lista, detalle y lectura de inspección.
- **La caché muestra el estado anterior después de una mutación exitosa.** → Las mutaciones
  invalidan acciones, hallazgos e inspecciones, con pruebas sobre las claves compartidas.
- **Un writer intenta alterar o borrar el stream.** → REVOKE, triggers de inmutabilidad y pruebas
  de integración cubren `hs_app` y el rol dueño; RLS cubre lectura e inserción por sitio.
