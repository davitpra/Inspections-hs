## Context

Ver `proposal.md` — Why, y `specs/inspections/spec.md` para los requisitos. Restricciones que dan
forma al diseño y que no se re-discuten acá:

- **ADR-005** — el planificador es `pg-boss` sobre la misma base Postgres. Sin Redis. La ADR
  enumera la apertura de inspecciones del período como uno de sus tres trabajos; este change es el
  primero que la ejerce.
- **ADR-004** — Postgres, Drizzle como espejo a mano, RLS. El aislamiento por sitio lo aplica la
  política, nunca un `WHERE` en el endpoint.
- **ADR-002** — inmutabilidad forzada por el motor: `REVOKE` + trigger, no código de aplicación.
  Nunca `DELETE`.
- **ADR-011 / D9** — no hay correo transaccional y no se agrega uno. Cualquier "notificar" de este
  change es in-app o no existe.

Estado de partida: `template_version` es inmutable y ya tiene único `(template_id, version)`
(migración `0003`). `site` y `location` traen `hs_apply_site_isolation` y el patrón de mutabilidad
parcial (`0004`). `person`, `app_user` y `user_site_scope` traen los roles, el alcance por sitio y
el mismo patrón de guarda con `GRANT UPDATE` por columna (`0005`). `withSiteScope` y
`withSessionScope` son las dos únicas entradas a la base (`apps/api/src/db/site-scope.ts`). No hay
ningún proceso de fondo: `apps/api` es hoy solo HTTP.

**Tablas inmutables tocadas: no, en el sentido de `hs_make_immutable`.** Las tres tablas nuevas
nacen *parcialmente* mutables con el patrón de `location`/`person`. Ninguna tabla existente cambia
de forma; `template_version` solo gana un único adicional para poder ser destino de una FK
compuesta, que es DDL y no toca filas.

## Goals / Non-Goals

**Goals:**

- Que "la versión queda congelada" sea una propiedad del motor: el `UPDATE` que la movería tiene
  que fallar, no tiene que estar ausente del código.
- Que la idempotencia de la apertura mensual sea un único parcial y no la lógica del trabajo, de
  modo que dos réplicas, un reintento de pg-boss y una ejecución manual converjan al mismo estado.
- Dejar pg-boss instalado con un ciclo de vida correcto y un lugar evidente donde la etapa 5 cuelgue
  el escalamiento, sin que ese trabajo tenga que rediseñar nada.

**Non-Goals:**

- El estado de la inspección. `scheduled_inspection` no tiene columna de estado y no la va a tener:
  "cumplida" se va a derivar de la existencia de una `inspection` enviada, en el change siguiente.
  Agregar hoy un `status` sería inventar una máquina de estados que nadie puede hacer avanzar.
- Cadencias que no sean mensuales. `inspection_schedule` no lleva campo de frecuencia; la
  mensualidad está en el nombre del período y en el trabajo. El día que haya semanal, ese es el
  change que agrega la columna.
- Una capability `notifications`. La lista de capabilities del proyecto no la tiene y este change no
  la inventa: la tabla es genérica, sus requisitos viven en `inspections` hasta que un segundo
  productor de notificaciones justifique moverlos.
- Reintento con backoff exponencial afinado, colas múltiples, prioridades, dashboards de pg-boss.
  Un cron diario sobre decenas de filas no lo necesita.

## Decisions

### D1 — La regla y la ocurrencia son dos tablas

`inspection_schedule` es la regla (sitio + plantilla + inspector por defecto, con `deactivated_at`);
`scheduled_inspection` es la ocurrencia del período. El trabajo lee reglas y escribe ocurrencias.

La regla no estaba en el alcance pedido. Se agrega porque "apertura mensual automática por sitio"
sin regla no tiene entrada: el trabajo tendría que decidir por su cuenta qué plantillas debe
inspeccionar cada sitio.

