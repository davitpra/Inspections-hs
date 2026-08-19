## 1. El borrador como documento (`packages/forms`)

- [x] 1.1 Crear `packages/forms/src/document/draft.ts` con `templateDraftItemSchema`,
      `templateDraftSectionSchema` y `templateDraftDocumentSchema` (D3): misma unión discriminada por
      `response_type` y mismos `strictObject` de configuración que `schema.ts`, pero sin `position`, con
      `items` de largo cero permitido y con `prompt`/`section_title` vacíos permitidos. Reusar
      `ITEM_KEY_PATTERN`/`SECTION_KEY_PATTERN` de `keys.ts` y `choiceOptionSchema` de `schema.ts`; no
      duplicar ninguno de los dos.
- [x] 1.2 Agregar `emptyDraftDocument()` y `normalizeDraft(draft): TemplateDocument` — `position`
      1-based derivado del índice del arreglo, secciones y luego ítems dentro de cada sección (D4).
- [x] 1.3 Agregar `draftIssues(draft): DraftIssue[]` — corre
      `templateDocumentSchema.safeParse(normalizeDraft(draft))` y traduce cada issue de Zod a
      `{ path, message }` nombrando la sección o el ítem, en inglés. Sin reimplementar ninguna regla.
- [x] 1.4 Exportar los cuatro desde `packages/forms/src/index.ts`.
- [x] 1.5 `packages/forms/src/document/draft.test.ts`: normalización de posiciones tras mover y tras
      eliminar; un caso por familia de issue (sección sin ítems, prompt vacío, `item_key` inválida,
      `item_key` duplicada, `scale` con `min >= max`, `multi_choice` con `min_selected > max_selected`,
      opciones con `value` repetido); un draft completo sin issues; y el round-trip documento publicado →
      borrador → `normalizeDraft` idéntico al original.
- [x] 1.6 Verificar que el lint de ADR-007 sigue pasando sobre el paquete (`pnpm lint`): sin builtins
      de Node, sin reloj, sin azar.

## 2. Los contratos (`packages/contracts`)

- [x] 2.1 Re-exportar desde `packages/contracts/src/template-document.ts` los tipos y esquemas nuevos
      de `@hs/forms` (`templateDraftDocumentSchema`, `TemplateDraftDocument`, `DraftIssue`,
      `normalizeDraft`, `draftIssues`, `emptyDraftDocument`), en el mismo estilo de re-export puro que ya
      tiene el archivo.
- [x] 2.2 Agregar en `packages/contracts/src/templates.ts`, sin tocar `templateOptionSchema`:
      `templateDraftSummarySchema` (`id`, `key`, `name`, `updated_at`, `revision`, `publishable`),
      `templateDraftSchema` (lo anterior más `document` e `issues`), `createTemplateDraftSchema`
      (`key` con el patrón, `name`) y `saveTemplateDraftSchema` (`name`, `document`, `revision`). Todos
      `strictObject`.
- [x] 2.3 Actualizar el comentario de cabecera de `templates.ts`: hoy dice que la edición es la etapa
      8 y sigue fuera; ahora la primera mitad está adentro y la publicación no.

## 3. El esquema (`apps/api`) — migración con REVOKE/GRANT

- [x] 3.1 Escribir `apps/api/drizzle/0016_template_drafts.sql` creando `template_draft`
      (`id uuid PK`, `key text NOT NULL`, `name text NOT NULL`, `document jsonb NOT NULL`,
      `revision int NOT NULL DEFAULT 1`, `created_by uuid NOT NULL`, `created_at timestamptz NOT NULL`,
      `updated_at timestamptz NOT NULL`, `discarded_at timestamptz`), con `CHECK` del patrón de `key`
      copiando el regex que `0003` usa para `template.key`, y cabecera que declare explícitamente que
      **este change no toca ninguna tabla inmutable** (D1).
- [x] 3.2 Índice único parcial `template_draft_key_live_idx ON template_draft (key) WHERE
discarded_at IS NULL` (D2).
- [x] 3.3 Trigger `template_draft_forbid_deletion` (BEFORE DELETE) y
      `template_draft_forbid_truncate` (BEFORE TRUNCATE) sobre `hs_forbid_mutation()`. **No** llamar a
      `hs_make_immutable`.
- [x] 3.4 Privilegios explícitos en el formato de `0008` §8:
      `GRANT SELECT, INSERT ON template_draft TO hs_app;` y
      `GRANT UPDATE (name, document, revision, updated_at, discarded_at) ON template_draft TO hs_app;`,
      con el comentario de que `key` y `created_by` quedan fuera a propósito.
- [x] 3.5 **No** aplicar `hs_apply_site_isolation`, con el comentario de por qué: `template_draft` no
      lleva `site_id` por la misma razón que `template` no lo lleva (D1), y la autorización es por rol.
      Dejarlo escrito en la migración, no solo en el design.
- [x] 3.6 Espejo Drizzle a mano en `apps/api/src/db/schema/templates.ts`: `templateDraft` con
      `document: jsonb().$type<TemplateDraftDocument>()` y el tipo `TemplateDraft` exportado. Sin
      `drizzle-kit generate`.
