## Why

`/incidents/report` no se puede completar sin conocer UUIDs de memoria. El selector de persona
afectada es un `<input>` de texto libre que dice "Employee number or name", pero
`reportIncidentRequestSchema` exige `subject_person_id: z.uuid()`. `LocationPicker` es el mismo
placeholder para `location_id`, y los testigos (`witness_person_ids`) no tienen control en
pantalla. El servidor ya valida todo lo que importa —persona activa, del mismo sitio que la
ubicación, distinta de quien reporta—, así que lo que falta es ofrecer las opciones.

El requisito "The subject and the witnesses are chosen without seeing a profile" ya pide
un selector con `PersonOption`, pero ninguna ruta lo sirve. `GET /people` no sirve: devuelve el
perfil completo del roster, y §4 dice que quien reporta elige a la persona **sin ver su perfil**.
La métrica de §1 "Incidentes bloqueados por roster desactualizado: 0" no se puede medir mientras
la pantalla falle antes del roster.

No cierra una etapa nueva de §7: **termina la etapa 6 (R4 completo)**. La etapa se archivó con
el servidor terminado y los dos selectores como placeholder, y R4 no se puede recorrer de punta
a punta sin ellos. Es el primer bloqueante para producción.

## What Changes

- Nueva ruta `GET /incident-roster?site_id=<uuid>`. Devuelve el subconjunto **activo** del
  roster de esa planta como `PersonOption[]` (`id`, `employee_number`, `first_name`,
  `last_name`), en orden de apellido y nombre. La pueden llamar los mismos roles que reportan:
  la fila `null → reported` de `INCIDENT_TRANSITIONS`, hoy `coordinator` y `management`. Un
  `inspector` recibe `role_not_allowed`. El aislamiento lo aplica la RLS de `person`: una planta
  fuera del alcance devuelve una lista vacía.
- Contratos: `incidentRosterSchema` (`z.array(personOptionSchema)`) en
  `packages/contracts/src/incidents.ts`. Cualquier campo de más en la respuesta lo rechaza el
  `strictObject`.
- `/incidents/report` arma el formulario en cascada: **planta → ubicación → persona afectada y
  testigos**.
  - La planta se elige con `SitePicker` entre las activas del alcance (`GET /sites`).
  - La ubicación es un desplegable con las activas de esa planta (`GET /locations`, que ya
    sirve a las dos cuentas administrativas).
  - La persona afectada se elige con un buscador por número de empleado o nombre.
  - Los testigos se eligen del mismo roster, sin repetir a la persona afectada y con un máximo
    de 20.
  - Cambiar de planta vacía ubicación, persona y testigos: las tres dependen de la planta y el
    servidor rechazaría una mezcla.
- El selector de persona afectada no ofrece a la persona de la propia cuenta
  (`session.personId`). El servidor ya lo rechaza con `first_person_report_not_supported`;
  ofrecerlo sería mostrar una opción que siempre falla.
- Se borran del README ("Lo que todavía no tiene UI") y de los docblocks de `PersonPicker` y
  `LocationPicker` las notas de placeholder.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `incidents`:
  - "The subject and the witnesses are chosen without seeing a profile" pasa a nombrar la ruta,
    el parámetro `site_id`, los roles que la llaman, el orden y el comportamiento fuera del
    alcance.
  - Se agrega un requisito de pantalla: el formulario de reporte elige planta, ubicación,
    persona afectada y testigos de listas, nunca de identificadores escritos a mano.

## Impact

- `packages/contracts/src/incidents.ts`: `incidentRosterSchema` y su test.
- `apps/api/src/incidents/incidents.controller.ts` e `incidents.service.ts`: `GET
  /incident-roster`.
- `apps/api/test/incidents.int-spec.ts`: forma estricta, solo activas, planta fuera del
  alcance, `inspector` rechazado y coincidencia con lo que acepta `POST /incidents`.
- `apps/web/src/api/incidents.ts` (`listIncidentRoster`) y `apps/web/src/api/query-keys.ts`
  (`incidentRoster`).
- `apps/web/src/routes/ReportIncidentRoute/`: `index.tsx`, `PersonPicker.tsx`,
  `LocationPicker.tsx`, `WitnessPicker.tsx` (nuevo), `presentation.ts` + `presentation.test.ts`
  (nuevos) e `index.test.tsx` (nuevo).
- `README.md`, sección "Lo que todavía no tiene UI".
- **Sin migración ni cambio de esquema.** Solo lee `person` y `location` y no escribe en
  ninguna tabla nueva. `POST /incidents` no cambia.