Alternativa descartada: **abrir una ocurrencia por cada plantilla activa con versión publicada.** No
necesita tabla nueva y es exactamente por eso que está mal — convierte cualquier plantilla en una
obligación mensual por el solo hecho de existir, y el día que se cargue una plantilla de auditoría
anual el sistema empieza a reclamarla todos los meses.

Alternativa descartada: **una columna en `template`.** `template` no tiene sitio, así que no puede
expresar "St. Thomas sí, Glencoe no", que es la distinción que el requisito necesita.

La ocurrencia **copia** `template_id` y `default_inspector_id` en vez de leerlos por join a la
regla, y no lleva FK a la regla: desactivar una regla o cambiarle el inspector por defecto no puede
alterar retroactivamente qué se inspeccionó ni contra qué. La regla es una fábrica, no un padre.

### D2 — El congelamiento es un `GRANT` por columna más un trigger de guarda

`scheduled_inspection` lleva el patrón que `person` ya estableció (`0005` §3): `hs_make_immutable`
**no** se aplica porque la tabla sí tiene columnas mutables, y en su lugar van

- `GRANT UPDATE (inspector_id, cancelled_at, cancellation_reason) ON scheduled_inspection TO hs_app`
  — que frena a `hs_app` en el motor de privilegios;
- un trigger `scheduled_inspection_guard` que rechaza cualquier cambio de `site_id`, `period_start`,
  `template_id`, `template_version_id`, `scheduled_at` y `scheduled_by` — que frena también a
  `hs_migrator`, dueño de la tabla, que el `GRANT` no alcanza;
- triggers de prohibición de `DELETE` y `TRUNCATE`, como en `0005`.

Las dos capas están porque cubren atacantes distintos y la spec pide las dos: un escenario exige
`42501` para el rol de aplicación y otro exige el SQLSTATE del trigger para el rol dueño. Es la
misma pareja de escenarios que `template_version` ya tiene en la capability `templates`.

Alternativa descartada: **validar en el servicio.** Es exactamente lo que ADR-002 prohíbe. Un
`UPDATE` desde psql, un seed mal escrito o una migración futura lo evaden.

### D3 — El período es una `date` del primer día del mes; el fin es generado

`period_start date NOT NULL CHECK (date_trunc('month', period_start) = period_start)`, y
`period_end date GENERATED ALWAYS AS ((period_start + interval '1 month' - interval '1 day')::date)
STORED`.

Guardar el fin como columna independiente abriría la puerta a una fila con inicio y fin
inconsistentes, que es un estado que ningún código produce a propósito y que igual aparece. Generada
es la única representación en la que febrero de un año bisiesto no puede estar mal.

Alternativa descartada: **un `daterange`.** Más expresivo y más difícil de leer en cada consulta y
en cada payload; y el requisito es "mensual", no "cualquier intervalo".

Alternativa descartada: **`period_year int` + `period_month int`.** Necesita dos `CHECK` y todo el
ordenamiento por vencimiento se vuelve una expresión en lugar de un índice sobre una columna.

### D4 — La zona horaria es una constante del cron, no una columna de `site`

El cron se registra con `tz: 'America/Toronto'`, y el trabajo deriva el período de la fecha local
de esa zona. Los dos sitios son de Ontario; un `site.timezone` sería una columna con un solo valor
posible y un change de `catalog` que este change no necesita abrir.

Lo que sí queda escrito, en el código del trabajo y en la migración: **el período es una fecha civil,
no un instante.** Sin la zona, un cron a medianoche UTC abre el período de septiembre el 31 de
agosto a las 20:00 hora local, y la spec tiene el escenario que lo prueba.

Alternativa descartada: **UTC a mediodía.** Funciona por accidente y deja de funcionar el día que
haya un sitio fuera de Ontario, sin ningún test que avise.

### D5 — La idempotencia vive en un único parcial, no en el trabajo

```sql
CREATE UNIQUE INDEX scheduled_inspection_open_period_uq
  ON scheduled_inspection (site_id, template_id, period_start)
  WHERE cancelled_at IS NULL;
```

