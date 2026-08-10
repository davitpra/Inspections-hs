# Acciones correctivas: ciclo de vida como stream de eventos

## Why

`findings-and-risk-classification` cerró la etapa 4 con una consecuencia declarada por escrito en
su propia propuesta: «al terminar este change un hallazgo queda registrado, ubicado, fotografiado
y clasificado, **y nadie tiene todavía la obligación de arreglarlo**». Hoy el sistema sabe que la
guarda de la línea 3 falta y no sabe de quién es el problema, para cuándo, ni cómo se comprueba
que se resolvió. El recorrido **R3** de `docs/Requisitos_V1.2.md` §3 —cierre verificado de la
acción— no existe.

Este change cierra la **etapa 5** de §7 —«Acciones correctivas, eventos, escalamientos con
pg-boss», con R3 como propiedad probada— y es el único change de esa etapa. Es además el primer
consumidor real de `pg-boss` para el trabajo que ADR-005 nombra explícitamente como su motivo de
existir: «escalamiento de acciones vencidas: +3 días al supervisor, +7 días a gerencia».

## Lo que este change NO es

**No es incidentes.** §4 dice que el incidente usa «el mismo motor que la acción correctiva». El
motor se construye acá y se prueba acá con un solo consumidor. La segunda máquina de estados —con
sus guardas propias, entre ellas «no se cierra con acciones abiertas»— es la etapa 6. Este change
deja el motor genérico solo hasta donde el segundo consumidor está a la vista; no inventa
abstracción para un usuario que todavía no existe.

**No es aprobación en dos pasos ni segunda firma.** Están fuera de alcance de v1 por decisión
explícita. Verificar es un solo acto de una sola persona: la única regla es que esa persona no sea
la que ejecutó.

**No es la remediación compartida como entidad.** La pregunta cerrada 9 resolvió que
`remediation_group_id` es «opcional y sin semántica»: agrupa en la UI y en reportes y **no altera
plazos, escalamientos ni verificación**. Se guarda la columna porque el modelo la pide; no se
escribe ninguna consulta ni pantalla que la use. Eso es etapa 7 si alguien lo pide.

**No es el tablero de vencimientos.** Que una acción esté vencida es una consulta sobre
`due_at`, no un estado ni una columna. Este change garantiza que el dato exista y que el
escalamiento llegue; los dashboards de gerencia son etapa 7.

## What Changes

- **La acción correctiva cuelga de un hallazgo clasificado, con una persona nombrada y una fecha
  límite derivada de la severidad.** Un hallazgo sin clasificación vigente no puede recibir
  acciones: sin severidad no hay fecha límite, y una acción sin fecha límite no escala nunca —
  sería una obligación que el sistema no puede hacer cumplir.
- **El estado es una consulta, no una columna.** `corrective_action_event` es append-only y el
  estado vigente sale de `SELECT DISTINCT ON (action_id) ... ORDER BY action_id, seq DESC`, tal
  como ADR-002 lo escribió. **La tabla `corrective_action` no tiene columna `status`**, y su
  ausencia es el requisito.
- **La máquina de estados es una función pura sin base de datos.** `open` → `in_progress` →
  `awaiting_verification` → `closed`, más el rechazo de la verificación que devuelve a
  `in_progress`. Transiciones, roles habilitados y datos exigidos por transición viven en
  `packages/contracts` bajo tabla de casos, y el servicio las consulta. Una transición ilegal se
  rechaza dos veces: por la función pura y por una guarda en SQL.
- **La fecha límite también es una función pura.** `dueAt(severity, from)` con la tabla
  severidad → días, probada celda por celda. Deriva de la **severidad** y no del `risk_level`,
  porque es lo que dice §3 R2 textualmente.
- **La fecha límite se congela al crear la acción.** Reclasificar el hallazgo después **no mueve**
  el plazo de una acción ya abierta. Consecuencia declarada, no descuido: mover plazos hacia
  adelante desde una reclasificación convertiría el vencimiento en algo negociable, y el registro
  que puede terminar ante el MLITSD dejaría de decir qué se prometió el día que se prometió. Si la
  severidad nueva exige otra urgencia, se abre otra acción.
- **La verificación la hace alguien distinto del ejecutor.** No es una comprobación de cortesía en
  el servicio: la guarda compara el actor del evento de verificación con el autor del evento que
  llevó la acción a `awaiting_verification`, y está escrita también en SQL.
