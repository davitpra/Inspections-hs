# Catálogo de sitios y ubicaciones

## Why

La pregunta cerrada 1 de `docs/Requisitos_V1.2.md` §6 decidió que la ubicación de un hallazgo
es **lista cerrada administrada por el coordinador**, no texto libre. El motivo es el mismo
riesgo A que ya cerró la etapa 1 desde el otro lado: con 48 acres, "falta guarda en línea de
empaque" cuatro meses seguidos puede ser la misma línea o cuatro distintas. La `item_key`
estable da "la misma pregunta"; sin ubicación estructurada no da "en el mismo lugar", y la
recurrencia de la etapa 7 —el criterio de §5 riesgo A y de la pregunta cerrada 11— sigue sin
poder agrupar.

Es la primera mitad de la **etapa 2** de §7 ("Sitio, Persona, Usuario, auth, importación CSV
del roster"): pone `site`, que es la tabla de la que cuelga *todo* el aislamiento por sitio, y
`location`, que es el catálogo cerrado. Va ahora y no después porque tres cosas ya escritas la
están esperando: `audit_log.site_id` es un `uuid` sin FK con un comentario que dice
literalmente que la etapa 2 agrega la referencia; `hs_apply_site_isolation` existe pero
ninguna tabla la usa todavía, así que el aislamiento por sitio está sin probar sobre datos; y
la etapa 3 (inspecciones) no puede escribir una fila sin un `site_id` real al que apuntar.

Persona, Usuario, auth e importación del roster son la otra mitad de la etapa 2 y quedan para
un change propio: dependen de ADR-011 y no bloquean nada de lo anterior.

## What Changes

- **`site`** — las dos plantas (`st-thomas`, `glencoe`) como filas con `code` estable y `name`
  editable. Es dato de referencia de la organización: se carga por seed, con UUID fijo, y la
  API no la escribe.
- **`location`** — el catálogo cerrado, **por sitio**. `site_id` obligatorio, `code` estable e
  inmutable, `name` editable, `deactivated_at` para la baja lógica. Único por
  `(site_id, code)`, y único por `(site_id, name)` **solo entre las activas**, para que no
  haya dos entradas idénticas en el desplegable y a la vez se pueda reciclar el nombre de una
  ubicación dada de baja hace años.
- **Baja lógica, nunca `DELETE`** — `location` no concede `DELETE` a ningún rol y lo bloquea
  además con trigger. Una ubicación desactivada desaparece de la lista de selección y sigue
  resolviendo desde los hallazgos históricos, exactamente como el ítem de plantilla en la
  etapa 1.
- **La lista cerrada se fuerza en el esquema, no en el formulario** — no existe columna de
  texto libre de ubicación en ninguna parte. Lo que las etapas 3 y 4 van a apuntar es un
  `location_id` con FK, y la FK es **compuesta** `(site_id, location_id)`: una inspección de
  St. Thomas no puede referenciar una ubicación de Glencoe ni por bug ni por payload
  manipulado. Este change deja puesto el `UNIQUE (site_id, id)` que esa FK necesita.
- **Aislamiento por sitio, primera aplicación real** — `location` es la primera tabla del
  proyecto con `hs_apply_site_isolation`. El aislamiento de §6 pregunta 5 pasa de ser un
  mecanismo escrito a ser un mecanismo probado contra datos de dos sitios.
- **Mutabilidad parcial forzada por el motor** — `location` admite `UPDATE` solo sobre `name`
  y `deactivated_at`, con `GRANT UPDATE (columnas)` y un trigger `BEFORE UPDATE` que rechaza
  con `HS001` cualquier otro cambio. Mismo patrón que `template_item` en la etapa 1.
- **Toda alta, renombre, baja y reactivación de ubicación entra al log de auditoría**, escrita
  por un trigger y no por el servicio. Sin auth todavía, el actor sale de
  `app.user_id`; sin trigger, la primera pantalla que se olvide de auditar deja un hueco que
  nadie ve.
- **FK de `audit_log.site_id` → `site(id)`**, la referencia que `0002_audit_log.sql` dejó
  anotada como pendiente de esta etapa.
- **Seeds** — las dos plantas y su catálogo inicial de ubicaciones, idempotentes, en
  `apps/api/seeds/`.

Fuera de alcance, explícito:

- **Jerarquías de más de un nivel.** Una ubicación no tiene padre. Si "Línea de empaque 3"
  necesita partirse en estaciones, es un `code` nuevo, no un árbol.
- **Mapas, planos y coordenadas.** Ninguna columna de geometría.
- **Códigos QR por estación.** Está en la lista de fuera de alcance de v1 y la pregunta
  cerrada 1 lo descarta por nombre.
- **Persona, Usuario, auth e importación CSV del roster.** La otra mitad de la etapa 2.
- **La UI de administración del catálogo.** Este change es esquema, contrato y seeds; el
  endpoint y la pantalla del coordinador llegan con `identity`, que es lo que permite exigir
  que sea *el coordinador* quien administra.
- **Ordenamiento manual del desplegable.** Se ordena por `name`. Un `sort_order` editable es
  una columna mutable más para un problema que dos sitios con decenas de ubicaciones no tienen.

## Capabilities

### New Capabilities

- `catalog`: sitios y ubicaciones como catálogo cerrado por sitio — identidad estable,
  selección desde lista sin texto libre, baja lógica que preserva la resolución histórica,
  aislamiento por sitio e integridad `(sitio, ubicación)` para todo lo que apunte al catálogo.

### Modified Capabilities

- `audit`: se agrega el requisito de que `audit_log.site_id` referencie una fila real de
  `site` — hasta ahora era un `uuid` libre por orden de construcción — y el de que los cambios
  del catálogo se auditen sin depender del código de aplicación.

## Impact

- **Migraciones** — `apps/api/drizzle/0004_site_location_catalog.sql`, escrita a mano y
  registrada a mano en `_journal.json`. `drizzle-kit generate` sigue prohibido (ADR-004).
- **Esquema Drizzle** — `apps/api/src/db/schema/catalog.ts`, espejo a mano del SQL, reexportado
  desde `schema/index.ts`. Sigue viviendo solo en `apps/api`.
- **`packages/contracts`** — tipos y esquema Zod de sitio y ubicación, que es lo que el cliente
  va a consumir para pintar el desplegable.
- **`withSiteScope`** — deja de ser código sin uso: es lo único que hace visible una fila de
  `location`. Cualquier consulta al catálogo que no declare alcance devuelve vacío, y eso pasa
  a estar cubierto por un test.
- **`audit_log`** — `ALTER TABLE ... ADD CONSTRAINT` de la FK a `site`. No toca datos ni el
  encadenado; el hash se calcula sobre el contenido, que no cambia.
- **Seeds** — `apps/api/seeds/002_sites.sql` y `003_locations.sql`. Corren bajo `hs_migrator`,
  que con `FORCE ROW LEVEL SECURITY` **tampoco** evade la política: el seed de ubicaciones
  declara `app.site_ids` como cualquier otra transacción. Es el primer lugar del proyecto donde
  eso se nota.
- **CI** — el job de integración existente cubre el spec nuevo; no hace falta job nuevo.
- **Etapa 4** — `apps/api/test/fixtures/finding_stub.sql` gana `site_id` y `location_id` con la
  FK compuesta real, para que el spike 3 siga corriendo y la integridad `(sitio, ubicación)`
  quede probada antes de que exista `finding`.
