# Diseño — Acciones correctivas: ciclo de vida como stream de eventos

## Context

Ver `proposal.md` — Why. Lo que condiciona la forma es lo que ya está construido:

- **El mecanismo de inmutabilidad y aislamiento está hecho y probado.** `hs_make_immutable`,
  `hs_apply_site_isolation`, `hs_audit_entry_at` y la cadena de `audit_log` con su lock por sitio
  vienen de 0001 y 0002. Este change los usa; no inventa mecanismo.
- **Los patrones que este change necesita ya tienen precedente en 0010.** La restricción diferida
  (`CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`, SQLSTATE `HS003` para la foto
  obligatoria), el trigger de guarda que lee otra fila para validar una relación
  (`hs_finding_assessment_guard`, `HS002`), el único parcial que impide bifurcar un historial, y
  la regla escrita dos veces —TypeScript y SQL— con un test de integración que compara las dos.
  Los SQLSTATE de este change siguen en el mismo espacio `HS`, a partir de `HS004`.
- **`finding` ya expone `UNIQUE (id, site_id)`.** Las FK compuestas de este change tienen destino:
  **no hace falta ningún `ALTER` sobre una tabla inmutable existente**.
- **`pg-boss` está en producción con un solo trabajo.** `job-registry.ts` deja escrito por nombre
  que faltan dos, y este es uno de ellos. El patrón de `inspections.open-period` —cron diario,
  `now?` en el payload, idempotencia por restricción de base y no por consultar lo ya hecho— es el
  que este change repite.
- **`notification` existe con un solo `kind`** y su `payload` está tipado como
  `InspectionPeriodOpenedPayload` en el contrato y en el servicio. Ese es el punto que se rompe.

**Tablas inmutables que este change toca:** crea cuatro nuevas —`corrective_action`,
`corrective_action_event`, `corrective_action_evidence`, `corrective_action_escalation`— las
cuatro con `hs_make_immutable`. **No modifica ninguna tabla inmutable existente**, ni con `ALTER`,
ni agregando columnas, ni agregando restricciones.

ADRs aplicables: **ADR-002** (inmutabilidad por motor; el estado de la acción como consulta y no
como columna, con la consulta escrita literalmente en el ADR), **ADR-004** (SQL a mano, RLS),
**ADR-005** (pg-boss para el escalamiento +3/+7, que el ADR nombra como su primer motivo),
**ADR-006** (evidencia por object key, presigned URLs, sin credenciales de borrado), **ADR-008**
(reglas como funciones puras, dirección de dependencias entre módulos).

## Goals / Non-Goals

**Goals:**

- Que no exista ningún camino —endpoint, seed, `INSERT` a mano— por el que una acción tenga un
  estado que la máquina no permite, una fecha límite que la tabla de severidad no dio, un cierre
  sin evidencia, o un cierre firmado por quien ejecutó.
- Que la máquina de estados y el plazo sean funciones puras: sin base, sin Nest, testeadas con
  tabla de casos en milisegundos, y por lo tanto reusables por la etapa 6 sin arrastrar nada.
- Que el escalamiento sea idempotente por construcción, de modo que un cron diario sobre un mes
  entero produzca dos notificaciones y no sesenta.
- Que `notification` deje de mentir sobre su payload antes de que haya tres consumidores.

**Non-Goals:**

- Generalizar el motor de estados para el incidente. Un solo consumidor no justifica una
  abstracción; la etapa 6 la extrae cuando el segundo exista y sepamos en qué se parecen de
  verdad.
- Reabrir una acción cerrada. `closed` es terminal (D14).
- Captura offline de acciones. Se ejecutan online (D15).
- Consultas de vencimiento agregadas, tableros y tiempos de cierre. Etapa 7.

## Decisions

### D1 — El estado es `DISTINCT ON` sobre los eventos, y no hay columna que lo guarde

La consulta es la que ADR-002 escribió, sobre el índice `(action_id, position DESC)`:

```sql
SELECT DISTINCT ON (e.action_id) e.action_id, e.to_state
  FROM corrective_action_event e
 ORDER BY e.action_id, e.position DESC
```

