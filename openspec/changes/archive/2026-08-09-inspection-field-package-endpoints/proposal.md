## Why

`offline-inspection-capture` construyó el dispositivo entero: la PWA baja el paquete de
campo, guarda el borrador, sube las fotos y encola el envío. Lo que no existe es el otro
lado de la descarga previa. `prefetchInspection()` pide tres rutas —
`/scheduled-inspections/:id/template-version`, `/locations` y `/roster`— y las tres
devuelven 404 hoy.

La consecuencia no es una funcionalidad incompleta, es un dispositivo que no arranca:
sin el paquete de campo ninguna inspección queda lista, sin inspección lista no hay
captura, y sin captura no hay nada que ingerir. Es el bloqueo que está delante de todo
lo demás de la etapa 3, incluido el recorrido manual en Chrome (`9.3`) que ese change
dejó sin marcar.

Este change continúa la **etapa 3** de `docs/Requisitos_V1.2.md` §7 y no la cierra: la
ingesta idempotente sigue siendo `submission-ingestion-endpoint`, que es lo único que
queda entre el estado actual y el spike 1 completo.

## Lo que este change NO es

**No es una API de plantillas, ni de catálogo, ni de roster.** No hay `GET /locations` ni
`GET /people`: las tres rutas cuelgan de una inspección programada y devuelven lo que
*esa* inspección necesita. Un endpoint de catálogo general es un change distinto, con
paginación, filtros y una pantalla de administración detrás, y ninguna de esas tres cosas
hace falta para salir a recorrer.

Tampoco cambia qué es una versión publicada, qué es una ubicación ni qué es una persona.
`templates`, `catalog` e `identity` ya lo definen; acá solo se leen.

## What Changes

- **`GET /scheduled-inspections/:id/template-version`** — el documento congelado de la
  `template_version` a la que la inspección está atada, servido tal cual desde la columna
  `document`. Devuelve además `site_id`, `template_version_id` y `version`. **La versión
  sale de la inspección y nunca de "la más alta publicada"**: es la garantía que hace que
  publicar la v3 no mueva una inspección abierta contra la v2, y el endpoint no puede ser
  el lugar donde esa garantía se pierda.
- **`GET /scheduled-inspections/:id/locations`** — el catálogo cerrado de ubicaciones
  **activas** de la planta de la inspección, en la forma que `locationOptionSchema` ya
  define.
- **`GET /scheduled-inspections/:id/roster`** — el subconjunto **activo** del roster de esa
  misma planta, en la forma de `personOptionSchema`.
- **Las tres se leen dentro de `withSessionScope`**, igual que `POST /uploads/presign`: si
  la inspección no es visible para el solicitante, la respuesta es 403 y no se emite nada.
  El aislamiento por planta lo aplica la política RLS y no un `WHERE` del endpoint.
- **Los tres esquemas de respuesta se mudan de `apps/web` a `packages/contracts`.** Hoy
  viven en `apps/web/src/offline/prefetch.ts` con una nota que dice que son un supuesto
  declarado mientras el servidor no exista. Al aterrizar el servidor, la nota se borra y
  el contrato pasa a ser uno solo para las dos mitades.
- **Tarea 9.3 de `offline-inspection-capture` deja de estar bloqueada**: con estas rutas,
  el recorrido en Chrome con la red deshabilitada se puede ejecutar de punta a punta hasta
  el momento del envío.

Fuera de alcance, explícito: `POST /inspection-submissions` y su transacción idempotente;
cualquier endpoint de escritura sobre plantillas, catálogo o roster; paginación o búsqueda
sobre el roster; y una ruta que devuelva las tres piezas en una sola respuesta —la
descarga previa las pide por separado a propósito, para que un fallo parcial deje
evidencia de qué falta (design D5 de `offline-inspection-capture`).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections`: gana la obligación de **servir el paquete de campo de una inspección
  programada**. Hoy la capability define qué es una inspección programada, cómo se
  congela su versión y quién la administra; lo que no dice es que su contenido tenga que
  ser legible por el dispositivo que va a recorrer, en tres lecturas acotadas por su
  alcance. Esa es la obligación nueva, y va acá porque las tres rutas cuelgan de
  `scheduled_inspection` y su alcance sale de ella.

## Impact

| Área | Efecto |
| --- | --- |
| `apps/api/src/inspections/` | Tres rutas nuevas en el controlador y sus consultas en el servicio. Sin dependencias nuevas. |
| `packages/contracts` | Archivo nuevo con las tres respuestas del paquete de campo. Ningún contrato existente cambia. |
| `apps/web/src/offline/prefetch.ts` | Los esquemas locales se reemplazan por los de `@hs/contracts` y se borra la nota del supuesto declarado. Sin cambios de comportamiento: las rutas y las formas ya son las que el dispositivo espera. |
| `apps/web` (tests) | Los dobles del servidor pasan a construirse contra el contrato compartido, que es lo que convierte un desajuste en un error de compilación. |
| Migraciones | Ninguna. Este change no crea ni altera ninguna tabla, y no escribe una sola fila. |
| Tablas inmutables | Ninguna. Las tres operaciones son lecturas. |
