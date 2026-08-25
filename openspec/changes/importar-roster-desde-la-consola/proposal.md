## Why

El coordinador administra el roster desde la consola —invita, reemite, quita acceso,
sienta gente en el JHSC— pero no puede **cargarlo**. El alta de una persona solo existe
como comando de servidor (`pnpm roster:import <archivo.csv>`), así que la pantalla que
muestra quién trabaja en la planta no tiene ninguna forma de arreglar que falte alguien:
hay que abrir una terminal con acceso a la base.

Lo que falta es la superficie HTTP, no el mecanismo. El importador ya está entero y
partido en dos mitades —el parseo puro y la transacción que aplica, registra y audita—, y
se escribió a propósito para que un endpoint lo llamara sin reescribir nada
(`apps/api/scripts/roster-import.mjs`).

Este change cierra la **etapa 2** de `docs/Requisitos_V1.2.md` §7 —«Sitio, Persona,
Usuario, auth, importación CSV del roster»—, que quedó completa en el motor y a medias en
el producto: la importación existe, pero solo la puede correr el desarrollador.

## What Changes

- Exponer la importación del roster como `POST /people/import`: un CSV subido como
  multipart, reservado al rol `hs_coordinator`, que reutiliza el importador existente sin
  cambiarle el comportamiento.
- Derivar el alcance de la importación de la **sesión** —los sitios de `user_site_scope`
  en ese request y la cuenta que actúa—, no de un alcance declarado por el llamador. El
  comando de servidor sigue funcionando igual.
- Devolver el reporte de la importación al cliente: filas leídas, aplicadas y rechazadas,
  y cada rechazo con su número de fila del archivo y su motivo.
- Añadir a la consola del roster un diálogo de subida que muestra ese reporte y refresca
  la tabla, y reescribir el aviso que hoy manda al coordinador a un CSV que no puede subir.
- Rechazar entero, y sin aplicar nada, el archivo que no se puede leer como CSV con
  encabezado; un archivo legible con filas malas NO es un error de la petición.

Fuera de alcance, explícito: dar de alta una persona de a una desde un formulario;
corregir un nombre, transferir de planta o dar de baja desde la pantalla; consultar
importaciones pasadas; y cualquier conexión con ADP (§6 pregunta cerrada 3 — el roster
entra por archivo, manual y controlado, nunca por sincronización).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `identity` — la importación del roster deja de ser solo un comando de servidor y pasa a
  tener superficie HTTP para el `hs_coordinator`, con el alcance tomado de la sesión; y la
  consola del roster deja de prohibir toda escritura sobre `person` para prohibir solo la
  escritura fila por fila.

## Impact

- **Sin migración.** `person`, `roster_import`, `roster_import_site` y
  `roster_import_rejection` ya existen con sus grants, sus políticas RLS y su trigger de
  auditoría. Ninguna tabla inmutable cambia de forma.
- `apps/api/src/roster/` — un endpoint nuevo en el controlador, un método en el servicio y
  la separación de `apply-roster.ts` en «la transacción» y «lo que corre dentro de ella»,
  para que el camino HTTP entre por `withSession` y el CLI siga entrando por
  `withSiteScope` (ADR-011).
- `apps/api/scripts/roster-import.mjs` — sigue siendo el mismo comando; solo cambia por
  dónde entra.
- `packages/contracts` — nada nuevo: `rosterImportReportSchema` ya describe la respuesta.
- `apps/web` — `api/roster.ts` gana la subida (la primera del cliente que manda
  `FormData`), y `routes/RosterRoute/` gana el diálogo y su lógica pura de reporte.
