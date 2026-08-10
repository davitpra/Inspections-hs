# Diseño — Hallazgos y clasificación de riesgo

## Context

Ver `proposal.md` — Why. Lo que importa acá es qué está ya construido y condiciona la forma:

- **El punto de enganche existe y está documentado.** `apps/api/src/inspections/submissions.service.ts`
  tiene, después de `insertAnswers`, el comentario que dice que la derivación va en esa línea, dentro
  de `withSessionClient` —que es la transacción— y que no hay hook ni puerto esperando.
- **`mergePhotoAnswers` rechaza colisiones.** Una `item_key` presente a la vez en `answers` y en
  `photos` se rechaza a propósito. Un ítem `yes_no` respondido `false` *con fotos* sería exactamente
  esa colisión: las fotos del hallazgo no pueden viajar en `photos`.
- **El catálogo de ubicaciones ya viaja al dispositivo.** `prefetch.ts` guarda `locations` por
  inspección programada y `PrepareRoute` lo exige para declarar la inspección lista para el campo. La
  captura del hallazgo no necesita descargar nada nuevo.
- **`location` ya expone `location_site_id_uq (site_id, id)`**, `inspection` ya expone
  `inspection_id_site_uq (id, site_id)` y `template_version_item` ya expone su `UNIQUE (id, item_key)`
  desde 0009. Las tres FK compuestas que este change necesita tienen destino: **no hace falta ningún
  `ALTER` sobre una tabla inmutable existente.**
- **El mecanismo está construido**: `hs_make_immutable`, `hs_apply_site_isolation`, la cadena de
  `audit_log` con su lock por sitio y `withSessionScope`. Este change los usa; no inventa mecanismo.

**Tablas inmutables que este change toca:** crea tres nuevas —`finding`, `finding_photo`,
`finding_risk_assessment`— las tres con `hs_make_immutable`. **No modifica ninguna tabla inmutable
existente**, ni con `ALTER`, ni agregando columnas, ni agregando restricciones.

ADRs aplicables: **ADR-001** (fotos por object key, nunca bytes; idempotencia del envío),
**ADR-002** (inmutabilidad por motor, cadena de hashes), **ADR-004** (SQL a mano, RLS),
**ADR-006** (presigned URLs, sin credenciales de borrado), **ADR-007** (motor compartido: el mismo
código en el dispositivo y en el servidor), **ADR-008** (costura crítica 1, dirección de
dependencias entre módulos, reglas como funciones puras).

## Goals / Non-Goals

**Goals:**

- Que no exista un camino por el que una inspección se commitee sin los hallazgos que sus respuestas
  implican: la derivación va adentro de la transacción, no al lado.
- Que cada invariante del hallazgo tenga barrera en SQL y no solo comprobación en el servicio —origen
  exactamente-uno, ubicación del propio sitio, al menos una foto, nivel de riesgo calculado, motivo
  obligatorio al reclasificar.
- Que la clasificación tenga historial sin que ninguna fila se toque nunca.
- Que la regla de "qué es negativo" sea una sola, ejecutable en el service worker y en Node.

**Non-Goals:**

- Acciones correctivas, responsables, fechas límite y escalamientos (etapa 5).
- La consulta de recurrencia y el reporte de cumplimiento (etapa 7).
- Notificar al coordinador de que hay hallazgos sin clasificar. Es un trabajo de pg-boss y su
  destinatario natural es la bandeja de la etapa 5; hoy sería una notificación sin acción detrás.
- Umbral configurable por ítem para tipos numéricos. Es builder (riesgo B) y no lo pide ningún
  requisito.

## Decisions

### D1 — La derivación la llama `inspections` y la implementa `findings`

`SubmissionsService` importa una función del módulo `findings` y la invoca con el cliente de la
transacción abierta, las filas que acaba de escribir y el bloque `findings` del payload.

**Esto invierte la dirección que ADR-008 declaraba, y la primera redacción de este documento
afirmaba lo contrario** —decía que la dirección se respetaba mientras describía exactamente la
violación. Corregido al implementar: `inspections` conoce `findings` en este punto y solo en este,
y ADR-008 lo registra ahora como excepción declarada de la costura crítica 1.