En el listado va como `LEFT JOIN LATERAL` con `LIMIT 1`, igual que 0010 resuelve la clasificación
vigente. Con 200 personas y decenas de acciones al año, el costo es irrelevante durante toda la
vida útil del sistema —ADR-002 lo dice con esas palabras—.

**No hay columna `status`, y la ausencia es el requisito**, no una omisión: una columna de estado
sobre tablas donde `UPDATE` está revocado sería imposible de mantener, y mantenerla con un trigger
sería reintroducir por la puerta de atrás la única fuente de verdad que ADR-002 rechazó.

Alternativas descartadas:

- **Columna cacheada actualizada por trigger.** Requiere `UPDATE` sobre una tabla que no lo tiene,
  y el día que difiera del stream nadie sabría cuál de las dos manda.
- **Vista materializada.** Refresco a mantener, latencia a explicar, para una consulta que en este
  volumen es un índice.

### D2 — El orden del stream es `position` por acción, no un `seq` global

ADR-002 escribe `ORDER BY seq DESC`. Acá esa columna se llama `position` y es un entero **por
acción**, con `UNIQUE (action_id, position)`.

El motivo es que un `bigserial` global ordena pero no protege: dos requests que mueven la misma
acción a la vez obtendrían dos `seq` distintos y ambos commitearían, dejando dos eventos que
parten del mismo estado. Con `position` calculada como «la última de esta acción + 1», la carrera
la resuelve el único —uno commitea, el otro falla con violación de unicidad— exactamente como el
único sobre `supersedes_id` resuelve la reclasificación concurrente en 0010. Es el mismo problema
y merece la misma defensa, no una nueva.

El orden global, cuando haga falta, lo da `recorded_at` y sobre todo la cadena de `audit_log`, que
ya es un orden total por sitio.

### D3 — La máquina de estados vive en `packages/contracts`, no en `packages/forms`

`packages/forms` es el motor de formularios y va adentro del service worker; una máquina de
estados de acciones correctivas no tiene nada que hacer ahí. La tabla de transiciones es un dato
del contrato entre cliente y servidor —el cliente necesita saber qué botón mostrar— así que vive
en `packages/contracts/src/actions.ts`, que ya es dependencia de las dos mitades y no arrastra
Node.

La tabla es un dato, no un `switch`:

```ts
export const TRANSITIONS = [
  { from: null, to: 'open', roles: ['hs_coordinator'], requires: [] },
  { from: 'open', to: 'in_progress', roles: ['assignee', 'hs_coordinator'], requires: [] },
  { from: 'in_progress', to: 'awaiting_verification',
    roles: ['assignee', 'hs_coordinator'], requires: ['after_evidence'] },
  { from: 'awaiting_verification', to: 'closed',
    roles: ['hs_coordinator', 'supervisor', 'management'], requires: ['not_executor'] },
  { from: 'awaiting_verification', to: 'in_progress',
    roles: ['hs_coordinator', 'supervisor', 'management'], requires: ['not_executor', 'reason'] },
] as const;
```

`assignee` no es un rol de `ROLES`: es una posición relativa a la acción, y por eso se resuelve en
el servicio contra `app_user.person_id`, no en la tabla. Que esté escrito como pseudo-rol en la
misma lista es deliberado —las cinco filas son la respuesta completa a «quién puede hacer qué»—.

`transitionFor(from, to)` devuelve la fila o `undefined`, y las 20 combinaciones ordenadas de los
cuatro estados están en el test.

### D4 — La misma tabla, escrita otra vez como guarda en SQL

Un `BEFORE INSERT` sobre `corrective_action_event` lee el último evento de la acción y falla si
`NEW.from_state` no es su `to_state`, si el par `(from_state, to_state)` no está en la tabla, o si
el estado actual es `closed`. Falla con `HS004`.

La duplicación es la misma que 0010 acepta para la matriz de riesgo, por el mismo motivo: SQL no
puede importar TypeScript, y la barrera tiene que valer para el `INSERT` que no pasó por el
endpoint. Y como en 0010, la defensa contra la divergencia es una prueba, no la disciplina: un
test de integración evalúa los 20 pares ordenados por los dos caminos y compara.

