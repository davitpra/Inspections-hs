# Diseño — Ingesta de envíos de inspección

## Context

Ver `proposal.md` — Why. Lo que importa acá es cuánto del contrato ya está fijado por código
que existe y no se toca:

- **La ruta y los códigos de error los eligió el dispositivo.** `apps/web/src/offline/outbox.ts`
  postea a `/inspection-submissions`, trata `already_submitted` y `conflict` como éxito, y tiene
  `validation_failed`, `invalid_submission`, `forbidden` e `inspection_not_found` en su conjunto
  de códigos no reintentables. Cualquier otro código se reintenta con retroceso hasta el fin de
  los tiempos.
- **El payload y la respuesta ya son un esquema compartido**: `inspectionSubmissionSchema` y
  `acceptedSubmissionSchema` en `packages/contracts/src/submissions.ts`. Este change no los
  modifica; los implementa.
- **`photos` viaja separado de `answers`.** El dispositivo guarda las fotos en otra tabla de
  Dexie y `toAnswerSet` nunca las incluye. Un ítem de tipo `photo` llega, entonces, sin respuesta
  en `answers` y con sus object keys en `photos`.
- **El mecanismo ya está construido**: `hs_make_immutable`, `hs_apply_site_isolation`,
  `hs_identity_audit_entry` y la cadena de `audit_log` con su lock por sitio. Este change los
  usa; no inventa mecanismo nuevo.
- **La transacción y el alcance ya tienen una única vía**: `withSessionScope` de
  `apps/api/src/db/site-scope.ts`. Todo lo de este endpoint ocurre adentro de una sola llamada.

Tablas inmutables que este change toca: **crea dos nuevas**, `inspection` e `inspection_answer`,
ambas con `hs_make_immutable`. No modifica ninguna tabla inmutable existente; a
`template_version_item` le agrega un `UNIQUE (id, item_key)`, que es un `ADD CONSTRAINT` y por lo
tanto legal sobre una tabla inmutable (mismo precedente que 0008 §2).

ADRs aplicables: **ADR-001** (idempotencia por `client_submission_id`, fotos por object key),
**ADR-002** (inmutabilidad por motor, cadena de hashes), **ADR-004** (SQL a mano, RLS),
**ADR-008** (costura crítica 1, capas delgadas dentro del módulo).

## Goals / Non-Goals

**Goals:**

- Una transacción por envío, con la idempotencia garantizada por un único del motor.
- Respuestas como filas con `item_key` indexada, listas para el `GROUP BY` de la etapa 7.
- El endpoint no puede escribir un registro que el motor no habría aceptado por su cuenta: cada
  invariante del envío tiene una barrera en SQL, no solo una comprobación en el servicio.

**Non-Goals:**

- Derivar hallazgos (etapa 4). El punto de enganche queda declarado en D9.
- Superar o anular una inspección enviada (`RegistroSuplementario`, etapa posterior). Por eso el
  único sobre `scheduled_inspection_id` es total y no parcial: hoy no hay estado que lo excluya, y
  el change que introduzca `supersedes_id` decidirá si pasa a ser parcial.
- Cambiar el contrato, la ruta o los códigos de error que el dispositivo ya usa.
- Borrar del bucket las fotos de un envío rechazado. Quedan huérfanas y es aceptado: el bucket
  tiene versioning y la aplicación no tiene credenciales de borrado (ADR-006, ADR-008).

## Decisions

### D1 — La ruta es `POST /inspection-submissions`, no `POST /inspections/submissions`

ADR-008 escribe `POST /inspections/submissions` en la prosa de la costura. El dispositivo, ya
entregado y probado, postea a `/inspection-submissions`. Se adopta la ruta del dispositivo.

Alternativas: cambiar el cliente, o servir las dos. La primera es tocar código offline ya
verificado para ganar una barra; la segunda deja dos rutas al registro legal, que es exactamente
la clase de ambigüedad que esta costura no puede permitirse. La prosa de ADR-008 no es normativa
sobre la forma de la URL: nombra el endpoint, y el endpoint es este. El resto del módulo
`inspections` ya usa rutas planas (`scheduled-inspections`, `inspection-schedules`) con
`@Controller()` sin prefijo, así que la ruta plana es además la consistente.

### D2 — La idempotencia es un `INSERT ... ON CONFLICT DO NOTHING`, no un `SELECT` previo

```
INSERT INTO inspection (...) VALUES (...)
ON CONFLICT (client_submission_id) DO NOTHING
RETURNING *;
```

Cero filas devueltas significa "ya existía": se lee la fila existente y se responde con
`created: false`.

Alternativa descartada: `SELECT` por `client_submission_id` y, si no hay, `INSERT`. Entre el
`SELECT` y el `INSERT` hay una ventana, y el outbox tiene un mecanismo de robo de lock que
`offline-inspection-capture` documenta como capaz de producir dos envíos concurrentes del mismo
id — la mitad del dispositivo delega en el servidor precisamente esta corrección. Un `SELECT`
previo la devolvería.

