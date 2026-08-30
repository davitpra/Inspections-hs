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
próximo paso no se despliega ni abre nada: los DOS actos principales —avanzar una acción que existe
y crear la primera— se escriben dentro del bloque, y los botones de su formulario son los únicos
controles del paso. La historia completa de la acción tampoco está en la ficha: se lee en
`/actions/$id`, la pantalla propia de la acción, y la ficha se queda con el próximo paso.

La única asimetría es que crear se pide: `raised` dibuja primero el botón, porque el borrador tiene
tres campos que nadie pidió todavía y un recorte de cuarenta hallazgos abriría cuarenta
formularios. Avanzar no tiene nada que pedir —sus campos SON el paso—. Por eso el bloque dibuja el
botón o el borrador, nunca los dos: el botón repite el nombre que el `h3` ya dice, que es lo mismo
que hizo caer el disclosure.

### Asignar es arrancar: la creación escribe los dos eventos

`open` era una parada con un solo salida posible y ninguna decisión que tomar. Quien creaba la
acción ya había dicho la persona, el trabajo y la fecha; el botón «Start work» que venía después
no agregaba nada al registro y sí una espera —a veces de días, si el responsable no entraba— entre
el compromiso y el trabajo. Así que la creación escribe DOS eventos en su transacción, `null →
open` y `open → in_progress`, con el mismo actor y el mismo `occurred_at`.

**Dos eventos y no uno.** Escribir directo `null → in_progress` habría hecho falta agregar una
fila a `TRANSITIONS` y a la guarda de la migración `0011`, y habría dejado `open` inalcanzable —un
estado del contrato y del `CHECK` que ya no significa nada—. Con dos, la máquina de estados no se
toca, `open` sigue siendo el estado en el que una acción nace, y las acciones abiertas antes de
este cambio siguen teniendo su paso a mano, que la UI sigue ofreciendo.

**La autorización es la de crear.** `open → in_progress` está en `TRANSITIONS` para el responsable
y el coordinador; acá lo escribe también quien reportó el hallazgo (ADR-017), porque es el mismo
acto que ya se le permitió. La distinción que esa fila protege —quién declara que el trabajo
arrancó— no se pierde, se resuelve al crear.

El hallazgo atraviesa `assigned` en la misma transacción: el trigger de `0040` recalcula el
agregado evento a evento, así que el stream dice `raised → assigned → in_progress` con un solo
instante. La etapa no se falsea ni se saltea; queda registrado quién asignó, a quién, y que el
trabajo empezó ahí mismo.

### El borrador adelanta la etapa, y lo declara

Mientras el borrador está abierto el indicador señala `assigned`, la etapa que ese borrador está
escribiendo. Adelanta una sola: crear la acción termina dejando el hallazgo en `in_progress`, pero
señalar esa etapa dibujaría Assigned como cumplida —verde, sin marca de borrador— y eso es afirmar
una asignación que todavía no existe. Que el trabajo arranque en el mismo acto lo dice la copia del
paso, que es donde se puede decir con palabras.

No es una proyección del estado —no deriva de las acciones, que es justo lo que la sección 11
retiró—: es el borrador local, y por eso se marca como tal, con el filete punteado y con
palabras en el encabezado del bloque («Draft — no action created yet»). El plazo se sigue leyendo
del estado GUARDADO, no del adelantado: sale de las acciones que retienen el hallazgo, y mientras
el borrador está abierto no hay ninguna. Cancelar devuelve el indicador a `raised`.

La regla que esto respeta es la de siempre: la pantalla no afirma lo que la tabla no dice. Un
indicador que se adelantara sin decirlo sería una transición inventada; uno que no se moviera
dejaría al usuario escribiendo un compromiso sin ver hacia dónde lleva.

El borrador abierto vive en la ruta y no en la fila, por id de hallazgo y uno a la vez: lo miran
dos hermanos —el indicador y el próximo paso— y ninguno es padre del otro.

### El paso que no pide nada no dibuja campos

`ActionTransitionForm` dibujaba el textarea «Note (Optional)» en toda transición. Debajo de una
copia que dice «No additional information is required», y delante del único botón que importa, eso
es un campo que desmiente al paso. Qué transición admite nota es ahora una tabla por PAR de estados
en `presentation/actions.ts`, al lado de las etiquetas y por el mismo motivo: el par es la unidad
de decisión. Solo `open → in_progress` no la admite; el default es admitirla, para que una
transición nueva no se quede muda por olvido.

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
- **La etapa `assigned` deja de ser un lugar donde un hallazgo descansa.** → Sigue en el ciclo y
  se sigue registrando: es el instante en que se nombró al responsable, y el stream lo conserva
  con su actor. Lo que desaparece es la espera, no el hecho.
- **La caché muestra el estado anterior después de una mutación exitosa.** → Las mutaciones
  invalidan acciones, hallazgos e inspecciones, con pruebas sobre las claves compartidas.
- **Un writer intenta alterar o borrar el stream.** → REVOKE, triggers de inmutabilidad y pruebas
  de integración cubren `hs_app` y el rol dueño; RLS cubre lectura e inserción por sitio.
