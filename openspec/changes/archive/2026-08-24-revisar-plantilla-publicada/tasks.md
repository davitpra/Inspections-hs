# Tasks — Revisar una plantilla publicada

## 1. Migración

- [x] 1.1 `apps/api/drizzle/0028_revise_published_template.sql` — `template_draft.template_id`
      uuid con `REFERENCES template (id)`, nullable, sin default y fuera del `GRANT UPDATE`
      (write-once por omisión).
- [x] 1.2 En la misma migración: `template_draft_revision_live_idx`, único parcial sobre
      `(template_id)` con `WHERE template_id IS NOT NULL AND discarded_at IS NULL AND
      published_at IS NULL`.
- [x] 1.3 En la misma migración: recrear `template_draft_key_live_idx` y
      `template_draft_name_live_idx` agregando `AND template_id IS NULL`, con el comentario de
      por qué un borrador de revisión lleva a propósito la clave y el nombre de su plantilla.
- [x] 1.4 `apps/api/drizzle/meta/_journal.json` — la entrada de 0026.
- [x] 1.5 `apps/api/src/db/schema/templates.ts` — espejo a mano de la columna nueva
      (`drizzle-kit generate` está prohibido).

## 2. Motor de formularios

- [x] 2.1 `packages/forms/src/document/draft.ts` — `draftFromDocument(document:
      TemplateDocument): TemplateDraftDocument`, la inversa de `normalizeDraft`: saca
      `position` de cada sección y de cada ítem y no toca nada más. Pura (ADR-007).
- [x] 2.2 `packages/forms/src/document/draft.test.ts` — ida y vuelta:
      `draftFromDocument(normalizeDraft(d))` devuelve `d`, y el resultado parsea contra
      `templateDraftDocumentSchema`.

## 3. Contratos

- [x] 3.1 `packages/contracts/src/template-document.ts` — re-exportar `draftFromDocument`.
- [x] 3.2 `packages/contracts/src/templates.ts` — `templateDraftSummarySchema` gana
      `template_id: z.uuid().nullable()` y `next_version: z.int().positive()`, con el
      comentario de que el segundo es una lectura y no una reserva.

## 4. API

- [x] 4.1 `apps/api/src/templates/templates.errors.ts` — `template_not_found` (404),
      `template_item_deactivated` (409, lleva las claves), `template_draft_name_locked` (409).
- [x] 4.2 `apps/api/src/templates/templates.repository.ts` — `template_id` en
      `DRAFT_COLUMNS`/`TemplateDraftRecord` y `next_version` derivado por LATERAL en
      `findDraft`/`findDrafts`; `insertDraft` acepta `templateId`; `findTemplateForRevision`
      (plantilla activa + última versión); `findLiveRevisionDraft`; `classifyItemKeys`;
      `insertVersion` pasa a `coalesce(max(version), 0) + 1`; `isNameTaken` /
      `isNameTakenByAnother` ignoran los borradores de revisión.
- [x] 4.3 `apps/api/src/templates/templates.service.ts` — `reviseTemplate(session, templateId)`
      idempotente; `publishDraft` con la rama de revisión (sin `insertTemplate`, registrando
      solo lo nuevo); `saveDraft` rechaza el renombre de una revisión.
- [x] 4.4 `apps/api/src/templates/templates.controller.ts` —
      `POST /templates/:templateId/revisions`.

## 5. Web

- [x] 5.1 `apps/web/src/api/templates.ts` — `reviseTemplate(templateId)`.
- [x] 5.2 `apps/web/src/routes/PublishedTemplateRoute/` — botón «Revise» en `VersionHeader`
      (solo coordinador), su mutación y la navegación al borrador.
- [x] 5.3 `apps/web/src/routes/TemplateDraftRoute/TemplateIdentity.tsx` — nombre de solo
      lectura cuando el borrador es una revisión, junto a la clave.
- [x] 5.4 `apps/web/src/routes/TemplateDraftRoute/PublishDialog.tsx` — «This creates version N».
- [x] 5.5 `apps/web/src/routes/TemplateDraftRoute/DraftHeader.tsx` — decir qué plantilla se
      está revisando.
- [x] 5.6 `apps/web/src/routes/TemplatesRoute/` — el listado de borradores distingue una
      revisión de una plantilla nueva.

## 6. Tests

- [x] 6.1 `apps/api/test/template-revisions.int-spec.ts` (archivo propio, no dentro de
      `template-drafts.int-spec.ts`: el sujeto es otro) — sembrado, idempotencia, segunda
      revisión rechazada por el índice, publicación como versión 2, `item_key` conservado con
      `id` de fila nuevo, registro de solo lo nuevo, clave de otra plantilla, clave
      desactivada, pregunta omitida sin desactivar, renombre rechazado, rol.
- [x] 6.2 `packages/forms/src/document/draft.test.ts` — `draftFromDocument` es la inversa de
      `normalizeDraft`.
- [x] 6.3 Web: `PublishedTemplateRoute/index.test.tsx`, `TemplateDraftRoute/index.test.tsx`,
      `TemplatesRoute/presentation.test.ts`.

## 7. Cierre

- [x] 7.1 `pnpm -r build && pnpm typecheck && pnpm lint && pnpm test`.
- [x] 7.2 `pnpm --filter api exec vitest run --config vitest.integration.config.mts
      test/template-revisions.int-spec.ts` — 19/19. `template-drafts.int-spec.ts` sigue verde.
- [x] 7.2b `pnpm --filter api test:int` completa — 26 archivos, 796 tests, en verde con la
      0028 y la 0029 aplicadas juntas.
- [x] 7.3 `/opsx:archive`.
