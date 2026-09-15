## Context

`POST /incidents` ya valida todo lo que este change necesita
(`apps/api/src/incidents/incidents.service.ts`, `report`):

- `requireLocationSite` deduce el sitio de la ubicación.
- `requireReportablePerson` exige que la persona afectada y cada testigo estén activos y sean de
  ese sitio.
- La persona afectada no puede ser la persona de la cuenta que reporta.

Lo que falta es del lado de las opciones. `PersonPicker.tsx` y `LocationPicker.tsx` son
`<input>` de texto libre, y los testigos no tienen control en pantalla.

Piezas que ya existen y este change reusa:

- `personOptionSchema` (`packages/contracts/src/identity.ts`), un `strictObject` de cuatro
  campos. Ya lo usan `rosterPackageSchema` del paquete de campo, `incidentWitnessSchema` y
  `GET /findings/:id/roster`, que es el precedente directo: el mismo `SELECT` de cuatro
  columnas sobre `person` activo.
- `GET /locations`, protegido por `isAdministrator`, que devuelve las ubicaciones activas del
  alcance con su `site_id`. Los roles que reportan un incidente (`coordinator`, `management`)
  son exactamente los administrativos, así que la pantalla puede usarlo tal cual.
- `GET /sites`, más `SitePicker`, `activeSites` y `resolveSiteId` (`apps/web/src/presentation/sites.ts`).
- La RLS de `person` y `location` (`hs_apply_site_isolation`, migraciones 0004 y 0005).

## Goals / Non-Goals

**Goals:**

- Que lo que ofrece la pantalla sea lo que acepta el servidor, sin que el cliente vuelva a
  escribir la regla.
- Que la ruta nueva no entregue nada que `PersonOption` no tenga.

**Non-Goals:**

- Cambiar `POST /incidents`, su contrato o sus validaciones.
- Un selector de personas compartido entre rutas. `PersonPicker.tsx` explica por qué vive en la
  carpeta de esta ruta, y ese motivo sigue en pie (ver D5).
- Corregir la discrepancia de la spec vigente, que dice `role_not_allowed` para el `inspector`
  que reporta cuando el código responde `forbidden` (ver Riesgos).
- Paginación o búsqueda del lado del servidor.

## Decisions

### D1 — Una ruta propia, `GET /incident-roster?site_id=`, en el módulo de incidentes

Alternativas descartadas:

- **`GET /people`.** Devuelve `PersonWithAccount`, el perfil del roster con cuenta y estado.
  §4 lo prohíbe para quien elige a la persona afectada.
- **Un parámetro de "forma reducida" sobre `GET /people`.** Una misma ruta con dos formas de
  respuesta según un flag es justo la superficie que termina devolviendo la forma equivocada.
- **Una ruta genérica `GET /person-options` en `roster`.** La regla de quién la llama es la de
  quién puede reportar un incidente. Esa regla vive en `INCIDENT_TRANSITIONS`, y ponerla en
  otro módulo abre una segunda fuente de verdad. Es el mismo razonamiento que dejó
  `inspector-candidates` en `inspections`.

El path no cuelga de `incidents/`: `incidents/:id` ya está mapeado en el mismo controller, y
`incidents/roster` quedaría sujeto al orden de declaración. `site_id` va por query, con el mismo
formato que `inspector-candidates`, y se parsea con `z.uuid()`. Un valor inválido lo convierte
el filtro de Zod en `invalid_request`.

ADR-008: `incidents` ya lee `person` en `requireReportablePerson` y `personOf`, así que este
change no agrega ninguna dependencia entre módulos.

### D2 — El rol se toma de la fila `null → reported`, no de una lista escrita otra vez

El servicio comprueba `hasRole(incidentTransitionFor(null, 'reported')?.roles, session.role)`,
lo mismo que hace `report`, y rechaza con `incidentForbidden`. Si mañana la fila de creación
cambia de roles, la ruta cambia con ella. La lista de opciones y el permiso de reportar no
pueden separarse.

### D3 — Fuera del alcance, lista vacía; el límite es RLS

La consulta es la de `FindingsService.rosterPackage`:

```sql
SELECT id, employee_number, first_name, last_name FROM person
WHERE site_id = $1 AND deactivated_at IS NULL ORDER BY last_name, first_name
```

Corre dentro de `withSessionClient`. El `WHERE site_id` elige una planta entre las del alcance;
el límite de seguridad lo pone la política de `person` (ADR-004). Una planta ajena devuelve cero
filas.

No se agrega el chequeo explícito `session.siteIds.includes(...)` que sí tienen
`inspector-candidates` y `POST /people`:

- Aquellos lo necesitan porque leen `app_user`/`user_site_scope` (sin política) o porque
  escriben, y un RLS que aborta un INSERT se ve como un 500.
- Esta ruta **lee** una tabla con política. Es el mismo caso que `RosterService.list` (design
  D4 de `add-person-to-roster-by-hand`), donde la lista vacía es la respuesta correcta y no
  confirma si la planta existe.

