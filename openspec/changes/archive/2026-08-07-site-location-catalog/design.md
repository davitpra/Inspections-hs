## Context

Ver `proposal.md` — Why. Lo que ya está puesto y este change consume tal cual:

- `hs_make_immutable(regclass)` y `hs_apply_site_isolation(regclass)` de
  `0001_immutability_mechanism.sql` (ADR-002, ADR-004). La segunda no la usa todavía ninguna
  tabla: este change es su primer consumidor.
- SQLSTATE `HS001` como código propio del trigger de inmutabilidad, distinto de `42501`, para
  poder afirmar en los tests cuál de las dos barreras frenó la sentencia.
- `withSiteScope` (`apps/api/src/db/site-scope.ts`), que fija `app.site_ids` y `app.user_id` con
  `set_config(..., true)` — o sea `SET LOCAL`, muere con la transacción. Es lo único que declara
  alcance, y por lo tanto lo único que hace visible una fila de `location`.
- `audit_log` con encadenado por sitio y `site_id uuid` **sin FK**, con el comentario de
  `0002_audit_log.sql` que dice que la referencia la agrega la etapa 2.
- El patrón de mutabilidad parcial de `template_item` (ADR-002 vía design D5 de la etapa 1):
  `GRANT` acotado más `BEFORE UPDATE` que rechaza con `HS001` lo que no sea el campo permitido.
- Migraciones escritas a mano y registradas a mano en `_journal.json`. `drizzle-kit generate`
  prohibido (ADR-004).
- Suite de integración con Testcontainers que levanta el mismo `db/init/01-roles.sql` que
  `docker-compose.yml`.

**Tablas inmutables que este change toca:** `audit_log`, y solo con
`ALTER TABLE ... ADD CONSTRAINT`. No hay `UPDATE` ni `DELETE` de filas, y la FK no entra en
`hs_audit_canonical`, así que ningún hash cambia y la verificación de la cadena sigue dando lo
mismo antes y después de la migración. `site` y `location` son tablas **parcialmente mutables**
nuevas: no se les aplica `hs_make_immutable`, llevan su propio trigger.

Restricción que ordena el diseño: "lista cerrada" no es una regla de formulario. Un formulario
que ofrece un desplegable pero acepta un `location_id` cualquiera, o un endpoint que confía en
el `site_id` del payload, deja la lista abierta por la puerta de atrás sin producir ningún
error. Todo lo que se pueda mover al motor, se mueve al motor.

## Goals / Non-Goals

**Goals:**

- Que sea imposible representar el estado que rompe la agrupación por ubicación: ubicación sin
  sitio, ubicación borrada, ubicación de otro sitio, dos entradas activas con el mismo nombre,
  `code` reescrito.
- Que el aislamiento por sitio quede probado sobre datos reales de dos sitios, incluida la
  transacción sin alcance y el rol dueño de la tabla.
- Que el catálogo sea administrable sin que administrarlo pueda romper una inspección histórica.
- Que la etapa 3 pueda escribir `inspection` sin decidir nada más sobre ubicación.

**Non-Goals:**

- Cualquier endpoint HTTP o pantalla. Este change es esquema, contrato Zod y seeds. Exigir que
  sea *el coordinador* quien administra requiere roles, que son de `identity`.
- La clave de recurrencia de producción (`item_key` solo vs. `item_key` + `location_id`,
  pregunta cerrada 11). Es una consulta de la etapa 7. Acá se garantiza que la ubicación es
  agrupable, que es la mitad que bloquea.
- Ordenamiento manual, agrupación visual o búsqueda del desplegable.

## Decisions

### D1 — `site` es dato de referencia y no lleva RLS; `location` sí

`site` tiene dos filas, un `code` y un `name`. No contiene información operativa de un sitio:
contiene la existencia del sitio. Ponerle RLS crearía un problema de arranque circular —para
insertar la fila habría que declarar en `app.site_ids` un id que todavía no existe— a cambio de
esconder el hecho de que la otra planta existe, que no es lo que protege §6 pregunta 5. Lo que
esa pregunta protege son los **hallazgos**, y esos viven en tablas con `site_id` y con política.

`location` sí es contenido operativo del sitio: la lista de áreas de una planta de 48 acres
describe la planta. Lleva `hs_apply_site_isolation('location')` y es el primer consumidor real
del helper.

*Alternativa descartada:* RLS también sobre `site`, con una política a mano sobre `id` en lugar
de `site_id` (el helper asume la columna `site_id`). Obliga a que el seed de sitios declare
alcance sobre ids que él mismo está creando, y a que toda pantalla de administración lo declare
para poder listar dos filas de referencia. Costo real, beneficio nulo.

Consecuencia declarada: cualquier rol conectado puede leer las dos filas de `site`. El
aislamiento empieza en `location`.

### D2 — El seed de ubicaciones declara alcance, y los sitios llevan UUID fijo

`hs_apply_site_isolation` hace `FORCE ROW LEVEL SECURITY`, así que `hs_migrator` —dueño de la
tabla— tampoco evade la política. El seed de ubicaciones tiene que declarar `app.site_ids` como
cualquier otra transacción, o sus `INSERT` los rechaza el `WITH CHECK` y el error no menciona
RLS por ningún lado.