y el trabajo inserta con `ON CONFLICT DO NOTHING ... RETURNING id`, tomando la cantidad de filas
devueltas como "cuántas abrí". Con eso:

- dos réplicas del proceso de API que arrancan el mismo cron convergen;
- un reintento de pg-boss tras un fallo parcial no duplica;
- una ejecución manual del trabajo para recuperar un día caído es segura;
- y una inspección cancelada libera el período para volver a programarlo, porque el único es parcial
  — el mismo criterio que `location_site_active_name_uq` y `user_site_scope_active_uq`.

El parcial es sobre `template_id` y no sobre `template_version_id`: si fuera sobre la versión,
publicar la v3 a mitad de mes permitiría abrir una segunda inspección del mismo período, que es
precisamente lo que el congelamiento quiere impedir.

Alternativa descartada: **`singletonKey` de pg-boss.** Garantiza que no corran dos instancias del
trabajo a la vez, que es útil y que igual se usa, pero no garantiza que el efecto sea idempotente
— un trabajo que falló después de insertar la primera de dos filas se reintenta y tiene que poder
completar sin chocar. La garantía tiene que estar en la tabla.

### D6 — La FK compuesta `(template_version_id, template_id)`

`template_version` gana `UNIQUE (id, template_id)` — redundante como restricción, necesaria como
destino — y `scheduled_inspection` declara
`FOREIGN KEY (template_version_id, template_id) REFERENCES template_version (id, template_id)`.

Es el mismo truco que `location_site_id_uq` ya introdujo en `0004` para la pareja
`(site_id, location_id)`. Sin él, `template_id` sería una denormalización que el motor no puede
defender y una fila podría afirmar que inspecciona la plantilla A contra una versión de la B.
`ADD CONSTRAINT` sobre `template_version` es legal aunque la tabla sea inmutable: `hs_make_immutable`
bloquea DML, no DDL, y el precedente está escrito en `0005`.

### D7 — pg-boss instala con `hs_migrator` y opera con `hs_app`

pg-boss quiere crear su propio esquema y sus tablas, lo que exige privilegios de DDL que `hs_app` no
tiene ni va a tener. El split:

- la migración crea el esquema `pgboss` con `hs_migrator` como dueño, le da `USAGE` a `hs_app` y fija
  los `ALTER DEFAULT PRIVILEGES` **antes** de que la librería cree nada — no son retroactivos, y si
  el orden se invirtiera el síntoma sería un worker que arranca y no consume nunca;
- la instalación del esquema es un **paso de despliegue** (`pnpm db:jobs:install`), que corre el plan
  de construcción de pg-boss como `hs_migrator`, igual que `pnpm db:migrate`;
- el proceso de API arranca contra un esquema ya instalado y solo encola y consume, como `hs_app`.

**Por qué la instalación no va en el arranque de la aplicación**, que era la forma obvia: `DbService`
tiene escrito que `MIGRATION_DATABASE_URL` nunca entra al proceso de la API, y meter una conexión de
`hs_migrator` para el `start()` de pg-boss lo violaría por una comodidad. Además, pg-boss 12 no tiene
opción `migrate` en el constructor: expone `getConstructionPlans(schema)`, que es SQL para correr
donde corresponda. Las dos razones apuntan al mismo lugar.

El arranque **verifica** en vez de instalar: si `isInstalled()` da falso, falla ruidosamente diciendo
que falta correr el instalador. Un worker que arranca contra un esquema ausente y se queda callado es
peor que uno que no arranca.

**Las tablas de `pgboss` quedan fuera del régimen de inmutabilidad y fuera del aislamiento por
sitio, a propósito y declarado.** Son infraestructura: una cola cuyas filas no se pueden actualizar
no es una cola, y un trabajo no pertenece a un sitio. La migración lleva ese comentario para que la
ausencia de `hs_make_immutable` se lea como decisión y no como olvido.