- [x] 3.7 Correr `pnpm db:migrate` contra la base local y comprobar que `0016` aplica limpio.

## 4. La API (`apps/api/src/templates/`)

- [x] 4.1 Crear `templates.errors.ts` con el patrón de `roster.errors.ts` (código en el cuerpo, no
      solo en el status): `template_draft_forbidden` (403), `template_draft_not_found` (404),
      `template_draft_key_taken` (409), `template_draft_stale` (409).
- [x] 4.2 Crear `templates.repository.ts` con los cinco accesos, todos por `db.withSessionClient`
      (nunca `withSiteScope`, D6): `listDrafts`, `insertDraft`, `findDraft`, `updateDraft`,
      `discardDraft`. `updateDraft` hace
      `UPDATE ... SET revision = revision + 1 WHERE id = $1 AND revision = $2 AND discarded_at IS NULL`
      y devuelve la fila o nada.
- [x] 4.3 Agregar los cinco métodos a `templates.service.ts`, cada uno abriendo con la comprobación
      de rol `hs_coordinator` (D6). `createDraft` chequea la colisión de `key` contra `template.key` y
      contra otro borrador vivo antes de insertar. `saveDraft` parsea con `templateDraftDocumentSchema` y
      distingue stale de descartado con una lectura de seguimiento (D5). `publishable` e `issues` salen
      de `draftIssues`.
- [x] 4.4 Agregar al `templates.controller.ts` las cinco rutas —`GET /templates/drafts`,
      `POST /templates/drafts`, `GET /templates/drafts/:id`, `PUT /templates/drafts/:id`,
      `POST /templates/drafts/:id/discard`— parseando el cuerpo con los esquemas de contracts. Dejar
      `GET /templates` intacto y actualizar el comentario de cabecera del controller.
- [x] 4.5 Registrar el repository en `templates.module.ts` y actualizar su comentario (hoy dice que
      la publicación no vive en ningún endpoint, lo cual sigue siendo cierto y conviene que quede claro
      que sigue siéndolo).

## 5. La interfaz (`apps/web`)

- [x] 5.1 Crear `apps/web/src/api/templates.ts` con `listTemplateDrafts`, `createTemplateDraft`,
      `getTemplateDraft`, `saveTemplateDraft` y `discardTemplateDraft`, todas por `get`/`send` de
      `api/request.ts` con su `parse` obligatorio contra `@hs/contracts`. Agregar `templateDrafts()` y
      `templateDraft(id)` a `api/query-keys.ts`.
- [x] 5.2 Agregar `canAuthorTemplates` a `src/permissions/session.ts` como type predicate, junto a
      `canAdministerScheduling`, y su caso en `session.test.ts`.
- [x] 5.3 Crear `src/presentation/templates.ts` con `RESPONSE_TYPE_LABELS` (los nueve, en inglés) y
      el texto de estado de un borrador, más `templates.test.ts`.
- [x] 5.4 Crear `src/routes/TemplatesRoute/` — `index.tsx` (listado de borradores, estados de carga y
      error con `status-card` como el resto), `NewDraftForm.tsx` (key y name, mutación con el error
      inline), `DiscardDraftDialog.tsx` (`<dialog className="modal">` con `showModal()` en `useEffect`,
      colgado de un nodo que sobrevive a la invalidación), `presentation.ts` + test.
- [x] 5.5 Crear `src/routes/TemplateDraftRoute/edits.ts` con las operaciones puras (D7):
      `addSection`, `renameSection`, `moveSection`, `removeSection`, `addItem`, `moveItem`, `removeItem`,
      `changeResponseType`, `suggestItemKey`. Ninguna muta su entrada.
- [x] 5.6 `TemplateDraftRoute/edits.test.ts`: mover el primer elemento hacia arriba y el último hacia
      abajo no hacen nada; eliminar cierra el hueco; `changeResponseType` de `text` a `single_choice`
      deja `options` y ningún `max_length`, y de `number` a `yes_no` no deja `min`/`max`/`decimals`;
      `suggestItemKey` produce una key que pasa `ITEM_KEY_PATTERN`.
- [x] 5.7 Crear `TemplateDraftRoute/index.tsx` (carga el borrador, sostiene el documento en estado
      local, guarda con `revision` y muestra el `409` como aviso legible), `presentation.ts` + test
      (etiquetas, clases y el texto de cada issue), `SectionCard.tsx`, `ItemRow.tsx`,
      `ResponseTypeConfig.tsx` (los campos por tipo), `ChoiceOptionsEditor.tsx` y `PublishReadiness.tsx`
      (la lista de `draftIssues`, siempre visible y nunca bloqueante).
- [x] 5.8 Reordenamiento con botones subir/bajar en secciones e ítems, deshabilitados en los
      extremos, con `aria-label` que nombre el elemento que mueven.