El `SELECT` de lectura del existente ocurre **después** del `ON CONFLICT` y en la misma
transacción; ve la fila cometida por la otra transacción porque para entonces esa ya cometió o
la nuestra espera en el único.

### D3 — La validación corre antes del `INSERT`, pero no es lo que garantiza el "todo o nada"

El orden es: resolver la inspección programada → verificar autoría y estado → fundir `photos` en
el conjunto de respuestas → `validateAnswers` → `INSERT inspection` → `INSERT inspection_answer`
en un solo `INSERT ... SELECT` sobre un array → commit.

Validar primero es para devolver el error barato sin tocar la base. Pero el requisito de "una
validación fallida no deja estado parcial" **no** descansa en ese orden: descansa en que todo
ocurre dentro de la transacción de `withSessionScope`, que no comete si algo lanza. Si mañana
alguien mueve la validación después del insert, el requisito sigue cumpliéndose. Esa es la
propiedad que se quiere.

### D4 — Las fotos se funden en el conjunto de respuestas antes de validar, y no se guardan aparte

`photos: Record<item_key, object_key[]>` se vuelca sobre `answers` bajo la misma `item_key`
antes de llamar a `validateAnswers`. La forma que el motor espera para un ítem `photo` es
`string[]` de object keys, que es exactamente lo que `photos` trae.

Si una `item_key` aparece en los dos mapas, gana `photos` y se registra la colisión como
`invalid_submission`: dos fuentes para la misma respuesta es un dispositivo con un bug, no un
caso a resolver en silencio.

Alternativa descartada: una tabla `inspection_photo` aparte. Duplicaría la identidad del ítem en
una segunda tabla y obligaría a la derivación de hallazgos a leer dos lugares para saber si el
ítem tiene foto. Una foto **es** la respuesta de un ítem de tipo foto; su fila es una
`inspection_answer` con un array de keys en `value`.

### D5 — La verificación del prefijo de las object keys es una función pura y una barrera de seguridad

`uploads` deriva la key como `{site_id}/{scheduled_inspection_id}/{uuid}` y nunca deja que el
dispositivo la elija. Este endpoint comprueba que **toda** key referenciada —de `photos` y del
`object_key` de una firma— empiece con el prefijo de esta inspección.

Sin esa comprobación, un dispositivo comprometido podría hacer que el registro legal de una
inspección apunte a las fotos de otra planta. La comprobación vive en un archivo de funciones
puras junto a la fusión de D4, testeable sin base.

### D6 — Cada invariante del envío tiene una barrera en el motor, y se enumeran

| Invariante                                                     | Barrera                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Un `client_submission_id`, un registro                         | `UNIQUE (client_submission_id)`                                            |
| Una inspección programada, un envío                            | `UNIQUE (scheduled_inspection_id)`                                         |
| La versión enviada es la congelada                             | Trigger `hs_inspection_freeze_guard` (SQLSTATE `HS002`)                    |
| La respuesta pertenece a la versión de su inspección           | Trigger `hs_inspection_answer_guard` (SQLSTATE `HS002`)                    |
| `item_key` es la del ítem referenciado                         | FK compuesta a `template_version_item (id, item_key)`                      |
| La respuesta es del mismo sitio que su inspección              | FK compuesta a `inspection (id, site_id)`                                  |
| Un ítem no se contesta dos veces                               | `UNIQUE (inspection_id, item_key)`                                         |
| Nadie modifica ni borra un envío                               | `hs_make_immutable` sobre las dos tablas + `GRANT SELECT, INSERT` y nada más |
| Nadie ve el envío de otra planta                               | `hs_apply_site_isolation` sobre las dos tablas                             |
| Cada envío deja su eslabón en la cadena                        | Trigger `AFTER INSERT` sobre `inspection`                                  |

La columna de la derecha es el change. La comprobación equivalente en el servicio existe para
devolver un error legible, no para que la invariante se cumpla.

### D7 — El evento de auditoría lo escribe un trigger, con `occurred_at` del dispositivo

`hs_identity_audit_entry` fija `occurred_at := now()`, que serviría para todo lo escrito hasta
hoy pero no acá: una inspección firmada el 3 y sincronizada el 9 quedaría registrada como
ocurrida el 9, y el riesgo C de §5 pide exactamente lo contrario. Se agrega una variante de
cuatro argumentos, `hs_audit_entry_at(site, kind, body, occurred_at)`, y la de tres pasa a
delegar en ella con `now()`. Ningún trigger existente cambia de comportamiento.

Que un reenvío no escriba un segundo eslabón sale gratis: el `ON CONFLICT DO NOTHING` no inserta,
y el trigger es `AFTER INSERT`. No hay condición que escribir.