Alternativa descartada: **dejar que pg-boss corra siempre como `hs_migrator`.** Un proceso de larga
vida conectado con el rol dueño evade toda política RLS del sistema por la vía de `FORCE`… y peor,
convierte cualquier bug del handler en una escritura sin restricciones.

### D8 — El trabajo declara alcance explícito, no una sesión

El handler resuelve los sitios activos con la conexión sin alcance (la misma `unscopedPool` que ya
usa el alta por invitación) y después abre `withSiteScope(pool, { siteIds: <todos los activos>,
userId: null })` para escribir. No usa `withSessionScope` porque no hay sesión, y esa es justamente
la distinción que el helper existe para hacer.

Consecuencia en la auditoría: las entradas que genera la apertura automática llevan actor nulo. Es
correcto y es el mismo criterio que `audit_log.actor_user_id` y que `roster_import.imported_by` ya
aceptan: el sistema actuó, no una persona. `scheduled_by` de una fila abierta por el trabajo es
`NULL`, y eso distingue en la propia tabla lo automático de lo que programó el coordinador a mano.

### D9 — La notificación es una fila, y su unicidad también es un índice

`notification (id, user_id, site_id, kind, dedupe_key, payload, created_at, read_at)`, con
`UNIQUE (user_id, kind, dedupe_key)`. Para la apertura del período, `dedupe_key` es
`<site_id>:<period_start>`. Con eso el escenario "una segunda corrida no notifica dos veces" lo
resuelve la base y no un `SELECT` previo del handler, que bajo concurrencia no resuelve nada.

`read_at` es la única columna con `GRANT UPDATE`, más el trigger de guarda que niega el resto y que
además impide volver `read_at` a `NULL`. `hs_apply_site_isolation` sobre `site_id`: una notificación
es contenido operativo de un sitio.

`kind` lleva `CHECK (kind IN ('inspection_period_opened'))` con un solo valor hoy. Un `CHECK` de un
elemento es honesto: dice que la lista está cerrada y que agregar un tipo es una migración, que es
lo que corresponde cuando el consumidor tiene que saber leer el payload.

Alternativa descartada: **notificación por correo.** ADR-011 D9 ya la cerró. Alternativa descartada:
**derivar la bandeja con una consulta sobre `scheduled_inspection`** en vez de materializar filas.
Ahorra una tabla y pierde `read_at`, que es la única razón por la que una bandeja sirve.

### D10 — El pendiente se filtra por RLS, y el "vencido" se calcula al leer

`GET /me/pending-inspections` no lleva `WHERE site_id IN (...)`: la política de
`hs_apply_site_isolation` ya recorta, y el endpoint solo agrega `inspector_id = current_setting(
'app.user_id')::uuid` y `cancelled_at IS NULL`, con `ORDER BY period_end`. El flag de vencido es
`period_end < (now() AT TIME ZONE 'America/Toronto')::date`, calculado en la consulta y no
almacenado: una columna `is_overdue` sería un valor que envejece solo y que habría que actualizar
con un trabajo, sobre una tabla que casi no admite `UPDATE`.

Índice: `(inspector_id, period_end) WHERE cancelled_at IS NULL` — parcial, porque es exactamente la
consulta de la pantalla de inicio.

## Risks / Trade-offs

- **Un proceso de fondo dentro del proceso HTTP** → Con una sola instancia no hay problema; con dos,
  los dos registran el cron y los dos podrían abrir el período. El único parcial (D5) hace que el
  resultado sea el mismo, y `singletonKey` evita el trabajo duplicado en el caso normal. Se acepta
  a propósito: separar el worker en su propio proceso es infraestructura que ADR-005 quiso evitar,
  y con un solo desarrollador el costo de operarlo supera al de tolerar una corrida redundante.