La respuesta pasa por `incidentRosterSchema.parse` antes de salir. Si alguien agrega una columna
al `SELECT`, el `strictObject` falla en el servidor en vez de filtrar el dato.

### D4 — La cascada planta → ubicación → personas, con el estado en `index.tsx`

- **Planta.** `resolveSiteId(sites, session.siteScope, chosen)` decide la planta, y `SitePicker`
  la cambia. Con una sola planta activa, `SitePicker` ya se muestra como texto, que es el "sin
  preguntar" de la spec.
- **Ubicación.** `useQuery(queryKeys.catalogLocations())` con `listCatalogLocations`. Un `<select>` muestra solo `site_id === siteId`, ordenado por `name`
  como viene. No hace falta una ruta nueva: `GET /locations` ya devuelve solo las activas del
  alcance y ya es de las cuentas administrativas.
- **Personas.** `useQuery(queryKeys.incidentRoster(siteId))`, habilitada solo con `siteId !==
  ''`. Una sola lectura alimenta a los dos selectores.
- **Cambio de planta.** Un solo `setForm` que fija la planta y vacía `location_id`,
  `subject_person_id` y `witness_person_ids`. No se hace con un efecto que reacciona al cambio:
  un efecto así deja un render con la mezcla vieja y ese render puede enviarse.

`site_id` no viaja en el `POST`: el servidor lo sigue deduciendo de la ubicación. La planta es
estado de la pantalla, no del contrato.

### D5 — Buscador de persona afectada y lista de testigos, con la lógica en `presentation.ts`

Con más de 200 personas por planta, un `<select>` nativo sin búsqueda no es usable en un
teléfono. `PersonPicker` pasa a ser:

- Un `<input type="search">` que filtra.
- Una lista acotada de coincidencias como botones. Se muestran las primeras 20, con un aviso
  "Keep typing to narrow" si hay más.
- Con alguien elegido, una línea `EMP — First Last` y un botón "Change" para volver a buscar.

`WitnessPicker` usa el mismo buscador para agregar, y muestra los elegidos como una lista con
"Remove". Llegar a 20 esconde el buscador.

Funciones puras en `routes/ReportIncidentRoute/presentation.ts`, con su `.test.ts`:

- `personLabel(option)`: `"${employee_number} — ${first_name} ${last_name}"`.
- `matchPeople(options, query, limit)`: sin distinción de mayúsculas, sobre `employee_number`,
  `first_name`, `last_name` y el nombre completo en los dos órdenes. Consulta vacía, sin
  resultados.
- `subjectOptions(options, reporterPersonId)`: quita a la persona de la cuenta.
- `witnessOptions(options, subjectId, chosenIds)`: quita a la persona afectada y a los ya
  elegidos.
- `locationsOfSite(locations, siteId)`.
- El límite de 20 hoy es un literal (`.max(20)`) en `reportIncidentRequestSchema`. Este change
  lo exporta como `INCIDENT_WITNESS_MAX` desde contracts, el esquema lo usa y la pantalla lo
  importa, en vez de repetir el número.

Siguen en la carpeta de la ruta y no en `src/components/`. Suben el día que un segundo consumidor
exista (CLAUDE.md, "Rutas").

### D6 — No toca tablas inmutables ni el esquema

Este change no tiene migración y no escribe en ninguna tabla. Lee `person` y `location` con el
rol `hs_app` y sus políticas vigentes. ADR-002 no se toca.

## Risks / Trade-offs

- **[El filtro por nombre corre en el cliente sobre la lista entera de la planta]** → Con ~200
  personas son unos kilobytes y una sola lectura por planta. Si el roster creciera un orden de
  magnitud, pasa a búsqueda por query sin cambiar la forma de la respuesta.
- **[La lista puede quedar vieja si alguien da de baja a una persona mientras el formulario está
  abierto]** → El servidor rechaza con `person_not_active` y la pantalla ya muestra el mensaje.
  No se agrega invalidación en tiempo real.
- **[`GET /locations` es del catálogo, no de incidentes]** → Si un día un rol no administrativo
  pudiera reportar, esa ruta lo rechazaría y la pantalla quedaría sin ubicaciones. Hoy los roles
  coinciden por definición: se deja un comentario en `index.tsx` que lo diga y cite la fila de
  `INCIDENT_TRANSITIONS`.
- **[Discrepancia `role_not_allowed` / `forbidden` en la spec vigente]** → La ruta nueva usa el
  código que el módulo realmente responde (`forbidden`). Alinear el requisito "An incident is
  reported in the third person…" con el código es un arreglo de spec aparte, fuera de este change.

## Migration Plan

Sin migración de datos ni de esquema. El despliegue es el de siempre, API y PWA juntas.

- Si la PWA vieja habla con la API nueva, sigue mostrando los campos de texto: la ruta nueva no
  la afecta.
- Si la PWA nueva habla con la API vieja, la lista de personas falla con 404 y la pantalla
  muestra el error de la consulta.

Revertir es volver a desplegar la versión anterior.
