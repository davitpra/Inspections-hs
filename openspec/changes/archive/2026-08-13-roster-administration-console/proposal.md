## Why

El roster es la única entidad de primera clase del sistema que no se puede mirar. La etapa 2
construyó `person`, su RLS, su trigger de auditoría y la importación CSV, y dejó **toda**
corrección posterior en `psql`: un alta cargada en la planta equivocada, una transferencia
entre St. Thomas y Glencoe, un apellido mal tipeado, una baja. La importación no arregla
ninguna de ellas —la spec vigente dice *"Absence from the file never deactivates anybody"*—
así que quien se fue queda para siempre en el selector de sujeto de todo incidente y en el
paquete de campo de toda inspección, hasta que alguien mande un CSV con la fila exacta.

§6 le asigna al coordinador "Administra plantillas y roster", y hoy no puede ni **mirarlo**:
para saber si alguien está cargado, en qué planta, o si sigue activo, hay que abrir `psql`.
Este change resuelve solo eso —la lectura—, que es el escalón que bloquea todo lo demás:
sin ver el roster no se sabe siquiera si hay algo que corregir.

**Etapa de §7: ninguna.** La etapa 2 (Sitio, Persona, Usuario, auth, importación CSV del
roster) está cerrada y este change no la reabre. Se especificó alrededor de **cargar** el
roster —un CSV, una transacción, un registro permanente— y nunca alrededor de **mantenerlo**;
el hueco recién se volvió visible cuando las etapas 4-6 empezaron a consumir el roster en
selectores que nadie puede corregir.

**Una reversión deliberada, y se nombra.** El change archivado de los endpoints del paquete de
campo dice: *"No hay `GET /locations` ni `GET /people`: … Un endpoint de catálogo general es un
change distinto, con paginación, filtros y una pantalla de administración detrás."* Este es ese
change, y lo cumple, no lo pisa: trae los filtros y la pantalla. **No** trae paginación por
offset, y eso se argumenta en el design en vez de dejarlo pasar en silencio.

## What Changes

- `GET /people?site_id=&status=` — el roster de una planta, todas las columnas de `person`,
  **solo el coordinador**. Incluye a las personas dadas de baja, marcadas como tales.
- Pantalla `/roster` en la PWA, con conmutador de planta, filtro de estado y búsqueda por
  nombre o número de empleado. El link de navegación queda condicionado a `hs_coordinator`,
  como `/scheduling`.
- `personSchema` estrena su primer consumidor: está escrito desde la etapa 2 y no lo usa
  ningún endpoint.
- **Sin migración, sin tabla nueva, sin privilegio nuevo, sin tocar RLS.** El `GRANT SELECT`
  de `0005_identity.sql` y la política `hs_apply_site_isolation('person')` ya alcanzan.

Lo que **no** cambia, y es la mitad importante de la propuesta:

- **No se escribe `person` desde ningún endpoint.** No se corrige un nombre, no se
  transfiere de planta, no se da de baja y no se crea a nadie. El roster lo mantiene
  `pnpm roster:import`, que sigue siendo su fuente de verdad y la única.
- El selector de sujeto sigue devolviendo las cuatro columnas de `personOptionSchema`.
  `GET /scheduled-inspections/:id/roster` no se toca.
- Nunca DELETE.

Que el motor conceda `UPDATE (first_name, last_name, site_id, deactivated_at)` sobre
`person` no se aprovecha acá: esos privilegios existen para la importación. Abrir una ruta
de escritura obliga a decidir qué gana cuando el siguiente CSV pise el cambio, y esa
discusión es de otro change.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `identity`: un requisito nuevo sobre la **superficie HTTP** de `person` — listar el roster
  de una planta. No se modifica ningún requisito existente: los que ya están describen lo que
  el **motor** le impone a `person` (identidad inmutable, aislamiento por RLS, baja lógica),
  y este describe lo que la **API** expone. Las dos capas ya conviven así en la consola de
  programación.

## Impact

- **Contracts** — `packages/contracts/src/identity.ts`: se reusa `personSchema` y se agrega
  `rosterQuerySchema`. Ningún esquema de escritura, porque no hay ninguna ruta que escriba.
- **API** — módulo `roster` nuevo (`roster.module.ts`, `roster.controller.ts`,
  `roster.service.ts`, `roster.errors.ts`), junto al código del importador CSV que ya vive
  ahí. Registro en `app.module.ts`. Depende solo de `DbModule`: no agrega ninguna arista
  nueva entre módulos (ADR-008).
- **Web** — `api/roster.ts`, `routes/RosterRoute.tsx`, `routes/roster-presentation.ts`, y la
  ruta más el link en `app/router.tsx`.
- **Sin tocar** — esquema, migraciones, políticas RLS, privilegios, `packages/forms`, el
  service worker, el outbox y Dexie. La pantalla es ONLINE.
- **Se reusa** — `DbService.withSessionClient`, el patrón `requireCoordinator` de
  `inspections.service.ts`, el índice parcial `person_site_active_name_idx`, el componente
  `SitePicker` y la estructura de `SchedulingRoute`.
- **Riesgo principal: de spec, no técnico.** §4 R4 dice que se elige a una persona *"sin poder
  ver su perfil"*, y esta pantalla muestra el roster completo. El `design.md` argumenta por
  qué esa frase ata al selector del supervisor y no a la administración del coordinador; si
  ese argumento no se acepta, el change no se sostiene.
- **Seguimiento, fuera de alcance** — (a) el `PersonPicker` de `ReportIncidentRoute` sigue
  siendo un input de texto libre; necesita un endpoint con forma de `personOptionSchema`,
  **no** este, porque darle `GET /people` pondría la superficie del coordinador detrás de la
  pantalla de un supervisor. (b) Corregir el roster desde la pantalla —nombre, transferencia,
  baja— si la importación resulta no alcanzar.
