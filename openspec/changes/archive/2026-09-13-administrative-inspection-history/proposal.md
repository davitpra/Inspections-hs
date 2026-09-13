## Why

La pantalla de historial y la de hallazgos ocultan las inspecciones completadas por otras
cuentas aunque `hs_coordinator` y `management` ya tienen acceso legítimo a los datos de sus
sitios asignados. Esto impide la revisión administrativa de la actividad realizada y deja la
interfaz por debajo del alcance de lectura que ya garantiza el servidor.

El cambio implementa la revisión administrativa de inspecciones completadas prevista en
requisitos-v1.2 §7, sin ampliar el alcance entre sitios ni incluir trabajo incompleto o drafts.

## What Changes

- Permitir que `hs_coordinator` y `management` vean todas las inspecciones completadas de los
  sitios incluidos en su alcance activo.
- Aplicar esa visibilidad administrativa en las pantallas `Historical inspections` y `Findings`.
- Mostrar en ambas pantallas el nombre del inspector que realizó cada inspección para las cuentas
  administrativas.
- Mantener para `jhsc_member` la visibilidad únicamente de sus inspecciones completadas.
- Mantener fuera del historial y hallazgos los drafts locales, períodos abiertos, vencidos y
  cancelados.
- Mantener el aislamiento por sitio existente mediante RLS; no conceder visibilidad global por rol.
- Mantener Home, pendientes personales y la matriz de inspecciones propias sin cambios.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections`: el historial de inspecciones completadas se vuelve sensible al rol y permite
  revisión administrativa dentro del alcance de sitios.
- `findings`: la pantalla de hallazgos derivados incluye inspecciones de otros inspectores para
  `hs_coordinator` y `management`, manteniendo la exclusión de inspecciones limpias.

## Impact

- Frontend: permisos, presentación y rutas `HistoricalInspectionsRoute` y `FindingsRoute`.
- Especificaciones y pruebas unitarias/de integración del comportamiento de lectura.
- No se requieren cambios en API, contratos, esquema, migraciones ni políticas RLS: el backend ya
  devuelve y autoriza los datos dentro del alcance de sitio de la sesión.