**El trigger no cierra la carrera y no pretende hacerlo.** Dos transacciones concurrentes leen el
mismo «último evento» y las dos pasan la guarda; la que pierde muere en el único de
`(action_id, position)` (D2). El trigger es la barrera de corrección, el único es la de
concurrencia. Escribirlo así —en vez de un `SELECT ... FOR UPDATE` sobre la acción— evita tomar un
lock de fila en el camino feliz para un conflicto que en este volumen no va a ocurrir nunca.

### D5 — `due_at` y `severity` se congelan en la fila de la acción

La acción guarda `severity` —copiada de la clasificación vigente al crearse— y `due_at` —calculada
de esa severidad—. `dueAt(severity, from)` es pura, con la tabla 3/7/14/30/60 días.

Congelar y no derivar al leer es la decisión, y tiene costo: si el coordinador reclasifica el
hallazgo de `moderate` a `catastrophic`, la acción abierta conserva sus 14 días. Se acepta porque
la alternativa es peor: un plazo que se recalcula es un plazo que se puede mover, y el registro
dejaría de poder decir qué se prometió el día que se prometió. La salida operativa —abrir una
acción nueva con el plazo corto— deja las dos cosas en el registro.

Que derive de la **severidad** y no del `risk_level` no es preferencia: §3 R2 dice «fecha límite
derivada de la severidad». El `risk_level` sirve para priorizar y reportar; el plazo es de la
severidad.

La tabla es configuración en código, con el mismo cartel que §4 le pone a la lista de
clasificaciones que obligan investigación: el sistema la trata como configuración, no como regla
legal autoritativa.

### D6 — El verificador se compara contra el autor del evento de completado, en SQL

Un `BEFORE INSERT` (`HS005`) sobre los eventos que salen de `awaiting_verification` busca el
evento de mayor `position` con `to_state = 'awaiting_verification'` y falla si su `actor_user_id`
es el de `NEW`.

Contra el evento de completado y no contra `assignee_person_id`: el ejecutor real es quien declaró
el trabajo hecho, que puede ser el coordinador actuando en nombre de una persona sin cuenta. Si
comparáramos contra la persona asignada, ese coordinador podría verificarse a sí mismo, que es
exactamente lo que R3 prohíbe.

### D7 — La evidencia cuelga del evento, no de la acción

`corrective_action_evidence` referencia `event_id` además de `action_id`. Sin eso, «las fotos del
cierre» y «las fotos que alguien subió después» serían indistinguibles, y una acción rechazada y
re-completada tendría dos juegos de evidencia mezclados en una sola bolsa.

La obligación de al menos una evidencia `after` se verifica con una `CONSTRAINT TRIGGER`
`DEFERRABLE INITIALLY DEFERRED` sobre `corrective_action_event`, activa solo cuando
`to_state = 'awaiting_verification'` (`HS006`). Diferida por la misma razón que la foto del
hallazgo en 0010: la evidencia necesita el `event_id`, así que el orden natural es evento primero,
evidencia después, y al commit es el único momento en que la pregunta tiene respuesta.

### D8 — Una acción no puede existir sin su primer evento

Segunda `CONSTRAINT TRIGGER` diferida, sobre `corrective_action` (`HS007`): al commit, una acción
sin ninguna fila en `corrective_action_event` falla. Es lo que hace que «el estado es una
consulta» no tenga el caso degenerado de la consulta que no devuelve nada.

### D9 — El prefijo de la evidencia es `{site_id}/actions/{action_id}/`

A diferencia del hallazgo manual, cuando se sube evidencia la acción **ya existe**: no hace falta
un `draft_*_id` generado por el cliente. La tercera afirmación de prefijo del sistema es una
tercera función —`foreignEvidenceKeys`— y no un parámetro de las anteriores, por el motivo que
`object-key.ts` ya dejó escrito: compartirla haría que el día que una cambie mal, cambien las tres
juntas y ningún test lo note.

### D10 — El escalamiento es un cron diario idempotente por fila, no por consulta