Para poder declararlo, los dos sitios se siembran con **literales UUID fijos** en
`002_sites.sql`. No es cosmético: es lo que permite que `003_locations.sql`, los fixtures de
test y cualquier seed futuro nombren un sitio sin una subconsulta, y que el alcance se pueda
fijar antes de que exista la primera fila de `location`.

Ese `set_config` en un seed es además la primera demostración escrita de que el aislamiento no
tiene puerta trasera para el rol de migración. Va comentado en el archivo con esa palabra.

*Alternativa descartada:* `BYPASSRLS` sobre `hs_migrator` para que los seeds no se enteren.
Sería exactamente la puerta trasera que ADR-004 no quiere, y estaría siempre abierta, no solo
durante el seed.

### D3 — La integridad `(sitio, ubicación)` es una FK compuesta, no una validación

`location` lleva `UNIQUE (site_id, id)` — redundante como restricción, ya que `id` es PK, pero
es lo que Postgres exige para poder ser el destino de una FK compuesta. Con eso, toda tabla
futura con ubicación declara:

```sql
FOREIGN KEY (site_id, location_id) REFERENCES location (site_id, id)
```

y una inspección de St. Thomas con una ubicación de Glencoe es un error de FK, no un bug de
validación. Vale la pena porque es justo el error que un payload manipulado o un merge apurado
producen, y porque el aislamiento por RLS **no** alcanza para atraparlo: un coordinador tiene
las dos plantas en su alcance, así que para él las dos filas son visibles y la política no dice
nada.

Este change no crea ninguna tabla que use la FK compuesta —`inspection` y `finding` son de las
etapas 3 y 4—, así que la garantía se prueba sobre el stub de hallazgos que ya dejó la etapa 1
(D6, abajo).

*Alternativa descartada:* derivar `site_id` de la ubicación en lugar de guardarlo. Deja la
inspección sin `site_id` propio, y sin `site_id` propio no hay política RLS que aplicarle.

### D4 — Dos claves por ubicación: `code` estable, `name` editable

Mismo razonamiento que la identidad dual del ítem (etapa 1, D4), un nivel más abajo:

- `code` (`packaging-line-3`) es la identidad. Inmutable, único por sitio, legible, es lo que
  escriben los seeds y los tests. Formato validado por `CHECK`: minúsculas, dígitos, `.` y `-`.
- `name` (`Packaging line 3`) es la etiqueta que ve el operador. Editable, porque el coordinador
  va a querer arreglar una mayúscula sin que eso sea un evento de esquema.

El `UNIQUE (site_id, name)` es **parcial**, `WHERE deactivated_at IS NULL`. Sin el parcial, un
nombre dado de baja hace tres años quedaría quemado para siempre; con el índice total, además,
reactivar sería un choque con una fila que ya nadie usa. El único activo es lo que protege el
desplegable, que es donde el duplicado hace daño.

*Alternativa descartada:* solo `name`, sin `code`. Renombrar pasaría a ser cambiar la identidad,
y el seed no tendría cómo ser idempotente sin `ON CONFLICT` sobre un texto que el coordinador
puede editar.

### D5 — Mutabilidad parcial: `GRANT` por columna más trigger

`location` necesita `UPDATE` para `name` y `deactivated_at`, así que no se le puede aplicar
`hs_make_immutable`. Lleva las dos barreras del patrón de la etapa 1:

- `GRANT UPDATE (name, deactivated_at) ON location TO hs_app` — a `hs_app` el motor le rechaza
  con `42501` cualquier otra columna, sin que el trigger llegue a correr.
- `BEFORE UPDATE` propio que rechaza con `HS001` todo cambio de `id`, `site_id`, `code` o
  `created_at` — esta es la barrera que también alcanza a `hs_migrator`, que es dueño y por lo
  tanto siempre podría.

`DELETE` no se concede a nadie y además lo rechaza el mismo trigger, por lo que la baja lógica
no es una convención: es lo único que la tabla admite. `site` lleva el mismo tratamiento con la
lista de columnas mutables reducida a `name` y `deactivated_at`.

### D6 — La auditoría del catálogo la escribe un trigger

`AFTER INSERT OR UPDATE` sobre `location` escribe la fila de `audit_log`, con `site_id` de la
ubicación, `actor_user_id` de `current_setting('app.user_id', true)` y `event_type` según qué
cambió: creación, renombre, baja, reactivación. Un `UPDATE` que no cambia nada observable no
escribe nada.

Razón: en este change no hay servicio que auditar —el catálogo se carga por seed— y en el
siguiente habrá uno solo. Si la auditoría vive en el servicio, el hueco aparece la primera vez
que alguien escriba una segunda ruta de escritura, y el hueco es invisible: la operación
funciona, simplemente no queda registrada. Es el mismo argumento que hizo que la proyección de
ítems de la etapa 1 fuera un trigger y no código.