El motivo es que la lista de pasos de la costura es una transacción y no una secuencia de llamadas
entre servicios: derivar después del commit es justo lo que la transacción existe para impedir. Lo
que sigue en pie —y es lo que evita el ciclo— es que **`findings` no llama a `inspections`**.

Alternativas descartadas:

- **Un evento de dominio y un manejador.** Un manejador que corre después del commit puede fallar y
  dejar la inspección sin la mitad de R2; uno que corre adentro es la misma llamada con ceremonia
  encima. La costura de ADR-008 es literalmente una lista de pasos en una transacción.
- **Un trigger de base que derive el hallazgo desde `inspection_answer`.** El trigger no tiene la
  descripción ni la ubicación: esos datos vienen del payload y no de la respuesta. Un trigger
  derivaría hallazgos incompletos.
- **Una interfaz `FindingDeriver` inyectada.** Un punto de extensión con un solo implementador es la
  ceremonia contra la que advierte el propio comentario que dejó `submission-ingestion`.

### D2 — "Negativo" se decide por `response_type`, en `packages/forms`

`negativeAnswers(document, answers): string[]` devuelve las `item_key` visibles cuya respuesta es
`yes_no` en `false` o `yes_no_na` en `'no'`. Vive junto a `validateAnswers` porque comparte lo más
delicado: la resolución de visibilidad. Un ítem oculto no tiene respuesta y por lo tanto no puede
derivar hallazgo, y esa lógica ya está escrita y probada en `visibility.ts`.

Que sea el mismo módulo que corre en el dispositivo es lo que impide el peor error posible de este
change: que el dispositivo pida detalles para tres ítems y el servidor espere cuatro. El inspector
recorrería 48 acres, firmaría, sincronizaría y el envío sería rechazado por un dato que nadie le
pidió.

`scale` y `number` no derivan. No hay umbral en el documento —el `weight` de riesgo E está oculto a
propósito y no significa esto—, así que cualquier regla sería inventada.

### D3 — Los detalles del hallazgo viajan en un bloque `findings` propio, no dentro de `answers`

```ts
findings: z.record(itemKeySchema, z.strictObject({
  description: z.string().min(10).max(2000),
  location_id: z.uuid(),
  photo_object_keys: z.array(objectKeySchema).min(1).max(10),
}))
```

No pueden ir en `photos` porque `mergePhotoAnswers` los fundiría en `answers` bajo la misma
`item_key` y chocaría con el booleano de la respuesta —que es el rechazo por colisión que esa función
ya implementa, y está bien que lo haga—. No pueden ir dentro del valor de la respuesta porque el
valor de un `yes_no` es un booleano en el motor de formularios y ensancharlo contaminaría el motor
con un concepto de otro dominio.

`objectKeysOf` se extiende para recorrer también estas keys: la verificación de prefijo de
`foreignObjectKeys` tiene que cubrirlas o el bloque nuevo sería el agujero por el que un dispositivo
comprometido apunta a las fotos de la otra planta.

**Cambio de forma sin convivencia de versiones.** No hay borradores en producción: el cliente y el
servidor se despliegan juntos y el esquema estricto rechaza un payload viejo. Aceptar temporalmente
un envío sin `findings` sería aceptar inspecciones sin la mitad de R2, que es peor que un despliegue
coordinado de una aplicación que todavía no tiene usuarios.

### D4 — La clasificación es una lista enlazada por `supersedes_id`, no una tabla con `is_current`

```sql
supersedes_id uuid UNIQUE REFERENCES finding_risk_assessment(id),
CHECK ((supersedes_id IS NULL) = (reason IS NULL))
```

más un único parcial `(finding_id) WHERE supersedes_id IS NULL`. Con eso, tres invariantes son del
motor y no del servicio:

- **Una sola clasificación inicial por hallazgo** — el único parcial.
- **La historia no se bifurca** — el `UNIQUE` sobre `supersedes_id`. Dos reclasificaciones
  concurrentes de la misma vigente: una comete, la otra viola el único. Sin locks, sin ventana.
- **Reclasificar exige motivo y clasificar por primera vez no lo admite** — el `CHECK` de igualdad.
  «Por qué cambió» es el dato que hace auditable un cambio de riesgo; «por qué es así» la primera vez
  sería ruido obligatorio.