`actions.escalate-overdue`, con `now?` en el payload como `inspections.open-period`, por el mismo
motivo: poder correr a mano el escalamiento del día que el planificador estuvo caído, sin mover el
reloj del servidor.

Por cada acción no cerrada con `due_at < now - 3 días` se intenta un
`INSERT ... ON CONFLICT (action_id, level) DO NOTHING`; solo si la fila se creó se escriben las
notificaciones. La idempotencia es la restricción de base, no un `WHERE NOT EXISTS` calculado
antes: entre el cálculo y el `INSERT` cabe otra corrida.

**El escalamiento no es un estado y no toca el stream.** Es un hecho sobre una acción, no un paso
de su ciclo de vida: meterlo como evento haría que el estado vigente de una acción vencida fuese
`escalated` y se perdería si estaba en progreso o esperando verificación, que es justo lo que el
supervisor necesita saber.

Que el sistema esté caído tres días no pierde nada: la condición es sobre `due_at`, no sobre «lo
que pasó ayer», así que la primera corrida que encuentre la base arriba escala todo lo vencido.

### D11 — `notification.payload` pasa a unión discriminada por `kind`

`notificationSchema` deja de tener un payload de un solo tipo y pasa a `z.discriminatedUnion` por
`kind`, con las cuatro variantes. El comentario que ya está en `notifications.ts` —«la lista de
`kind` está cerrada y agregar uno es una migración: el consumidor tiene que saber leer el
payload»— es exactamente esta decisión, cobrada por primera vez.

Es **BREAKING** para el tipo `Notification` y para `NotificationsService`, que hoy tipa
`payload: InspectionPeriodOpenedPayload`. Sin usuarios en producción, el costo es un despliegue
coordinado; la alternativa —un `payload: unknown` con casts en la UI— es la forma de que el día
que agreguemos el quinto tipo nadie se entere de que falta renderizarlo.

### D12 — Persona nombrada como responsable, cuenta como actor

`assignee_person_id` es un `person`, porque §3 R2 pide una persona nombrada y el roster tiene 200
personas de las que solo 15-20 tienen cuenta. `actor_user_id` de cada evento es un `app_user`,
porque el log de auditoría tiene que poder decir quién hizo el acto.

La referencia es a `person (id)` a secas y no una FK compuesta con el sitio: 0005 dejó escrito por
qué `person` no lleva `UNIQUE (site_id, id)` —`person.site_id` es mutable, y congelar el par haría
que transferir a alguien invalidara retroactivamente, o con `ON UPDATE CASCADE` reescribiera, los
registros que lo nombran—. Que el responsable sea del sitio se verifica al crear la acción, y que
el selector solo ofrezca gente del sitio lo garantiza la política RLS de `person`. Es la misma
regla que 0005 anticipó para las etapas 4 a 6.

La autorización de «avanzar mi propia acción» se resuelve comparando
`app_user.person_id = corrective_action.assignee_person_id`, o rol `hs_coordinator`. Una acción
asignada a alguien sin cuenta la registra el coordinador, y el evento nombra al coordinador: el
registro dice la verdad sobre quién tocó el sistema, y `assignee_person_id` dice la verdad sobre
de quién era la obligación. Son dos hechos distintos y el modelo los guarda por separado.

### D13 — El parentesco de la etapa 6 se paga en la etapa 6

§4 pide `finding_id` e `investigation_id` nullable con un `CHECK` de exactamente-una. `investigation`
no existe, y una FK a una tabla inexistente no se puede escribir; una columna sin FK sería un
padre no verificado, que en un registro inmutable es peor que no tenerla.

Este change escribe `finding_id NOT NULL`. La etapa 6 hace el `ALTER TABLE` que agrega
`investigation_id`, relaja el `NOT NULL` y agrega el `CHECK`. Es DDL del rol dueño sobre una tabla
inmutable —permitido: la inmutabilidad es sobre las filas, no sobre el esquema— y queda anotado en
la propuesta para que sea un paso previsto de esa etapa.

### D14 — `closed` es terminal