El actor sale del alcance de la transacción, no de un parámetro: `withSiteScope` ya fija
`app.user_id`, así que el servicio no tiene nada que recordar. Nulo durante los seeds, que es lo
correcto — no hay usuario detrás de una migración.

*Alternativa descartada:* auditar desde el servicio de catálogo. Se posterga a la etapa en la
que ese servicio exista y deja este change sin auditoría de sus propios seeds.

### D7 — La FK de `audit_log.site_id` se agrega ahora, no se pospone

`0002_audit_log.sql` dejó la columna sin FK con el comentario de que la agrega la etapa 2. Es
esta. Se agrega con `ALTER TABLE ... ADD CONSTRAINT`, que sobre una tabla inmutable es legal:
`hs_make_immutable` bloquea `UPDATE`, `DELETE` y `TRUNCATE` de filas, no DDL del dueño. La
migración corre sobre una base sin datos de producción; si en algún entorno hubiera filas con
un `site_id` inventado, la migración falla, y fallar es el comportamiento correcto.

Se agrega con `ON DELETE NO ACTION` explícito. Cascada sería absurdo acá: `site` no se borra, y
si algún día alguien intentara, la FK tiene que frenarlo, no llevarse puesto el registro
regulatorio.

### D8 — El stub de hallazgos gana ubicación, y la promesa de la etapa 4 se mantiene

`apps/api/test/fixtures/finding_stub.sql` existe desde la etapa 1 con las dos columnas de
identidad del ítem. Este change le agrega `site_id` y `location_id` con la FK compuesta **real**
de D3. Con eso, la integridad cruzada y la resolución de una ubicación desactivada se prueban
sobre el esquema de producción de `location`, y lo único simulado sigue siendo el hallazgo.

El aviso que ya está arriba de todo en ese archivo —que se retira cuando la etapa 4 cree
`finding`— pasa a cubrir también estas dos columnas.

*Alternativa descartada:* adelantar `inspection` para tener dónde probar la FK compuesta. Es
esquema de otra etapa, con `template_version_id`, estado y offline detrás.

## Risks / Trade-offs

- **RLS sobre `location` significa que una consulta sin alcance devuelve vacío en vez de
  fallar** → es el default correcto (`site-scope.ts` lo documenta), pero un bug de "olvidé
  declarar alcance" se ve como "el catálogo está vacío", no como un error. Mitigación: es un
  escenario del spec y un test de integración explícito, así que la forma de fallar queda
  escrita antes de que alguien la encuentre en una pantalla.

- **El `UNIQUE (site_id, name)` parcial permite dos filas con el mismo nombre, una activa y una
  dada de baja** → un reporte histórico que agrupe por `name` en vez de por `location_id` las
  contaría junto. Aceptado: la clave de agrupación es `location_id`, y la etapa 7 tiene que
  usarla. Queda anotado acá porque es la trampa obvia al escribir esa consulta.

- **El trigger de auditoría hace que un `UPDATE` de catálogo escriba dos filas en dos tablas, y
  `audit_log` serializa por sitio** → irrelevante en volumen (decenas de ubicaciones, cambios
  esporádicos), pero significa que un renombre masivo toma el lock de la cadena del sitio una
  vez por fila. Si algún día hay carga masiva de catálogo, va en una transacción y se acepta el
  costo.

- **Sin `identity` todavía, nada impide que cualquier usuario autenticado administre el
  catálogo** → lo único que hay hoy es el `GRANT` de columnas a `hs_app`. Declarado y acotado:
  en este change no existe endpoint alguno, así que la superficie es cero hasta que exista el
  change de `identity`, que es el que trae el chequeo de rol.

- **`code` inmutable con un typo se arregla creando otra ubicación y dando de baja la primera**
  → asumido a propósito. Es la misma decisión que `item_key`: la alternativa es un identificador
  editable, y un identificador editable no identifica nada.

## Migration Plan

1. `0004_site_location_catalog.sql` — `site` y `location`, `CHECK` de formato de `code`,
   `UNIQUE (site_id, id)`, índice único parcial por nombre activo, triggers de mutabilidad
   parcial, `hs_apply_site_isolation('location')`, trigger de auditoría, `GRANT` acotados, y la
   FK de `audit_log.site_id`. Entrada nueva en `_journal.json`.
2. `apps/api/src/db/schema/catalog.ts` — espejo a mano del SQL, con el mismo encabezado que
   `templates.ts` sobre cuál es la fuente de verdad.
3. `packages/contracts` — esquemas Zod y tipos de sitio y ubicación, incluida la forma de la
   entrada del desplegable. Sin dependencias de Node.
4. `apps/api/seeds/002_sites.sql` y `003_locations.sql`, idempotentes.
5. Tests de integración: mutabilidad parcial, baja lógica, unicidad, aislamiento por sitio, FK
   compuesta sobre el stub, y auditoría del catálogo.

**Rollback:** ninguna tabla tiene datos de producción todavía. Revertir es `pnpm db:reset` más
quitar la entrada de `_journal.json`. Deja de serlo en cuanto la etapa 3 escriba la primera
inspección con `location_id`.
