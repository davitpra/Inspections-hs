## 1. Lo que el dispositivo sabe del paquete

- [x] 1.1 `apps/web/src/offline/prefetch.ts`: agregar `prefetchedAt(scheduledInspectionId, database?)`, que devuelve el `fetched_at` de la fila `template_version` o `null` si no hay fila. Documentar que es el sello que hace honesto el botón de refrescar — el campo se escribe desde que existe la tabla y hasta ahora nadie lo leía.
- [x] 1.2 `apps/web/src/offline/prefetch.ts`: agregar `packageDrift({ storedVersionId, frozenVersionId, draftVersionId })`, pura y sin acceso a Dexie, devolviendo `'none' | 'stale-package' | 'draft-orphaned'` (design D2, D3). `'none'` cuando falta cualquiera de los valores necesarios para decidir.
- [x] 1.3 `apps/web/src/offline/prefetch.test.ts`: `prefetchedAt` con fila y sin fila; `packageDrift` en sus cuatro entradas — alineado, información faltante, paquete rancio, borrador huérfano.
- [x] 1.4 `apps/web/src/offline/prefetch.test.ts`: una segunda descarga cuyo servidor devuelve otro `template_version_id` pisa el payload guardado. Hoy el único test de segunda descarga usa un servidor que devuelve la misma versión, así que la sobrescritura no está cubierta.

## 2. El control, en sus dos formas

- [x] 2.1 `apps/web/src/api/query-keys.ts`: clave nueva para el sello de la descarga, con la misma forma que el resto (prefijo cuando se la llama sin argumento).
- [x] 2.2 `apps/web/src/components/FieldPackage.tsx`: `DownloadForField` acepta la etiqueta y la clase del botón para poder dibujarse como `Refresh field package` sin duplicar la mutación (design D5).
- [x] 2.3 `apps/web/src/components/FieldPackage.tsx`: completar `onSettled` — además de `fieldReady(id)`, invalidar `storedTemplateVersion(id)`, la clave del sello y `draft(id)` (design D6). Sin esto la segunda descarga no se ve en pantalla.

## 3. La asignación destacada

- [x] 3.1 `apps/web/src/routes/InspectorHomeRoute/presentation.ts`: `AssignmentState` gana `showsRefresh`, verdadero cuando `readiness === 'ready'` — incluidos los casos con borrador `capturing` o `signed` (design D4). La acción primaria no cambia.
- [x] 3.2 `apps/web/src/routes/InspectorHomeRoute/presentation.ts`: los textos en inglés de los dos estados de deriva, en la tabla de etiquetas de la ruta y no en el componente.
- [x] 3.3 `apps/web/src/routes/InspectorHomeRoute/presentation.test.ts`: `showsRefresh` verdadero en `start`, `resume` y `open`; falso en `unknown` y en `not-ready`.
- [x] 3.4 `apps/web/src/routes/InspectorHomeRoute/AssignmentHero.tsx`: dibujar el control secundario cuando `decision.showsRefresh`, junto al CTA.
- [x] 3.5 `apps/web/src/routes/InspectorHomeRoute/AssignmentHero.tsx`: la fila "Template version" suma `Downloaded <instante>` con `formatInstant` de `src/presentation/dates.ts`, leyendo `prefetchedAt` por la clave de 2.1.
- [x] 3.6 `apps/web/src/routes/InspectorHomeRoute/AssignmentHero.tsx`: cuando `packageDrift` no es `'none'`, un `notice notice--warn` con el texto que corresponda. `frozenVersionId` sale del `PendingInspection` que la tarjeta ya recibe (design D1).
- [x] 3.7 `apps/web/src/routes/InspectorHomeRoute/index.test.tsx`: **actualizar** el caso `descarga y pasa a ofrecer el recorrido` — al quedar listo desaparece `Download for the field` y aparece `Refresh field package`.
- [x] 3.8 `apps/web/src/routes/InspectorHomeRoute/index.test.tsx`: casos nuevos — refrescar con el paquete completo vuelve a llamar a `prefetchInspection`; el aviso de deriva aparece cuando el `template_version_id` de la asignación no coincide con el guardado; con el paquete alineado no hay aviso.

## 4. La captura, sin el "Loading…" eterno

- [x] 4.1 `apps/web/src/routes/CaptureRoute/index.tsx`: separar "cargando" de "desajustado" comparando `row.template_version_id` contra el `template_version_id` del paquete guardado, leído de la caché compartida sin agregar red (design D7).
- [x] 4.2 `apps/web/src/routes/CaptureRoute/index.tsx`: la rama de desajuste nombra el problema, dice que hay que descartar el borrador y volver a empezar, y ofrece el control en su forma de refresco. Con el borrador en `signed` no ofrece descartar y dice que va camino al servidor y que el servidor lo va a rechazar.
- [x] 4.3 `apps/web/src/routes/CaptureRoute/index.test.tsx`: borrador congelado a una versión con el paquete guardado en otra — se lee el mensaje nombrado y no "Loading the inspection…"; el mismo caso con el borrador `signed` no ofrece descartar.

## 5. Cierre

- [x] 5.1 Reusar `button--outline`, `notice notice--warn` y `facts__hint` de `index.css`. Si hiciera falta una clase nueva, sin colores literales: `check-tokens.mjs` falla el build.
- [x] 5.2 `pnpm -r build` (antes que el typecheck), `pnpm typecheck`, `pnpm lint` y `pnpm test`.
- [ ] 5.3 Prueba manual con `pnpm dev`: descargar, confirmar `Refresh field package` y el sello en el héroe, refrescar y ver que el sello cambia; editar el `payload.template_version_id` de la fila `prefetch` desde IndexedDB y confirmar el aviso en la home y el mensaje nombrado en la captura.