La vigente es la fila que nadie supersede:
`WHERE NOT EXISTS (SELECT 1 FROM finding_risk_assessment s WHERE s.supersedes_id = a.id)`.

Alternativas descartadas: un booleano `is_current` obliga a un `UPDATE` sobre una tabla inmutable —
imposible por definición; un `assessed_at DESC LIMIT 1` empata si dos filas caen en el mismo
microsegundo y no impide la bifurcación; un `seq` por hallazgo necesita un lock como el de la cadena
de auditoría para algo que la FK ya ordena.

### D5 — `risk_level` es columna generada por una función `IMMUTABLE`, y la matriz se escribe dos veces

```sql
risk_level text GENERATED ALWAYS AS (hs_risk_level(probability, severity)) STORED
```

El nivel no se acepta del caller en ningún camino: ni por el endpoint, ni por un `INSERT` directo, ni
por un seed. La matriz es producto de índices 1..5 con cortes `≤4 low`, `5–9 medium`, `10–14 high`,
`≥15 critical`.

La misma matriz se escribe en TypeScript (`apps/api/src/findings/risk.ts`, función pura con tabla de
25 casos) porque la UI y la respuesta del endpoint la necesitan sin ida y vuelta a la base. **La
duplicación es deliberada y está bajo prueba**: un test de integración evalúa las 25 celdas contra
Postgres y contra la función, y compara. Es el mismo precedente que 0007, donde el `CHECK` de
`response_type` duplica el enum de `@hs/forms` y un test los compara. Compartir una sola definición no
es posible: SQL no importa TypeScript.

### D6 — "Al menos una foto" es una restricción diferida, no una comprobación del servicio

Un `CHECK` no puede contar filas de otra tabla. Un `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY
DEFERRED` sobre `finding` verifica al commit que exista al menos un `finding_photo`, lo que permite
el orden natural —insertar el hallazgo y después sus fotos— y sigue haciendo imposible commitear un
hallazgo sin foto por cualquier camino.

Alternativa descartada: una columna `photo_object_keys text[]` en `finding`, con `CHECK
(cardinality(...) >= 1)`. Es más simple y se descarta igual: una foto es una fila que la cadena de
auditoría, la política RLS y el día de mañana un pie de foto o un orden pueden referenciar, y un
arreglo dentro de una fila inmutable no admite agregar la foto que el inspector sacó dos minutos
después sin reescribir la fila —que es imposible—. Con `finding_photo`, agregar una foto tardía es
una fila nueva. (Ese endpoint no está en este change; la puerta queda abierta y sin costo.)

### D7 — El origen es una columna explícita más un `CHECK` de exactamente-uno

```sql
origin text NOT NULL CHECK (origin IN ('inspection','manual')),
CHECK (
  (origin = 'inspection') = (inspection_id IS NOT NULL)
  AND (inspection_id IS NULL) = (item_key IS NULL)
  AND (inspection_id IS NULL) = (template_version_item_id IS NULL)
)
```

La columna es redundante con la nulabilidad y se paga a propósito: las consultas de recurrencia y de
listado filtran por origen sin razonar sobre tres nulos, y el `CHECK` impide que la columna mienta.
Es la misma forma que §4 fija para el parentesco de la acción correctiva (dos FK nulables y un
`CHECK`), así que la etapa 5 encuentra un patrón ya visto.

### D8 — Una ubicación desactivada se acepta al derivar y se rechaza al reportar a mano

La FK compuesta `(site_id, location_id)` garantiza la planta; la actividad no la puede garantizar una
FK. La comprueba el servicio, y solo en el camino manual.

La asimetría es la decisión: el dispositivo lleva el catálogo de cuando se preparó la inspección, y
rechazar un envío porque el coordinador desactivó una ubicación mientras el inspector caminaba
convertiría una edición administrativa en una inspección perdida —exactamente el dolor que el sistema
existe para resolver (§1, riesgo C)—. El reporte manual es online, contra una lista fresca, y ahí no
hay excusa.

### D9 — Las fotos del hallazgo manual tienen su propio prefijo

