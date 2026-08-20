## 0. Precondición

- [x] 0.1 Archivar `template-scope-and-builder-console` con `/opsx:archive`, para que el
      requisito «A draft declares the plants it is written for» viva en
      `openspec/specs/templates/spec.md` y la delta `MODIFIED` de este change tenga contra
      qué aplicar. Su tarea 7.3 (revisión visual del builder en `pnpm dev`) es lo único que
      le queda pendiente: hacerla o darla por buena antes de archivar.

## 1. Migración

- [x] 1.1 Crear `apps/api/drizzle/0021_retire_template_draft_revision.sql` con la forma de
      0016 y 0020: secciones numeradas y comentadas, `--> statement-breakpoint` entre
      sentencias.
- [x] 1.2 `ALTER TABLE template_draft DROP COLUMN revision;` — el `CONSTRAINT
      template_draft_revision_check` se va con la columna, sin sentencia propia.
- [x] 1.3 Reescribir **la lista completa** del `GRANT UPDATE`, no un `REVOKE` suelto
      (design — Decisions): `GRANT UPDATE (name, document, updated_at, discarded_at,
      site_ids) ON template_draft TO hs_app;`. `key` y `created_by` siguen sin estar, por las
      razones de 0016 §4.
- [x] 1.4 Escribir en la migración por qué la tabla ya no detecta escritura concurrente, con
      el argumento de ADR-001 y el costo declarado, en el lugar donde 0016 §1 argumentaba lo
      contrario. Es la sección que hace que el retiro se lea como decisión.
- [x] 1.5 Dejar constancia de que los triggers `template_draft_forbid_deletion` /
      `..._forbid_truncate` de 0016 §3 y la ausencia de RLS de 0016 §5 y 0020 §5 no cambian.
- [x] 1.6 `pnpm --filter api db:migrate` contra la base local y comprobar que la columna no
      está. **No correr `db:seed`.**

## 2. Contratos

- [x] 2.1 Quitar `revision` de `templateDraftSummarySchema` y de `saveTemplateDraftSchema` en
      `packages/contracts/src/templates.ts`.
- [x] 2.2 Reescribir el docblock de `saveTemplateDraftSchema`: se va el párrafo del lock, y el
      de `site_ids` pasa a justificarse por sí mismo —una edición como cualquier otra, un solo
      guardado— en vez de por el lock (design — Decisions).
- [x] 2.3 `pnpm --filter contracts build` y `pnpm --filter contracts exec vitest run`.

## 3. API

- [x] 3.1 `apps/api/src/db/schema/templates.ts`: fuera la columna `revision` y el párrafo del
      lock en el docblock de `templateDraft`.
- [x] 3.2 `apps/api/src/templates/templates.repository.ts`: sacar `revision` de
      `DRAFT_COLUMNS` y de `TemplateDraftRecord`; en `updateDraft`, quitar `revision =
      revision + 1` del `SET` y `AND revision = $4` del `WHERE`, y recorrer los placeholders
      (`site_ids` pasa a `$4`).
- [x] 3.3 Reescribir el docblock de `updateDraft`: ya no explica un lock, explica que cero
      filas tiene una sola causa.
- [x] 3.4 `apps/api/src/templates/templates.service.ts`: sacar `revision` del input de
      `saveDraft` y del mapeo de salida; borrar la lectura de seguimiento y dejar
      `templateDraftNotFound()` como única salida de cero filas (design — Decisions).
- [x] 3.5 Borrar `templateDraftStale` de `apps/api/src/templates/templates.errors.ts` y
      comprobar con `grep` que no queda ninguna referencia en `apps/api`.

## 4. Web

- [x] 4.1 `TemplateDraftRoute/presentation.ts`: `saveStateLabel` pierde el parámetro y
      devuelve `'Saved'` / `'Unsaved changes'`. Actualizar sus casos en
      `presentation.test.ts`.
- [x] 4.2 `TemplateDraftRoute/DraftHeader.tsx`: fuera la prop `revision`, su tipo y el
      comentario que explicaba la etiqueta numerada.
- [x] 4.3 `TemplateDraftRoute/index.tsx`: sacar `revision` del estado cargado, del cuerpo de
      la mutación, del `onSuccess` y de las props del encabezado.
- [x] 4.4 `apps/web/src/api/templates.ts`: reescribir el docblock de `saveTemplateDraft`, que
      hoy documenta el error `template_draft_stale`.
- [x] 4.5 Revisar si queda manejo del código `template_draft_stale` en el mapeo de errores de
      la ruta y quitarlo.

## 5. Tests

- [x] 5.1 `apps/api/test/template-drafts.int-spec.ts`: reescribir el test de privilegios que
      hoy usa `revision = revision + 1` como sonda del `GRANT UPDATE`, apuntándolo a `name` y
      `document`. **No borrarlo** — es la comprobación que más importa después de tocar los
      privilegios (design — Decisions).
- [x] 5.2 Borrar los dos casos de guardado stale (el de documento y el de `site_ids`) y las
      aserciones sobre el avance del contador.
- [x] 5.3 Sacar `revision` de los cuerpos de guardado y de los fixtures restantes del mismo
      archivo.
- [x] 5.4 Agregar el caso del requisito nuevo: dos lecturas del mismo borrador, dos guardados
      distintos, el segundo gana y no queda nada del primero.
- [x] 5.5 `apps/web/src/routes/TemplateDraftRoute/index.test.tsx` y
      `TemplatesRoute/index.test.tsx`: sacar `revision` de los fixtures y del cuerpo
      esperado; la aserción de `'Saved revision 5'` pasa a `'Saved'`.

## 6. Verificación

- [x] 6.1 `pnpm -r build && pnpm typecheck` — el build va antes; `web` y `api` consumen
      `@hs/contracts` por `dist`.
- [x] 6.2 `pnpm lint` y `pnpm test`.
- [x] 6.3 `pnpm --filter api test:int` — corre la migración contra Postgres real.
- [x] 6.4 En `pnpm dev`: abrir un borrador en dos pestañas, guardar en una y después en la
      otra. La segunda tiene que ganar sin error y el encabezado decir `Saved`. Ése es el
      cambio de comportamiento que se está comprando.
- [x] 6.5 `grep -rn revision` sobre `apps/` y `packages/` sin resultados fuera de las
      migraciones históricas 0016 y 0020, que no se reescriben.
