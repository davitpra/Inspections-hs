## 1. Contrato Zod del documento de plantilla

- [x] 1.1 Agregar `zod` como dependencia de `packages/contracts` y exponer el `exports` del
      paquete si todavía no lo hace.
- [x] 1.2 Escribir `packages/contracts/src/template-document.ts` con `templateDocumentSchema`:
      `sections[]` con `section_key`, `section_title`, `position`; `items[]` con `item_key`,
      `prompt`, `position`, `response_type` (`yes_no` | `scale` | `text` | `number`),
      `required`. `item_key` con regex de minúsculas, dígitos, `.` y `-` — el mismo patrón que
      el `CHECK` de la tarea 2.2.
- [x] 1.3 Agregar el refinamiento de unicidad de `position` dentro de cada `section_key`, con
      mensaje de error que nombre la sección y la posición duplicada (spec: "Duplicate
      positions within a section are rejected").
- [x] 1.4 Exportar `TemplateDocument` y los tipos derivados desde el índice del paquete y
      verificar que `packages/contracts` sigue sin dependencias de Node.
- [x] 1.5 Test unitario del esquema: documento válido parsea; ítem sin `item_key` falla;
      `response_type` `"signature"` falla nombrando el campo; dos ítems con la misma
      `position` en la misma sección fallan.

## 2. Migración 0003 — las cuatro tablas

- [x] 2.1 Crear `apps/api/drizzle/0003_template_model.sql` con `template`: `id uuid` PK,
      `key text NOT NULL UNIQUE`, `name text NOT NULL`, `created_at timestamptz NOT NULL`,
      `deactivated_at timestamptz`. Sin `site_id` y sin RLS — dejar escrito en el comentario
      por qué (design D6).
- [x] 2.2 Agregar `template_item`: `item_key text` PK con `CHECK` de formato,
      `template_id uuid NOT NULL REFERENCES template(id)`, `created_at timestamptz NOT NULL`,
      `deactivated_at timestamptz`, `replaces_item_key text REFERENCES template_item(item_key)`.
- [x] 2.3 Agregar `template_version`: `id uuid` PK, `template_id uuid NOT NULL REFERENCES
      template(id)`, `version integer NOT NULL`, `document jsonb NOT NULL`,
      `published_at timestamptz NOT NULL`, `published_by uuid` (sin FK: `user` es de la etapa
      2), más `UNIQUE (template_id, version)`.
- [x] 2.4 Agregar `template_version_item`: `id uuid` PK, `template_version_id uuid NOT NULL
      REFERENCES template_version(id)`, `item_key text NOT NULL REFERENCES
      template_item(item_key)`, `section_key text NOT NULL`, `section_title text NOT NULL`,
      `position integer NOT NULL`, `prompt text NOT NULL`, `response_type text NOT NULL`,
      `required boolean NOT NULL`, más `UNIQUE (template_version_id, item_key)` y
      `UNIQUE (template_version_id, section_key, position)`.
- [x] 2.5 Índices de lectura: `(item_key)` sobre `template_version_item` — es el que va a
      necesitar el `GROUP BY` de recurrencia de la etapa 7 — y `(template_id, version DESC)`
      sobre `template_version`.

## 3. Migración 0003 — las garantías en el motor

- [x] 3.1 Escribir `hs_template_project_items()`: trigger `AFTER INSERT` sobre
      `template_version` que recorre `document->'sections'` y escribe una fila de
      `template_version_item` por ítem, tomando `section_key`, `section_title`, `position`,
      `prompt`, `response_type` y `required` del documento (design D2).
- [x] 3.2 En el mismo trigger, rechazar con `RAISE EXCEPTION` un ítem cuya `template_item`
      tenga `deactivated_at` no nulo, nombrando la `item_key` en el mensaje (spec: "A
      deactivated item is rejected in a new version"). Una `item_key` no registrada ya la
      rechaza la FK de 2.4.
- [x] 3.3 Escribir el trigger `BEFORE INSERT` de numeración sobre `template_version`: la
      `version` debe ser exactamente `max(version) + 1` de esa plantilla, o `1` si no hay
      ninguna (design D7).
- [x] 3.4 Escribir el trigger `BEFORE UPDATE` de `template_item` que rechaza con SQLSTATE
      `HS001` cualquier cambio que no sea de `deactivated_at` — `item_key` incluida (design D5).
- [x] 3.5 Aplicar `hs_make_immutable('template_version')` y
      `hs_make_immutable('template_version_item')`. Confirmar en el comentario que
      `hs_make_immutable` no toca `INSERT`, así que el trigger de proyección de 3.1 sigue
      pudiendo escribir.
- [x] 3.6 `GRANT SELECT` a `hs_app` sobre las cuatro tablas. Sin `INSERT`: en v1 publica el
      seed bajo `hs_migrator`. Dejar escrito que la etapa 8 concede `INSERT`, nunca `UPDATE`.
- [x] 3.7 Registrar `0003_template_model` en `apps/api/drizzle/meta/_journal.json` y verificar
      que aplica limpio con `pnpm db:reset && pnpm db:migrate`.

## 4. Espejo Drizzle

- [x] 4.1 Crear `apps/api/src/db/schema/templates.ts` con las cuatro tablas, con el mismo
      encabezado que `audit-log.ts`: la fuente de verdad es el `.sql`, este archivo es un
      espejo a mano y `drizzle-kit generate` está prohibido.
- [x] 4.2 Tipar `document` como `TemplateDocument` de `packages/contracts` vía
      `jsonb().$type<...>()`, y exportar los `$inferSelect` de las cuatro tablas.
- [x] 4.3 Reexportar desde `apps/api/src/db/schema/index.ts` y verificar que `apps/web` no
      importa nada de `apps/api` (regla de lint de ADR-007).

## 5. Seeds SQL

- [x] 5.1 Crear `apps/api/seeds/001_monthly_inspection.sql`: una plantilla real de inspección
      mensual con sus secciones e ítems, como documento JSONB, más las filas de
      `template_item` que registran cada `item_key`.
- [x] 5.2 Hacerlo idempotente: `ON CONFLICT DO NOTHING` sobre `template.key` y
      `template_item.item_key`, y `WHERE NOT EXISTS` para `template_version` — `ON CONFLICT`
      no sirve ahí porque el trigger `BEFORE INSERT` de numeración corre antes de que el
      índice único resuelva el conflicto. Nunca `ON CONFLICT DO UPDATE`: `template_version`
      es inmutable.
- [x] 5.3 Agregar el script `db:seed` en `apps/api/package.json` (corre bajo
      `MIGRATION_DATABASE_URL`, aplica los `.sql` de `seeds/` en orden) y exponerlo desde el
      `package.json` raíz.
- [x] 5.4 Verificar a mano: `pnpm db:reset && pnpm db:migrate && pnpm db:seed && pnpm db:seed`
      corre dos veces sin error y no duplica filas.

## 6. Integración — identidad, inmutabilidad y seeds

- [x] 6.1 Crear `apps/api/test/template-model.int-spec.ts` sobre la infraestructura de
      Testcontainers ya existente.
- [x] 6.2 Inmutabilidad: `UPDATE` y `DELETE` de `hs_app` sobre `template_version` y
      `template_version_item` fallan con `42501`; el `UPDATE` de `hs_migrator` falla con
      `HS001`; la fila sigue igual al releerla.
- [x] 6.3 Proyección: insertar un `template_version` cuyo documento declara N ítems y afirmar
      que existen N filas, comparando contra `jsonb_array_length` y no contra un número
      escrito a mano.
- [x] 6.4 `item_key`: `UPDATE template_item SET item_key = ...` falla con `HS001`; insertar una
      `item_key` repetida falla con violación de único; una fila de ítem con `item_key` no
      registrada falla con violación de FK; `replaces_item_key` inexistente falla con FK.
- [x] 6.5 Desactivación: con `deactivated_at` puesto, publicar una versión nueva que incluya
      ese ítem falla nombrando la `item_key`; las versiones ya publicadas siguen resolviéndolo.
- [x] 6.6 Numeración: publicar `version` 4 cuando la máxima es 2 falla; publicar `version` 2
      dos veces falla con violación de único.
- [x] 6.7 Seeds: correr `seeds/` contra la base del contenedor, leer todos los
      `template_version.document` y parsearlos con `templateDocumentSchema`; afirmar que cada
      ítem del documento tiene su fila y su `template_item`.

## 7. Integración — spike 3, el criterio central

- [x] 7.1 Crear `apps/api/test/fixtures/finding_stub.sql`: tabla stand-in con
      `template_version_item_id` (FK real), `item_key` (FK real a `template_item`) y
      `occurred_at`, con el comentario de que se retira cuando la etapa 4 cree `finding`
      (design D8).
- [x] 7.2 Crear `apps/api/test/item-identity.int-spec.ts` y publicar **v1**: ítem
      `guards.packaging-lines` en la sección `general`, `position` 4, `response_type`
      `yes_no`. Registrar 1 hallazgo contra la fila de esa versión.
- [x] 7.3 Publicar **v2** con el ítem reescrito, movido a la sección `machine-safety` y en
      `position` 1, con la **misma** `item_key`. Registrar 2 hallazgos.
- [x] 7.4 Publicar **v3** con `response_type` cambiado a `scale` y la **misma** `item_key`.
      Registrar 1 hallazgo.
- [x] 7.5 **La aserción del spike:** agrupar los hallazgos por `item_key` devuelve exactamente
      una fila para `guards.packaging-lines` con count 4. Afirmar además explícitamente que no
      devuelve tres filas con counts 1, 2 y 1 — el fallo del riesgo A es "agrupa mal", no
      "no devuelve nada".
- [x] 7.6 Fidelidad legal: leer los cuatro hallazgos por su `template_version_item_id` y
      afirmar que el de v1 resuelve `prompt`, `section_key`, `position` y `response_type`
      como se declararon en v1, y que el de v3 resuelve `response_type` `scale`.
- [x] 7.7 Linaje: registrar `guards.line-3` con `replaces_item_key` `guards.packaging-lines` y
      afirmar que la agrupación por `item_key` las reporta como dos series separadas.

## 8. Cierre

- [x] 8.1 Correr `pnpm lint`, `pnpm test` y la suite de integración completa en limpio.
- [x] 8.2 Verificado: el glob `test/**/*.int-spec.ts` de `vitest.integration.config.mts`
      levanta los dos specs nuevos sin tocar la configuración ni el workflow.
- [x] 8.3 Verificado: `docs/adr/004-postgres-drizzle-rls.md` ya lista este change en "Changes
      que la consumen". Sin cambios.
- [x] 8.4 Registrado arriba de todo en `apps/api/test/fixtures/finding_stub.sql`: crear
      `finding` en la etapa 4 implica retirar el fixture y reapuntar
      `item-identity.int-spec.ts` a la tabla real. `design.md` D8 apunta ahí.
