## 1. Migración

- [x] 1.1 Escribir `apps/api/drizzle/0025_publish_template_from_builder.sql` §1:
      `GRANT INSERT ON template, template_item, template_version, template_version_item TO hs_app`,
      con el comentario que cite §9 de `0003_template_model.sql` y diga por qué también va
      `template_version_item` (el trigger de proyección no es `SECURITY DEFINER`). Sin `UPDATE`,
      sin `DELETE`.
- [x] 1.2 §2: `ALTER TABLE template_draft` agrega `published_at timestamptz` y
      `template_version_id uuid REFERENCES template_version (id)`, con el CHECK de que van las
      dos o ninguna y el CHECK de que `discarded_at` y `published_at` no conviven.
- [x] 1.3 §3: reescribir entera la lista de `GRANT UPDATE` por columna sobre `template_draft`
      —`(name, document, updated_at, discarded_at, site_ids, published_at, template_version_id)`—
      siguiendo la convención de `0016` §4 → `0020` §4 → `0021` §2.
- [x] 1.4 §4: recrear `template_draft_key_live_idx` (`0016` §4) y `template_draft_name_live_idx`
      (`0017` §1) con `WHERE discarded_at IS NULL AND published_at IS NULL`.
- [x] 1.5 Reflejar las dos columnas a mano en `apps/api/src/db/schema/templates.ts`
      (`drizzle-kit generate` está prohibido, ADR-004).

## 2. Contratos

- [x] 2.1 En `packages/contracts/src/templates.ts`: `publishedTemplateSchema`
      (`template_id`, `template_version_id`, `version`) como respuesta de la publicación.
      Sin cuerpo de request: publicar es un `POST` sin datos, el borrador ya los tiene todos.
- [x] 2.2 Actualizar la cabecera del archivo, que hoy dice que la publicación queda fuera.
- [x] 2.3 Test de `packages/contracts` para el esquema nuevo, junto a los que ya hay.

## 3. API

- [x] 3.1 `templates.errors.ts`: agregar `template_draft_not_publishable` (409, con `issues` en
      el cuerpo), `template_key_taken` (409) y `template_item_key_taken` (409) a
      `TemplateDraftErrorCode`, con los constructores y el docblock de por qué cada uno es
      distinguible desde la pantalla.
- [x] 3.2 `templates.repository.ts`: `findDraft` y `findDrafts` suman `published_at IS NULL`;
      nuevas funciones `insertTemplate`, `registerItems`, `insertVersion` y `markDraftPublished`,
      más los predicados que traducen el `23505` de `template.key` y el de `template_item`.
- [x] 3.3 `templates.service.ts`: `publishDraft(session, id)` — rol, borrador vivo,
      `draftIssues` vacío, `templateDocumentSchema.parse(normalizeDraft(document))`, y las cuatro
      escrituras en **una** transacción. Usar `withSessionClient` (camino HTTP), nunca
      `withSiteScope`.
- [x] 3.4 `templates.controller.ts`: `POST drafts/:id/publish`, y corregir el docblock que hoy
      afirma que publicar no vive en ningún endpoint. Lo mismo en `templates.module.ts`.
- [x] 3.5 Verificar que la transacción de `DbService` envuelve las cuatro escrituras y que un
      rechazo tardío no deja `template` sin versión.

## 4. Web

- [x] 4.1 `apps/web/src/api/templates.ts`: `publishTemplateDraft(id)` contra
      `POST /templates/drafts/:id/publish`, parseando `publishedTemplateSchema`.
- [x] 4.2 `apps/web/src/permissions/session.ts`: `canPublishTemplates`, con su test —una función
      por decisión, aunque hoy devuelva lo mismo que `canAuthorTemplates`.
- [x] 4.3 `TemplateDraftRoute/PublishDialog.tsx`: la confirmación, modelada sobre
      `TemplatesRoute/DiscardDraftDialog.tsx`. Dice que una versión publicada no se edita y que
      este borrador se cierra; no insinúa un deshacer.
- [x] 4.4 `TemplateDraftRoute/DraftHeader.tsx`: el botón Publish al lado de Save, habilitado solo
      con el borrador guardado y sin issues. La lógica de habilitación y su etiqueta van a
      `presentation.ts` con su test (`publishButtonLabel`, `canPublish`).
- [x] 4.5 `TemplateDraftRoute/index.tsx`: la mutación, el diálogo montado desde la ruta, la
      invalidación de `templateDrafts()` **y** `templates()`, y la navegación a `/templates` al
      publicar.
- [x] 4.6 Reescribir el texto de `PublishReadiness.tsx` ("once publishing is available") y el
      `notice-card` de `TemplatesRoute/TemplateDrafts.tsx` ("not available yet").

## 5. Tests

- [x] 5.1 `apps/api/test/templates.int-spec.ts`: publicación completa (filas, proyección,
      `published_by`), borrador incompleto rechazado sin escribir nada, clave tomada,
      `item_key` tomada, atomicidad, borrador publicado que no se guarda ni se descarta ni se
      vuelve a publicar, rol no coordinador, y que la plantilla aparece en `GET /templates`.
- [x] 5.2 Test de integración de que un borrador publicado libera su nombre para uno nuevo.
- [x] 5.3 `apps/web/src/routes/TemplateDraftRoute/index.test.tsx`: el botón deshabilitado con
      issues o con cambios sin guardar, el diálogo, y la publicación exitosa.
- [x] 5.4 `presentation.test.ts` para las funciones puras nuevas.

## 6. Cierre

- [x] 6.1 `pnpm -r build && pnpm typecheck && pnpm lint`, `pnpm test` y
      `pnpm --filter api test:int`.
- [x] 6.2 `openspec validate publish-template-draft --strict`.
- [x] 6.3 Comprobar contra `openspec/specs/templates/spec.md` que ningún requisito que queda en
      pie contradice lo implementado, y dejar el change listo para `/opsx:archive`.
