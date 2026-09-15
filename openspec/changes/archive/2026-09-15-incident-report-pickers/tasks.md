## 1. Contratos

- [x] 1.1 En `packages/contracts/src/incidents.ts`, exportar `INCIDENT_WITNESS_MAX = 20` y usarlo
  en `witness_person_ids: z.array(z.uuid()).max(INCIDENT_WITNESS_MAX)` (design D5).
- [x] 1.2 Agregar `incidentRosterSchema = z.array(personOptionSchema)` y su tipo
  `IncidentRoster`, con un docblock que cite §4 y el requisito "The subject and the witnesses are
  chosen without seeing a profile".
- [x] 1.3 Test en `packages/contracts/src/incidents.test.ts`: `incidentRosterSchema` acepta cuatro
  campos, rechaza una entrada con `site_id` o `deactivated_at` de más, y
  `reportIncidentRequestSchema` rechaza 21 testigos.

## 2. API — `GET /incident-roster`

- [x] 2.1 `IncidentsService.roster(session, siteId)` en
  `apps/api/src/incidents/incidents.service.ts`: comprueba el rol con
  `hasRole(incidentTransitionFor(null, 'reported')?.roles, session.role)` y rechaza con
  `incidentForbidden` (design D2). Dentro de `withSessionClient`, corre el `SELECT` de cuatro
  columnas sobre `person` activo de `site_id`, ordenado por `last_name, first_name` (design D3),
  y devuelve `incidentRosterSchema.parse(rows)`. Sin chequeo manual de `session.siteIds`.
- [x] 2.2 En `apps/api/src/incidents/incidents.controller.ts`, `@Get('incident-roster')` con
  `@Query('site_id')` parseado por `z.uuid()`, y un docblock que explique por qué el path no
  cuelga de `incidents/` (design D1).
- [x] 2.3 Confirmar que `cors.spec.ts` sigue verde sin tocar `CORS_METHODS` (es un `GET`).

## 3. API — integración

- [x] 3.1 En `apps/api/test/incidents.int-spec.ts`, un `describe('GET /incident-roster')` que
  cubra:
  - a) forma estricta de cuatro campos;
  - b) una persona dada de baja no aparece;
  - c) orden `Boivin, Adam` / `Boivin, Alex` / `Wu, Chen`;
  - d) un coordinador con dos plantas recibe solo la pedida;
  - e) `management` con una sola planta recibe `[]` para la otra;
  - f) `inspector` rechazado con `forbidden`.
- [x] 3.2 Caso "lo que ofrece, lo acepta": tomar la persona afectada y un testigo de la
  respuesta de `roster` y reportar con ellos en una ubicación activa del sitio. El incidente se
  crea.
- [x] 3.3 `site_id` ausente o no UUID responde `invalid_request`. Probarlo contra el parseo del
  controller o en el test unitario del controller si la suite de integración no pasa por HTTP.

## 4. Web — cliente y claves

- [x] 4.1 `listIncidentRoster(siteId)` en `apps/web/src/api/incidents.ts`, con
  `encodeURIComponent` como `listInspectorCandidates`, parseando con `incidentRosterSchema`.
- [x] 4.2 `incidentRoster: (siteId?: string) => key('incident-roster', siteId)` en
  `apps/web/src/api/query-keys.ts`.

## 5. Web — lógica pura de la ruta

- [x] 5.1 Crear `apps/web/src/routes/ReportIncidentRoute/presentation.ts` con `personLabel`,
  `matchPeople`, `subjectOptions`, `witnessOptions` y `locationsOfSite` (design D5).
- [x] 5.2 `presentation.test.ts`:
  - `matchPeople` encuentra por `1002`, por `raman`, por `Priya Raman` y por `Raman Priya`, sin
    distinguir mayúsculas;
  - una consulta vacía no devuelve nada, y respeta el límite;
  - `subjectOptions` quita al reportante;
  - `witnessOptions` quita a la persona afectada y a los ya elegidos;
  - `locationsOfSite` filtra por planta.

## 6. Web — componentes

- [x] 6.1 Reescribir `PersonPicker.tsx`: props `options`, `value`, `onChange`. Buscador,
  coincidencias como botones (hasta 20, con "Keep typing to narrow" si hay más), elegido
  mostrado con `personLabel` y "Change". Actualizar el docblock: deja de ser placeholder y
  conserva por qué no se conecta a `GET /people` ni sube a `src/components/`.
- [x] 6.2 Crear `WitnessPicker.tsx`: props `options`, `value: string[]`, `onChange`. Reusa el
  buscador de `PersonPicker` o su subcomponente de búsqueda, sin duplicarlo. Muestra la lista con
  "Remove" y esconde el buscador al llegar a `INCIDENT_WITNESS_MAX`.
- [x] 6.3 Reescribir `LocationPicker.tsx` como `<select>` sobre `locationsOfSite`, con una opción
  vacía "Choose a location". Actualizar el docblock.

## 7. Web — composición de `/incidents/report`

- [x] 7.1 En `index.tsx`, leer `listSites` y `listCatalogLocations` con sus claves existentes, y
  resolver la planta con `resolveSiteId(sites, account.siteScope, chosen)`. Mostrar `SitePicker`,
  que degrada a texto con una sola planta.
- [x] 7.2 El cambio de planta es un único `setForm` que vacía `location_id`,
  `subject_person_id` y `witness_person_ids` (design D4, sin efecto).
- [x] 7.3 `useQuery(queryKeys.incidentRoster(siteId))` con `enabled: siteId !== ''`, pasando
  `subjectOptions(data, account.personId)` a `PersonPicker` y
  `witnessOptions(data, subject, witnesses)` a `WitnessPicker`. Al elegir una persona afectada
  que ya estaba como testigo, sacarla de `witness_person_ids`. Mostrar el estado de carga y el
  error de cada consulta.
- [x] 7.4 Comentario en `index.tsx` que diga que `GET /locations` sirve porque los roles que
  reportan son los administrativos (fila `null → reported`) y qué pasa si eso cambia (design,
  Riesgos).
- [x] 7.5 Crear `apps/web/src/routes/ReportIncidentRoute/index.test.tsx`, con la API mockeada
  como en las demás rutas:
  - una sola planta queda fija;
  - con dos plantas, cambiar vacía ubicación, persona afectada y testigos;
  - el reportante no aparece como persona afectada;
  - la persona afectada no aparece como testigo;
  - el envío lleva los `location_id`, `subject_person_id` y `witness_person_ids` elegidos;
  - un `inspector` sigue viendo el aviso y no el formulario.

## 8. Documentación

- [x] 8.1 En `README.md`, quitar el apartado "Elegir a una persona en el reporte de incidente"
  de "Lo que todavía no tiene UI", y actualizar la fila `/incidents/report` de "Las pantallas"
  si hace falta.
- [x] 8.2 Revisar que ningún otro docblock siga describiendo `PersonPicker` o `LocationPicker`
  como placeholder: `grep -rn "Placeholder\|campo de id" apps/web/src/routes/ReportIncidentRoute`.