R3 no pide reapertura. Si el trabajo se deshizo, lo que hay es un hallazgo nuevo con su propia
fecha y su propia clasificación, que es además lo único que la detección de recurrencia de la
etapa 7 puede contar. El incidente **sí** pide reapertura (§4), y ahí se paga: es una fila más en
la tabla de transiciones de esa máquina, no un cambio en esta.

### D15 — Las acciones se ejecutan online

`offline-capture` no cambia. La inspección es offline porque ocurre en 48 acres sin señal; ejecutar
una acción correctiva y cargar su evidencia no tiene esa restricción, y meter una segunda entidad
en Dexie y en el outbox sería costo permanente sin un recorrido que lo pida.

### D16 — `inspections` no conoce `actions`, y `actions` no conoce `inspections`

`actions` depende de `findings` (lee la clasificación vigente) y de `identity` (resuelve persona y
cuenta). Nada llama a `actions` desde la ingesta: crear una acción es un acto del coordinador,
días después, y no un paso de la transacción de envío. La excepción declarada de ADR-008 que
introdujo `findings-and-risk-classification` no se extiende acá.

## Risks / Trade-offs

- **El plazo congelado puede quedar corto de más o largo de más tras una reclasificación** →
  Aceptado y declarado en D5 y en el spec. La salida operativa es abrir otra acción, y el registro
  conserva las dos.
- **La tabla severidad → días no está en los requisitos y la elegimos nosotros** → Está en código
  con el cartel de «configuración, no regla legal», y cambiarla es una constante y una migración de
  nada, porque `due_at` está congelado en cada fila: cambiar la tabla no reescribe el pasado.
- **`due_at` como `timestamptz + interval 'N days'` cruza cambios de horario** → Se acepta: sumar
  días calendario a un instante es lo que un plazo significa acá, y una diferencia de una hora en
  el vencimiento no tiene consecuencia con un cron que corre a las 03:00 y un umbral de 3 días.
- **Escalar a todos los supervisores del sitio puede ser ruidoso** → Con 15-20 cuentas es una
  bandeja, no un problema. Dirigirlo al supervisor de la persona asignada exigiría una jerarquía
  que el roster no tiene y que nadie pidió.
- **Un responsable sin cuenta no recibe notificación y puede no enterarse** → Es la consecuencia
  directa de Persona ≠ Usuario. El escalamiento a los +3 días le llega igual al supervisor, que es
  precisamente la red que R3 pide para este caso.
- **La unión discriminada rompe el tipo `Notification`** → Sin usuarios en producción; se despliega
  junto. Es el momento más barato en que este cambio puede hacerse.
- **Dos guardas más en SQL escritas también en TypeScript** → Cuatro reglas duplicadas (matriz,
  `response_type`, transiciones, verificador). Cada una tiene su test de integración comparando los
  dos caminos; sin ese test la duplicación sería deuda y no defensa.

## Migration Plan

1. `0011_corrective_actions.sql` escrita a mano (ADR-004): cuatro tablas, guardas, restricciones
   diferidas, triggers de auditoría, `hs_make_immutable`, `hs_apply_site_isolation`,
   `GRANT SELECT, INSERT`.
2. Sin backfill: no hay acciones correctivas en producción, así que no hay estado que reconstruir.
3. La cola `actions.escalate-overdue` se declara al arrancar con `createQueue`, que es idempotente;
   el esquema `pgboss` ya está instalado.
4. Cliente y API se despliegan juntos por el cambio de forma de `notification` (D11).
5. Rollback: revertir el despliegue. La migración no se revierte —las tablas quedan vacías y sin
   consumidor— porque bajar una migración que crea tablas inmutables exigiría `DROP`, y esa es la
   operación que el rol de aplicación no tiene y el de migración usa solo hacia adelante.

## Open Questions

- Los números de la tabla severidad → días (3/7/14/30/60) los elegimos nosotros: los requisitos
  fijan el escalamiento a +3 y +7 días pero no el plazo inicial. Conviene confirmarlos con el
  coordinador de HS antes de producción. No bloquea nada: es una constante en
  `packages/contracts/src/actions.ts`, cambiarla no afecta specs, esquema ni tareas, y `due_at`
  congelado hace que un cambio futuro no reescriba las acciones ya creadas.
