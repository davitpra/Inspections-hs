## 1. La fecha de cierre en el contrato y en la consulta

- [x] 1.1 Añadir `inspection_id` (`z.uuid().nullable()`) y `completed_at`
      (`z.iso.datetime({ offset: true }).nullable()`) a `scheduledInspectionSchema` en
      `packages/contracts/src/inspections.ts`, con el comentario que diga que `completed_at`
      es `signed_at` —reloj del dispositivo, el mismo que `compliance.sql.ts` llama
      `occurred_at`— y no `received_at`.
- [x] 1.2 Proyectar `insp.id AS inspection_id` e `insp.signed_at AS completed_at` en
      `SCHEDULED_SELECT`, y mapearlos en la interfaz de fila y en `toScheduled`
      (`apps/api/src/inspections/inspections.service.ts`). El `LEFT JOIN inspection insp` ya
      está; no se agrega ni un JOIN ni un `WHERE site_id`.
- [x] 1.3 Cubrir en el test de integración que un período con envío trae `completed_at` con el
      `signed_at` del envío y no con su `received_at`, y que uno sin envío trae los dos nulos.
- [x] 1.4 `pnpm -r build` antes de seguir: `apps/web` no tipa hasta que `@hs/contracts` compile.

## 2. La fecha corta en pantalla

- [x] 2.1 `formatCivilDay(instant)` en `apps/web/src/presentation/dates.ts` — el día civil del
      instante en `SITE_TIME_ZONE`, escrito `Jul 29, 2027` con `MONTH_NAMES`. Reutiliza el
      `civilDate` privado que ya está; sin locale y sin `Intl` para el formato, igual que el
      resto del archivo.
- [x] 2.2 Tests en `dates.test.ts`, incluido el borde de huso: un instante UTC que cae el día
      anterior en Ontario se fecha en el día de Ontario.

## 3. Las bajas en la pantalla de inicio

- [x] 3.1 Sacar de `PendingRoute/index.tsx` el `<h2>The rest of {year}</h2>`, el bloque
      `.calendar-toolbar` entero, los estados `view` y `chosenYear`, `entries`/`gridEntries`,
      el `useQueries` de `readinessOf`, `stats` y la `.stats-bar`.
- [x] 3.2 Las dos listas de borradores pasan a `grid--list` fijo — hoy dependen del toggle que
      se fue.
- [x] 3.3 Borrar `PendingRoute/PendingRow.tsx`: su único consumidor era esa grilla.
- [x] 3.4 Borrar de `presentation.ts` lo que queda sin uso —`initialYear`,
      `earliestPendingYear`, `pendingOfYear`, `pendingStats`, `PendingStats`,
      `pendingCardClass`— y sus `describe` en `presentation.test.ts`. `draftCardClass` y
      `draftPillClass` se quedan: los usa `DraftRow.tsx`.

## 4. Las dos tarjetas

- [x] 4.1 `availabilityLabel(periodStart)` en `presentation.ts` → `Opens September 1`, con test.
- [x] 4.2 `completedInspections(scheduled, userId)` en `presentation.ts` — lo que hoy hace
      `recentCompleted` sin el `limit`; `recentCompleted` pasa a ser
      `completedInspections(...).slice(0, limit)`. Tests para los dos.
- [x] 4.3 `NextAssignment.tsx` — `.card` con la píldora `status-pill--ready` ("Upcoming"), la
      tira `.facts` de cuatro ítems (Month / Site / Inspector con `displayName(account)` /
      Availability) y el `<Link>` ancho a `/inspections/$id/capture?preview=1`. Devuelve `null`
      sin próxima asignación.
- [x] 4.4 Reescribir `RecentInspections.tsx` como tabla `.table` dentro de un `.card`: Month ·
      Site · Status · Completed on (`formatCivilDay`, `—` si no hay `completed_at`) · Actions.
      Pie con `<Link to="/inspections/past">`.
