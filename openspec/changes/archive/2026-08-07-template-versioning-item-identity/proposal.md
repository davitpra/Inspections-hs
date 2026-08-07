# Modelo de plantillas, versionado e identidad dual del ítem

## Why

El riesgo A de `docs/Requisitos_V1.2.md` §5 es el más peligroso del proyecto porque **no
produce ningún error**: si el hallazgo apunta solo a la fila del ítem dentro de una versión,
cada edición de plantilla parte la serie histórica, la consulta sigue devolviendo filas y el
dashboard muestra "no hay hallazgos recurrentes" sin que nadie dude de la pantalla. La feature
más valiosa del sistema falla en silencio.

Es la **etapa 1** de §7 y cierra el **spike 3**: `v1 → v2 → v3` con ediciones realistas debe
devolver una serie de 4, no 1 + 2 + 1. La etapa 0 (`bootstrap-immutable-persistence`) ya dejó
el mecanismo de inmutabilidad y RLS verificado; esta etapa escribe la primera tabla de dominio
encima de él. Va ahora porque todo lo que sigue —inspecciones, respuestas, hallazgos— apunta a
un `template_version_id`: si la identidad del ítem se equivoca acá, se descubre con datos
reales de dos sitios y sin forma de recomponer las series.

## What Changes

- **`template`** — la cabecera mutable: `key`, nombre, `deactivated_at`. Es la única tabla del
  change que admite `UPDATE`, y solo sobre nombre y desactivación.
- **`template_item`** — el registro del **concepto**, con `item_key` como clave primaria. Acá
  viven `deactivated_at` y `replaces_item_key` (§4, linaje). Separar el concepto de su
  proyección por versión es lo que permite que un ítem se desactive sin tocar ninguna versión
  ya publicada.
- **`template_version`** — el documento **JSONB inmutable**, validado con Zod desde
  `packages/contracts`. Una versión publicada nunca se edita: se publica otra.
  `hs_make_immutable`.
- **`template_version_item`** — la proyección en filas de cada ítem del documento, con los **dos
  identificadores separados**: `id` propio de la fila (fidelidad legal: qué pregunta, con qué
  redacción, en qué sección, con qué tipo de respuesta) e `item_key` estable (analítica: la
  clave de agrupación). La proyección la hace un trigger `AFTER INSERT` sobre el documento, no
  el código de aplicación — un ítem no puede existir en el documento y faltar en las filas.
  `hs_make_immutable`.
- **Regla central, forzada por el esquema:** cambiar la redacción, mover el ítem de sección,
  reordenarlo o cambiarle el tipo de respuesta (`yes_no` → `scale`) produce una fila nueva y
  **conserva la `item_key`**. `item_key` es inmutable, no se reutiliza y no se recicla.
- **Zod compartido** — el esquema del documento de plantilla vive en `packages/contracts` y es
  la fuente de verdad de la forma del documento. Un test verifica que **todo seed publicado
  parsea**, así que un seed malformado rompe CI y no la primera inspección.
- **Carga por seed SQL** — `apps/api/seeds/*.sql` más un script `db:seed`. Las primeras
  plantillas las carga el desarrollador; el coordinador deja de depender de él en la etapa 8.
- **Test de integración del spike 3 en CI desde el primer día** —
  `apps/api/test/item-identity.int-spec.ts`: tres versiones sucesivas con las ediciones
  exactas de §5 riesgo A, y la aserción de que agrupar por `item_key` devuelve **una serie de
  4**.

Fuera de alcance, explícito:

- **Toda interfaz de edición.** El builder visual es la etapa 8 y un change posterior.
- **La tabla `finding` y la consulta de recurrencia de producción.** Son las etapas 4 y 7. El
  test del spike 3 crea su propio stand-in de hallazgos con exactamente las dos columnas de
  identidad que la etapa 4 va a usar, y ese stand-in se retira cuando `finding` exista.
- **`item_key` + ubicación** como clave de recurrencia (pregunta cerrada 11): es una consulta
  de la etapa 7. Acá se garantiza que la `item_key` sobrevive, que es la mitad que bloquea.

## Capabilities

### New Capabilities

- `templates`: el modelo de plantilla, el versionado con publicación congelada y la identidad
  dual del ítem — incluida la garantía de que la `item_key` sobrevive a reescritura, cambio de
  sección, reordenamiento y cambio de tipo de respuesta.

### Modified Capabilities

- `immutability`: ninguna. Este change **consume** `hs_make_immutable` y no cambia el
  mecanismo, así que no hay delta.

## Impact

- **Migraciones** — `apps/api/drizzle/0003_template_model.sql`, escrita a mano y registrada en
  `_journal.json`. `drizzle-kit generate` sigue prohibido (ADR-004): regeneraría el `.sql` sin
  el `REVOKE`, sin los triggers y sin la proyección.
- **Esquema Drizzle** — `apps/api/src/db/schema/templates.ts`, espejo a mano del SQL, igual que
  `audit-log.ts`. Sigue viviendo solo en `apps/api`.
- **`packages/contracts`** — primera dependencia real del paquete: Zod y el esquema del
  documento de plantilla. El cliente consumirá estos tipos, nunca el esquema Drizzle.
- **Scripts** — `db:seed` nuevo en `apps/api/package.json` y en la raíz.
- **CI** — el job de integración existente cubre el spec nuevo; no hace falta job nuevo.
- **Sin FK a `site`** — las plantillas son datos de referencia de toda la organización, no de
  un sitio. No llevan `site_id` y por lo tanto **no** llevan política RLS: el aislamiento por
  sitio vive en los hallazgos y las inspecciones, que sí lo tienen. Ver `design.md`.