- [x] 5.9 Registrar las dos rutas en `src/app/router.tsx` (`/templates` antes de
      `/templates/drafts/$id`), agregar la entrada de `NAV_ITEMS` con `visible: canAuthorTemplates` y los
      dos patrones en `TITLES` de `src/app/nav-items.ts`.
- [x] 5.10 Usar solo bloques y tokens existentes de `index.css`. Si hace falta una clase nueva,
      construirla sobre la capa semántica: `check-tokens.mjs` falla el build ante un color literal.

## 6. Tests

- [x] 6.1 `apps/web/src/routes/TemplatesRoute/index.test.tsx`: el listado solo se ofrece al
      coordinador; crear un borrador invalida la query; una `key` tomada muestra el error del servidor
      inline; descartar pide confirmación.
- [x] 6.2 `apps/web/src/routes/TemplateDraftRoute/index.test.tsx`: agregar sección e ítem, mover,
      cambiar el tipo de respuesta y ver los campos de configuración reemplazados, guardar llamando a
      `saveTemplateDraft` con el documento y el `revision` esperados, y un guardado stale mostrado como
      aviso sin perder lo editado.
- [x] 6.3 `apps/api/test/template-drafts.int-spec.ts` contra Postgres real: `DELETE` como `hs_app`
      falla por privilegio y como `hs_migrator` falla en el trigger; `UPDATE template_draft SET key`
      falla con `42501`; un guardado con `revision` viejo devuelve `template_draft_stale` sin pisar; un
      rol distinto de `hs_coordinator` recibe 403 en las cinco rutas; un borrador con una sección vacía
      se guarda y reporta `publishable: false`; una `key` de un borrador descartado se puede reusar.
- [x] 6.4 `pnpm -r build && pnpm typecheck && pnpm lint && pnpm test` en verde, en ese orden (el build
      va antes del typecheck).

## 8. El nombre como identidad (revisión posterior a la primera pasada)

- [x] 8.1 `0017_template_draft_name_identity.sql`: índice único parcial sobre
      `lower(btrim(name))` donde `discarded_at IS NULL`, con la cabecera que declare —otra vez— que
      no toca ninguna tabla inmutable, y el porqué de que el arreglo vaya sobre el nombre y no
      sobre la clave (D2).
- [x] 8.2 `apps/api/src/templates/template-key.ts` + `.spec.ts`: `templateKeyFromName`, pura, sin
      desempatar con sufijos y devolviendo `null` cuando el nombre no deja nada utilizable.
- [x] 8.3 `createTemplateDraftSchema` pierde `key`: crear una plantilla es un solo campo.
- [x] 8.4 `templates.errors.ts`: `template_draft_key_taken` pasa a `template_draft_name_taken`
      —con mensaje distinto para el caso de dos nombres que derivan a la misma clave— y se agrega
      `template_draft_name_unusable` (422).
- [x] 8.5 `templates.repository.ts`: `isNameTaken` / `isNameTakenByAnother` con la misma
      expresión `lower(btrim(...))` del índice, y `isDraftUniqueViolation` para traducir el `23505`
      de cualquiera de los dos índices parciales.
- [x] 8.6 `templates.service.ts`: `createDraft` deriva la clave y reporta toda colisión sobre el
      nombre; `saveDraft` comprueba la unicidad del nombre al renombrar y no toca la clave.
- [x] 8.7 `apps/web`: `NewDraftForm` queda con un solo campo, `presentation.ts` pierde
      `suggestTemplateKey`, y el editor muestra la clave de solo lectura en la cabecera.
- [x] 8.8 Tests: los del int-spec para derivación, unicidad de nombre insensible a mayúsculas,
      colisión de clave derivada, renombre que no mueve la clave; y los de las dos rutas.

## 7. Verificación end to end

- [x] 7.1 Con `pnpm setup && pnpm dev` y sesión de coordinador: `/templates` aparece en la
      navegación, y no aparece con otro rol.
- [x] 7.2 Crear un borrador, agregar dos secciones, mover la segunda arriba, agregar ítems de varios
      tipos, cambiar uno de `text` a `single_choice`, guardar, recargar y comprobar que el orden y la
      configuración quedaron tal cual.
- [x] 7.3 Abrir el mismo borrador en dos pestañas, guardar en una y después en la otra: la segunda
      rechaza con un mensaje legible y no pisa.
- [x] 7.4 Descartar el borrador y comprobar en la base que la fila sigue con `discarded_at` puesto.
- [x] 7.5 Comprobar que `GET /templates` y `/scheduling` siguen devolviendo lo mismo que antes: un
      borrador nunca aparece entre las plantillas programables.

Nota: 7.1–7.3 quedan pendientes de una sesión de coordinador. La base local tiene cuentas
reales, así que no se reseteó ninguna contraseña para entrar. Lo verificado sin sesión: las
seis rutas quedan mapeadas por Nest (`/templates` GET más las cinco de `/templates/drafts`) y
`/templates/drafts` responde 401 sin token, no 404. El resto del recorrido está cubierto por
`test/template-drafts.int-spec.ts` contra Postgres real y por los tests de las dos rutas.
