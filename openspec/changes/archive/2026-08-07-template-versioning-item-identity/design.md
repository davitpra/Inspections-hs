## Context

Ver `proposal.md` — Why. Lo que ya está puesto y este change consume tal cual:

- `hs_make_immutable(regclass)` y `hs_apply_site_isolation(regclass)` de
  `0001_immutability_mechanism.sql` (ADR-002, ADR-004).
- Dos roles: `hs_migrator` (dueño, aplica migraciones) y `hs_app` (conexión de la API, sin
  `UPDATE`/`DELETE` por default privileges).
- SQLSTATE `HS001` como código propio del trigger de inmutabilidad — es lo que permite
  distinguir "te frenó el privilegio" (`42501`) de "te frenó el trigger".
- Migraciones escritas a mano y registradas a mano en `_journal.json`. `drizzle-kit generate`
  prohibido (ADR-004): regenerar el `.sql` desde el esquema Drizzle se lleva puesto el
  mecanismo.
- Suite de integración con Testcontainers levantando el mismo `db/init/01-roles.sql` que usa
  `docker-compose.yml`.

Restricción que ordena todo el diseño: la garantía del riesgo A tiene que ser **estructural**.
Una regla que el builder "debe respetar" es una regla que la etapa 8 va a poder violar sin
error. Lo que se pueda mover al motor, se mueve al motor.

## Goals / Non-Goals

**Goals:**

- Que sea imposible representar el estado que rompe la serie: documento publicado sin filas
  derivadas, fila de ítem sin concepto registrado, `item_key` editada, ítem borrado.
- Que el spike 3 corra sobre el esquema real de producción, no sobre tablas de juguete.
- Que la carga de plantillas no dependa de ninguna UI.

**Non-Goals:**

- Ninguna decisión sobre la clave de recurrencia de producción (`item_key` sola vs.
  `item_key` + `location_id`, pregunta cerrada 11). Es de la etapa 7.
- Ninguna API HTTP. Este change es esquema, contrato Zod y seeds.
- Lógica condicional entre ítems y scoring. Lo primero es de la etapa 8; lo segundo salió de
  v1 (riesgo E).

## Decisions

### D1 — Cuatro tablas, no dos: el concepto se separa de su proyección por versión

| Tabla                   | Qué es                                | Mutabilidad                              |
| ----------------------- | ------------------------------------- | ---------------------------------------- |
| `template`              | Cabecera: `key`, nombre               | Mutable (nombre, `deactivated_at`)       |
| `template_item`         | El **concepto**, PK `item_key`        | Mutable **solo** en `deactivated_at`     |
| `template_version`      | El documento JSONB publicado          | **Inmutable** — `hs_make_immutable`      |
| `template_version_item` | La proyección en filas del documento  | **Inmutable** — `hs_make_immutable`      |