- **pg-boss 12 es ESM puro y `apps/api` es CommonJS** → Funciona por el `require(esm)` de Node
  ≥22.12, que es exactamente lo que pide el `engines` de la librería, y el typecheck con
  `module: nodenext` lo acepta. Queda anotado porque es la clase de cosa que se rompe en un cambio de
  runtime, no en un cambio de código: si alguna vez falla, la salida es bajar a pg-boss 10, que
  publica CJS, sin tocar nada de este diseño más que el import.
- **Un esquema de trabajos desactualizado respecto del código** → El instalador es un paso aparte, así
  que un despliegue puede olvidarlo. Por eso el arranque verifica `isInstalled()` y falla si no lo
  está, en vez de degradar en silencio.
- **La regla no expresa rotación entre los 7 miembros del JHSC** → El inspector por defecto es fijo
  y la reasignación es manual, auditada. Con 7 personas y 2 sitios, una rotación automática es
  código que hay que mantener para ahorrar dos clicks por mes. Si se pide, entra como columna de
  estrategia en `inspection_schedule` sin tocar `scheduled_inspection`.
- **Nada marca todavía una inspección como cumplida** → Hasta el change de captura, el pendiente de
  un inspector solo crece. Es visible y es correcto: la obligación existe aunque el sistema todavía
  no sepa recibir la respuesta. El change siguiente cierra el ciclo enlazando `inspection` con
  `scheduled_inspection`.
- **Un período abierto contra una versión que después se descubre mal** → No se corrige moviendo la
  versión, se corrige cancelando con motivo y programando de nuevo. Queda el rastro de las dos
  filas, que es lo que un inspector del MLITSD tiene que poder leer. La incomodidad es deliberada.
- **`dedupe_key` es texto libre desde el punto de vista del motor** → Un productor futuro puede
  elegir una clave mal y notificar de más o de menos. Se acota con el `CHECK` de `kind`: cada tipo
  nuevo pasa por una migración, que es el momento en el que se decide su clave.
- **El `CHECK` de `date_trunc` sobre `period_start`** → `date_trunc` es `STABLE` y no `IMMUTABLE`
  para `timestamptz`, pero sobre `date` la expresión usada es determinista; si Postgres rechaza la
  restricción, la forma equivalente es `EXTRACT(day FROM period_start) = 1`. La migración usa la
  que el motor acepte y deja el comentario.

## Migration Plan

1. **Migración `0008_inspection_scheduling.sql`** — `inspection_schedule`, `scheduled_inspection`,
   `notification`; el `UNIQUE (id, template_id)` en `template_version`; los triggers de guarda, de
   prohibición de `DELETE`/`TRUNCATE` y de auditoría; `hs_apply_site_isolation` en las tres tablas;
   los `GRANT` por columna. Sin `hs_make_immutable`: las tres son parcialmente mutables y el
   comentario lo dice.
2. **Bootstrap de pg-boss** — esquema `pgboss` con dueño `hs_migrator`, `USAGE` y DML para `hs_app`,
   `ALTER DEFAULT PRIVILEGES`. Módulo de Nest con `onModuleInit`/`onModuleDestroy`. Sin trabajos
   todavía: se verifica que arranca y para limpio.
3. **Endpoints del coordinador y del inspector** contra las tablas ya migradas. La suite de
   integración prueba los rechazos del motor —`42501`, SQLSTATE del trigger, único parcial, FK
   compuesta— antes que los caminos felices.
4. **El trabajo de apertura**, último, cuando ya hay reglas que leer y una tabla que defiende sus
   propias invariantes. Se registra el cron y se prueba invocando el handler directamente, sin
   esperar al reloj.

Rollback: la migración `0008` es aditiva — tres tablas nuevas y una restricción nueva sobre
`template_version`. Revertirla es una migración hacia adelante que las descarta; ninguna tabla
existente cambió de forma, así que no hay datos previos que perder. El esquema `pgboss` se descarta
por separado y su caída no afecta a las tablas de dominio: sin planificador, la apertura del período
se hace invocando el mismo handler a mano, que es exactamente lo que hacen sus tests.
