## 1. Contrato

- [x] 1.1 `packages/contracts/src/templates.ts`: agregar `key` y `latest_published_at` a
      `templateOptionSchema`, con el docblock de por qué la fecha sale de la MISMA fila que la
      versión y no de un `max(published_at)`.
- [x] 1.2 Extender el test de `templateOptionSchema` en `packages/contracts` a los dos campos.

## 2. API

- [x] 2.1 `apps/api/src/templates/templates.service.ts`: `list` suma `t.key` y el `published_at`
      del CTE. No tocar `published-version.sql.ts`: la versión se sigue resolviendo con la misma
      expresión que congela el planificador.
- [x] 2.2 Verificar que `LATEST_PUBLISHED_VERSION_CTE` ya expone `published_at`; si no, agregarlo
      ahí y comprobar que ningún otro consumidor del CTE se rompe.
- [x] 2.3 `apps/api/test/scheduling-console.int-spec.ts` (o donde viva el test de `list`): afirmar
      que `key` y `latest_published_at` corresponden a la versión más alta, con una plantilla de
      dos versiones.

## 3. Web

- [x] 3.1 `apps/web/src/routes/TemplatesRoute/PublishedTemplates.tsx`: la tarjeta con su
      encabezado, el conteo, el estado vacío y el estado de error/carga, siguiendo la forma de
      `drafts-card`.
- [x] 3.2 `apps/web/src/routes/TemplatesRoute/PublishedRow.tsx`: nombre, `key`, `Version N` y la
      fecha con `formatDay` de `src/presentation/dates.ts`.
- [x] 3.3 `TemplatesRoute/presentation.ts`: el orden por nombre, la etiqueta de versión y la de
      conteo, cada una con su caso en `presentation.test.ts`.
- [x] 3.4 `TemplatesRoute/TemplateDrafts.tsx`: montar el bloque debajo de los borradores, con su
      `useQuery` sobre `queryKeys.templates()` y `listTemplates`.
- [x] 3.5 Reescribir el docblock de `TemplatesRoute/index.tsx`, que todavía afirma que publicar
      «no existe ningún endpoint que lo haga», y revisar el `notice-card` de `TemplateDrafts.tsx`
      ahora que la pantalla muestra las dos poblaciones.
- [x] 3.6 `TemplatesRoute/index.test.tsx`: la plantilla publicada aparece, el borrador no aparece
      entre las publicadas, el estado vacío, y que publicar mueve la fila de un bloque al otro.

## 4. Cierre

- [x] 4.1 `pnpm -r build && pnpm typecheck && pnpm lint`, `pnpm test` y `pnpm --filter api test:int`.
- [x] 4.2 `openspec validate published-templates-in-console --strict`.