El problema que resuelve la separación: §4 exige que un ítem se **desactive** en lugar de
borrarse, y `deactivated_at` es un `UPDATE`. Pero §4 exige también que una versión publicada
sea inalterable. Las dos cosas no pueden vivir en la misma fila. Con `template_item` aparte, la
desactivación toca el concepto y no toca ninguna versión ya publicada — que es exactamente la
semántica que pide el requisito ("desaparece de las versiones nuevas, sigue resolviendo desde
los hallazgos históricos").

*Alternativa descartada:* `deactivated_at` en `template_version_item`. Obliga a que la tabla de
la fidelidad legal sea mutable, y desactivar un ítem pasaría a ser un `UPDATE` sobre N filas
históricas — el opuesto exacto de lo que ADR-002 pide.

### D2 — La proyección del documento a filas la hace un trigger, no el código

`AFTER INSERT` sobre `template_version` recorre `document->'sections'` y escribe una fila de
`template_version_item` por ítem. Hace además tres validaciones que el motor puede sostener y
Zod no: que la `item_key` esté registrada en `template_item` (FK), que no esté desactivada, y
que `(section_key, position)` no se repita.

Razón: si la proyección la hiciera el servicio de publicación, un seed SQL —que es justamente
como se cargan las plantillas en v1— insertaría el documento y no las filas. El documento
existiría, la inspección se renderizaría desde el JSONB, y la consulta de recurrencia
devolvería vacío sin error. Es la forma de fallar del riesgo A, otra vez.

*Alternativa descartada:* generar las filas en el script de seed. Deja la invariante del lado
de quien escribe el seed.

### D3 — Zod valida la **forma**; el motor valida las **referencias**

`packages/contracts` exporta `templateDocumentSchema`. Es la fuente de verdad de la forma del
documento y la consume el cliente (que nunca ve el esquema Drizzle). Valida estructura,
`response_type` dentro del enum, unicidad de `position` por sección, formato de `item_key`.

Lo que Zod **no** puede validar es lo que depende del estado de la base: que la `item_key` ya
exista, que no esté desactivada, que la versión sea la siguiente. Eso son FKs y triggers.

Los seeds son SQL, así que el gate de Zod no puede correr antes del `INSERT`. Corre después:
un test de integración lee `template_version.document` de todas las filas sembradas y las
parsea. Un seed malformado rompe CI, que es el momento correcto — no la primera inspección.

*Alternativa descartada:* seeds en TypeScript que validan y luego insertan. Convierte la carga
de plantillas en código de aplicación, y el usuario pidió explícitamente seed SQL.

### D4 — `item_key` es texto legible, no UUID

`guards.packaging-lines`, no `9f2c...`. Tres razones: los seeds se escriben a mano y una key
opaca los vuelve ilegibles; la key aparece en el reporte de recurrencia que lee el coordinador;
y una key legible hace visible el error de reusar una key para otro concepto. Formato validado
por `CHECK`: minúsculas, dígitos, `.` y `-`.

Es PK global de `template_item`, no única por plantilla: §4 dice que no se reutiliza ni se
recicla, y "no se recicla" solo tiene sentido si el espacio de nombres es uno solo.

### D5 — `item_key` inmutable vía trigger, no vía convención

`template_item` necesita `UPDATE` para `deactivated_at`, así que no se le puede aplicar
`hs_make_immutable`. En su lugar lleva un `BEFORE UPDATE` propio que rechaza cualquier cambio
que no sea `deactivated_at` — con el mismo SQLSTATE `HS001`. Es la única forma de tener una
tabla parcialmente mutable sin que "parcialmente" quiera decir "en la práctica, entera".

### D6 — Las plantillas no llevan `site_id` y no llevan RLS

Una plantilla es contenido de referencia de la organización, no un dato de sitio. Si llevara
`site_id`, la misma inspección mensual existiría dos veces con dos juegos de `item_key`, y
"la misma guarda falta en los dos sitios" dejaría de ser consultable. El aislamiento por sitio
vive donde están los datos de sitio: `inspection` y `finding` (etapas 3 y 4), que sí llevan
`site_id` y sí llevan `hs_apply_site_isolation`.

Consecuencia declarada: `hs_app` puede leer todas las plantillas. No hay información de sitio
en ellas, así que no hay fuga. `hs_app` **no** tiene `INSERT` sobre estas tablas en v1 — la
publicación es del `hs_migrator` vía seed. La etapa 8 concederá `INSERT` (nunca `UPDATE`).

### D7 — Numeración de versiones forzada por trigger

`BEFORE INSERT` sobre `template_version`: la `version` nueva tiene que ser exactamente
`max(version) + 1` de esa plantilla, o `1` si no hay ninguna. Más un único
`(template_id, version)`. Una versión salteada rompería la lectura "qué preguntaba la plantilla
en tal fecha", y una versión repetida haría ambiguo a qué documento apunta una inspección.

### D8 — El spike 3 corre sobre el esquema real; los hallazgos son un stand-in explícito

La tabla `finding` es de la etapa 4 y está fuera de alcance. El test crea
`test/fixtures/finding_stub.sql`: una tabla con exactamente las dos columnas de identidad que
§4 le exige al hallazgo (`template_version_item_id` con FK real, `item_key` con FK real a
`template_item`) más `occurred_at`. Las plantillas, las versiones, las filas de ítem y las FKs
son las de producción; lo único simulado es el hallazgo.

El registro de que el stub es temporal vive en el propio
`apps/api/test/fixtures/finding_stub.sql`, en mayúsculas y arriba de todo: es el archivo en el
que va a aterrizar cualquiera que toque hallazgos. Cuando la etapa 4 cree `finding`, se retira
el fixture y `item-identity.int-spec.ts` se reapunta a la tabla real. La aserción del spike no
cambia: es la misma consulta.

*Alternativa descartada:* crear ya una `finding` parcial. Adelanta esquema de otra etapa y deja
una tabla inmutable a la que después hay que agregarle columnas `NOT NULL`.

## Risks / Trade-offs

- **El trigger de proyección es la pieza más cargada del change; si tiene un bug, la serie se
  parte igual que si no existiera** → es exactamente lo que cubre el spike 3, que corre en CI
  desde el primer commit del change. Además el test de "7 ítems en el documento → 7 filas"
  compara contra `jsonb_array_length`, no contra un número escrito a mano.

- **Recorrer JSONB en PL/pgSQL es más lento que un `INSERT ... SELECT`** → irrelevante: se
  ejecuta una vez por publicación, y una plantilla tiene decenas de ítems, no millones.

- **`item_key` estable da "la misma pregunta", no "la misma pregunta en el mismo lugar"**
  (límite conocido de §5 riesgo A) → declarado, no mitigado acá. La etapa 7 agrega
  `location_id` al `GROUP BY`; el índice `(item_key, ...)` que deja este change es el que esa
  consulta necesita.

- **Los hallazgos manuales no tienen `item_key` y quedan fuera de la recurrencia** →
  consecuencia aceptada en §4 y §6-bis pregunta 11. Se hace visible en el reporte de la etapa
  7, no se resuelve acá.

- **Un `replaces_item_key` mal usado no rompe nada visiblemente** → por diseño no aliasea
  series: es rastro, no regla de agrupación. Si la etapa 7 quiere unir series por linaje, es
  una decisión explícita de esa etapa con su propio test.

## Migration Plan

1. `0003_template_model.sql` — cuatro tablas, FKs, `CHECK` de formato de `item_key`, triggers
   (proyección, numeración, `item_key` inmutable), `hs_make_immutable` sobre `template_version`
   y `template_version_item`, `GRANT SELECT` a `hs_app`. Entrada nueva en `_journal.json`.
2. `apps/api/src/db/schema/templates.ts` — espejo a mano del SQL, con el mismo encabezado que
   `audit-log.ts` sobre cuál es la fuente de verdad.
3. `packages/contracts` — `templateDocumentSchema` en Zod y los tipos derivados.
4. `apps/api/seeds/` + script `db:seed`, idempotente vía `ON CONFLICT DO NOTHING` sobre las
   claves naturales (`template.key`, `template_item.item_key`, `(template_id, version)`).
5. Tests de integración: identidad dual, inmutabilidad de las dos tablas, spike 3, seeds
   parseando contra Zod.

**Rollback:** ninguna tabla tiene datos de producción todavía. Revertir es `pnpm db:reset` más
quitar la entrada de `_journal.json`. Después de que la etapa 3 escriba inspecciones reales
contra un `template_version_id`, ya no lo es — razón adicional para que el spike 3 esté verde
antes de que este change se cierre.