**Una entrada por envío y ninguna por respuesta.** Doscientos ítems no pueden ser doscientos
eslabones: la cadena serializa por sitio con un lock de advisory, y la verificación ante el
MLITSD recorre la cadena entera. `answer_count` en el payload deja registrado cuántas respuestas
tenía el envío, que es lo que una verificación necesita comparar contra la tabla.

### D8 — Índices de recurrencia, escritos ahora y no cuando duelan

`inspection_answer` nace con `(site_id, item_key)` y con `(inspection_id)`. La consulta de la
etapa 7 es "para este sitio, agrupá por `item_key` las respuestas de las inspecciones de este
rango de períodos", y el rango vive en `scheduled_inspection.period_start`, no acá: el índice
compuesto por sitio resuelve el filtro y el agrupamiento, y el join a `inspection` sale por PK.

Con 24 inspecciones al año por sitio, ningún índice hace falta por volumen. Se escriben igual
porque agregarlos después de que la tabla sea inmutable y tenga registros regulatorios adentro es
un `CREATE INDEX` en producción sobre datos que no se pueden reconstruir, y porque el único
momento honesto para declarar la clave de agrupación es cuando se diseña la tabla.

### D9 — El punto de enganche de los hallazgos queda escrito, sin código

La derivación de hallazgos leerá las filas de `inspection_answer` recién insertadas dentro de
**esta misma transacción**, entre el insert de las respuestas y el commit. El servicio deja el
lugar explícito con un comentario y nada más: no hay interfaz, ni hook, ni puerto vacío. Un punto
de extensión sin segundo implementador es la ceremonia de arquitectura contra la que advierte el
riesgo B.

### D10 — Un envío de una inspección cancelada se rechaza como `invalid_submission`

El dispositivo pudo bajar el paquete de campo y perder señal antes de que el coordinador
cancelara. Se rechaza —no se acepta ni se guarda "por las dudas"— y el código es no reintentable,
así que el outbox detiene la entrada y la muestra con su motivo, dejando el borrador legible en
el dispositivo. Es la respuesta correcta: hay trabajo hecho que alguien tiene que mirar, y no es
un registro que corresponda al período.

## Risks / Trade-offs

- **El único total sobre `scheduled_inspection_id` bloqueará al change de registros
  suplementarios** → Es deliberado (Non-Goals): ese change decide si pasa a parcial, y lo hace con
  la semántica de superación en la mano. Cambiar un índice único es una migración barata;
  descubrir dos inspecciones enviadas del mismo período no lo es.
- **Fotos huérfanas en el bucket cuando un envío se rechaza** → Aceptado. El coste es
  almacenamiento; la alternativa es dar credenciales de borrado a la aplicación, que ADR-008
  prohíbe explícitamente.
- **Un reenvío devuelve el registro existente sin comparar el payload** → Aceptado, y es la
  semántica de ADR-001. Un mismo `client_submission_id` con respuestas distintas solo puede venir
  de un dispositivo manipulado; el registro que vale es el primero y el log deja la evidencia. No
  se hashea el payload para compararlo: agregaría una columna y una decisión ("¿qué se hace si
  difieren?") que nadie pidió.
- **La validación corre dos veces, en el dispositivo y en el servidor, con el mismo código** →
  Es el punto de ADR-007, no un riesgo. El riesgo real sería que divergieran, y el test de
  contrato de `packages/forms` es lo que lo impide.
- **Un envío de 200 ítems inserta 200 filas** → Un solo `INSERT ... SELECT unnest(...)`, no 200
  round-trips. Con 24 inspecciones al año por sitio el volumen es irrelevante; lo que no es
  irrelevante es que 200 sentencias dentro de una transacción con un lock de advisory tomado
  alarguen la sección crítica de la cadena.

## Migration Plan

1. `apps/api/drizzle/0009_inspection_submissions.sql`, escrita a mano (`drizzle-kit generate`
   sigue prohibido). Contenido, en orden: `ALTER TABLE template_version_item ADD CONSTRAINT`
   único `(id, item_key)`; `ALTER TABLE inspection ADD CONSTRAINT` único `(id, site_id)` tras
   crearla; las dos tablas; los índices; los dos triggers de guarda; el trigger de auditoría;
   `hs_audit_entry_at`; `hs_make_immutable` y `hs_apply_site_isolation` sobre las dos;
   `GRANT SELECT, INSERT` y ningún `GRANT UPDATE`.
2. Actualizar a mano el espejo Drizzle en `apps/api/src/db/schema/inspections.ts`, con el
   comentario de ADR-004 que ya usan las otras tablas.
3. La migración es aditiva: no hay datos que migrar y aplicarla sobre una base con inspecciones
   programadas es inocuo.
4. **Rollback**: no hay reversa una vez que la tabla tenga un envío real; antes de eso, el
   rollback es `DROP TABLE inspection_answer, inspection` con el rol de migración. Después, la
   corrección es una migración nueva hacia adelante. Es la consecuencia normal de ADR-002.