- **Evidencia de cierre obligatoria.** Declarar el trabajo hecho exige al menos una evidencia
  `after`; las object keys viajan como en todo el sistema, y una evidencia **nunca** lleva bytes.
  La ausencia de evidencia falla al commit, con el mismo mecanismo de restricción diferida que ya
  usa la foto obligatoria del hallazgo.
- **Escalamiento por pg-boss, +3 y +7 días, idempotente.** Cron diario que busca acciones vencidas
  sin cerrar y notifica: a los supervisores del sitio a los +3, a gerencia a los +7. Una fila por
  `(action_id, level)` hace que treinta corridas del mes notifiquen una sola vez, con el mismo
  patrón de idempotencia que `inspections.open-period`.
- **La bandeja gana tres tipos de notificación** —asignación, escalamiento a supervisor,
  escalamiento a gerencia— y por primera vez el payload de `notification` deja de ser de un solo
  tipo: `notificationSchema` pasa a ser una unión discriminada por `kind`. **BREAKING** para
  cualquier consumidor que hoy asume `InspectionPeriodOpenedPayload`.
- **La bandeja del responsable existe.** El supervisor que tiene acciones asignadas las ve, las
  pasa a `in_progress`, carga evidencia y declara el trabajo hecho, todo online: una acción
  correctiva no se ejecuta sin señal en medio de un invernadero.

## Capabilities

### New Capabilities

- `actions`: qué es una acción correctiva, de qué hallazgo cuelga, quién es su responsable, de
  dónde sale su fecha límite, qué transiciones existen y quién puede hacer cada una, qué evidencia
  exige el cierre, quién puede verificar, y cuándo y a quién escala una acción vencida.

### Modified Capabilities

- `immutability`: `corrective_action`, `corrective_action_event`, `corrective_action_evidence` y
  `corrective_action_escalation` entran a la lista de tablas que ningún rol —tampoco
  `hs_migrator`— puede modificar ni borrar.
- `audit`: cuatro tipos de evento nuevos —`action.created`, `action.transitioned`,
  `action.escalated`, `action.evidence_added`— escritos por trigger, con la misma regla de doble
  reloj y la misma cadena de hashes por sitio.
- `inspections`: `notification.payload` deja de tener una sola forma. El requisito de la
  notificación de apertura de período no cambia en su contenido, pero su forma pasa a estar
  discriminada por `kind` junto a las tres nuevas.

## Impact

- **Esquema**: migración `0011_corrective_actions.sql`. Crea las cuatro tablas con
  `hs_make_immutable` y `hs_apply_site_isolation`, las FK compuestas contra `(id, site_id)` de
  `finding` —que 0010 ya expone—, la guarda de transición, la guarda de verificador distinto, la
  restricción diferida de evidencia y los triggers de auditoría. `GRANT SELECT, INSERT` y nada
  más.
- **`packages/contracts`**: `actions.ts` con la máquina de estados, la tabla de plazos por
  severidad, las formas de creación, transición y evidencia; `notifications.ts` pasa a unión
  discriminada.
- **`apps/api/src/actions`**: módulo nuevo (`controller → service → repository` + las funciones
  puras del motor y del plazo) y el handler del cron de escalamiento.
- **`apps/api/src/jobs`**: `JobPayloads` gana `actions.escalate-overdue` — el segundo de los tres
  trabajos que ADR-005 enumeró y que `job-registry.ts` ya dejó anotados por nombre.
- **`apps/web`**: la bandeja gana el detalle de la acción y la pantalla del responsable; el
  hallazgo gana su lista de acciones y el formulario de creación del coordinador.
- **Deuda declarada hacia la etapa 6**: §4 dice que una acción pertenece a un `Hallazgo` **o** a
  una `Investigación`, con dos FK nullable y un `CHECK` de exactamente-una. La tabla
  `investigation` no existe todavía, así que este change escribe `finding_id NOT NULL` y la etapa
  6 hace el `ALTER` que agrega `investigation_id`, relaja el `NOT NULL` y agrega el `CHECK`. Se
  registra acá para que ese `ALTER` sea un paso previsto de la etapa 6 y no una sorpresa.
- **Consumidores futuros**: `incidents` (etapa 6) reusa el motor de estados y agrega la guarda de
  «no se cierra con acciones abiertas»; `reporting` (etapa 7) cuenta acciones vencidas y tiempos
  de cierre.