- [x] 4.5 "View report" se dibuja **inerte**: `<button type="button" disabled>` con
      `ExternalLinkIcon` y un texto accesible que diga que el reporte todavía no está. No un
      `<a>`: un link que no navega es una promesa rota.
- [x] 4.6 Quitar de `NoAssignment.tsx` su bloque "Next assignment" y el prop `next`.
- [x] 4.7 Componer en `index.tsx`: héroe (o `NoAssignment`) → `NextAssignment` →
      `RecentInspections` → borradores → enviados. `RecentInspections` sale del
      `.assignment__aside`, que queda con "Before you begin" y "Site information".
- [x] 4.8 `ExternalLinkIcon` en `components/icons.tsx`; `.list__action--block` en `index.css`
      (`width: 100%`, contenido centrado). Las flechas "→" son texto, como en `.year-nav__arrow`.

## 5. La vista previa

- [x] 5.1 `validateSearch: z.object({ preview: z.literal('1').optional() })` en `captureRoute`
      (`apps/web/src/app/router.tsx`).
- [x] 5.2 Exponer `getTemplateVersionPackage(id)` en `apps/web/src/api/inspections.ts` sobre el
      `GET /scheduled-inspections/:id/template-version` que ya existe, parseando con
      `templateVersionPackageSchema`; su clave en `query-keys.ts`.
- [x] 5.3 `CaptureRoute/Preview.tsx` — documento desde `storedTemplateVersion(id)` y, si no
      está, por red. Recorre `sectionsInDocumentOrder` **sin filtrar por visibilidad** y reusa
      `ItemRow` con `readOnly` y callbacks no-op. Encabezado que diga que es una vista previa y
      que no se está capturando nada; sin documento ni red, lo dice y ofrece volver.
- [x] 5.4 En `CaptureRoute/index.tsx`, cortar con `if (preview === '1') return <Preview .../>`
      **antes** de la consulta de `missing`, de `findDraft` y de `openDraft`. Ese orden es la
      garantía, no un detalle.
- [x] 5.5 Test: abrir la ruta con `?preview=1` presenta las preguntas y **no deja una fila en
      `drafts`**. Es la aserción que protege ADR-001.

## 6. La pantalla de lo completado

- [x] 6.1 `apps/web/src/routes/PastInspectionsRoute/` con `index.tsx` e `index.test.tsx`. **Sin
      `presentation.ts`**: la ruta no tiene lógica pura propia. `completedInspections` la
      comparte con la pantalla de inicio, así que —por CLAUDE.md, lo que cruza rutas y no es un
      componente sale de `routes/`— vive en `src/presentation/inspections.ts` con su test, y
      `recentCompleted` se fue con ella. La tabla, que sí es un componente compartido, subió a
      `src/components/CompletedInspectionsTable.tsx`.
- [x] 6.2 Lee con `listScheduled` y la MISMA `queryKey` que `PendingRoute`, así comparte caché;
      `retry: false` y su aviso, porque la lista es de servidor.
- [x] 6.3 Registrar `/inspections/past` en `router.tsx`. No entra a `WIDE_ROUTES` ni a la barra
      de navegación: se llega desde el pie de "Recent inspections".

## 7. Verificación

- [x] 7.1 `pnpm -r build && pnpm typecheck && pnpm lint && pnpm test`.
- [x] 7.2 `pnpm --filter api test:int` por el cambio de 1.2.
- [x] 7.3 Los cuatro `describe` de `PendingRoute/index.test.tsx` pasan **sin editar el
      archivo**: si alguno cae, el reemplazo se llevó puesto algo del héroe.
- [x] 7.4 A mano: mes asignado → héroe + las dos tarjetas; sin asignación → `NoAssignment` sin
      su bloque duplicado; "View assignment details" sobre un mes futuro no descargado → se ven
      las preguntas y al volver sigue diciendo "Needs downloading"; "View all past inspections"
      → la tabla completa.