El presign de hoy deriva `{site_id}/{scheduled_inspection_id}/{uuid}` y exige una inspección
programada activa. Un hallazgo manual no tiene ninguna. Se agrega un segundo camino de presign que
deriva `{site_id}/manual/{draft_finding_id}/{uuid}`, donde `draft_finding_id` lo genera el cliente
antes de subir la primera foto, igual que `client_submission_id`. La verificación de prefijo del
hallazgo manual usa ese prefijo, y la misma función pura `foreignObjectKeys` con otro prefijo.

### D10 — "Sin clasificar" es una ausencia, no un valor

No hay `status`, ni `'unclassified'` en un enum, ni una fila sembrada al derivar. Un hallazgo sin
filas en `finding_risk_assessment` está sin clasificar. Es el mismo invariante del proyecto que dice
que el estado de la acción correctiva se deriva de eventos, aplicado un change antes.

El listado resuelve la vigente con un `LEFT JOIN LATERAL` contra la fila no superseded, apoyado en un
índice `(finding_id) WHERE supersedes_id IS NULL` —el mismo único parcial de D4, que sirve de índice.

### D11 — El servicio duplica tres comprobaciones del motor, a propósito

Ubicación de otro sitio, descripción demasiado corta y hallazgo faltante los rechaza el motor. El
servicio los rechaza antes para devolverle al dispositivo un código que su outbox sabe clasificar
—`validation_failed` es no reintentable— en vez de un error de base que solo sabría reintentar para
siempre. Es la misma razón que ya está escrita en el encabezado de `submissions.service.ts`.

## Risks / Trade-offs

- **La regla de "negativo" divergiendo entre dispositivo y servidor** → una sola función en
  `packages/forms`, con un test que evalúa el mismo documento y el mismo conjunto de respuestas por
  los dos caminos. Es el riesgo más caro del change: se manifiesta como envíos rechazados después de
  recorrer la planta.
- **Los hallazgos manuales quedan fuera de la recurrencia** → aceptado y escrito en §4 y en el riesgo
  F. No se mitiga acá: cualquier intento de asociarlos a una `item_key` sería inventar la clave que
  la §4 dice que no existe.
- **Un coordinador que no clasifica deja hallazgos sin riesgo y sin acción** → visible en el listado
  y sin escalamiento en este change. El mecanismo de recordatorios llega con `actions` (etapa 5),
  donde ya existe pg-boss con bandeja y destinatario.
- **Fotos huérfanas en el bucket cuando un envío se rechaza** → aceptado, igual que en
  `submission-ingestion`: el bucket tiene versioning y la aplicación no tiene credenciales de borrado
  (ADR-006, ADR-008).
- **El bloque `findings` engorda el payload** → siguen siendo kilobytes: descripción corta, un uuid y
  object keys. Las fotos ya viajaban aparte.
- **Un envío grande escribe más filas por transacción** (una inspección con 40 negativos escribe 40
  hallazgos, sus fotos y 40 entradas de auditoría, con el lock por sitio de la cadena) → dos plantas,
  una inspección mensual por plantilla. No hay contención que medir; si un día la hubiera, la
  agrupación de entradas de auditoría es la palanca, no el tamaño de la transacción.

## Migration Plan

1. `0010_findings.sql`: las tres tablas, `hs_make_immutable` en las tres,
   `hs_apply_site_isolation`, las FK compuestas, los `CHECK`, el trigger de constraint diferido de la
   foto, `hs_risk_level` como `IMMUTABLE` con la columna generada, los tres triggers de auditoría, y
   `GRANT SELECT, INSERT` para `hs_app` y nada más.
2. Espejo Drizzle en `apps/api/src/db/schema/findings.ts`, escrito a mano (ADR-004:
   `drizzle-kit generate` sigue prohibido).
3. Contratos y motor: `packages/forms` y `packages/contracts` antes que la API y la web, porque las
   dos los consumen.
4. API y web se despliegan juntas. **Sin backfill**: no hay inspecciones enviadas en producción, así
   que no hay hallazgos históricos que derivar. Si los hubiera, no habría de dónde sacarles
   descripción ni ubicación —otra razón para que esta etapa vaya antes de que el sistema se use.
5. Rollback: revertir el despliegue. La migración no se revierte —crea tablas inmutables vacías y
   dejarlas no rompe nada—; el `0011` que las quitara tendría que ser una decisión explícita.
