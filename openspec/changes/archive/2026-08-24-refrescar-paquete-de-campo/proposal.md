## Why

La descarga previa es de un solo tiro. En cuanto las tres piezas del paquete de campo están
en el dispositivo, el control que las bajó desaparece y no hay ninguna forma de volver a
pedirlas: `locations` y `roster` son la foto activa de la planta al momento de la descarga y
envejecen solas, un payload que llegó completo pero mal escrito no se puede reemplazar, y un
desajuste entre la versión guardada y la que el borrador congeló deja la captura en
"Loading the inspection…" para siempre, sin mensaje y sin salida.

Es un arreglo dentro de la **etapa 3** de §7 (motor de formularios, PWA, outbox): no abre
etapa nueva, cierra un agujero de la que ya está construida. La preparación para el campo es
justamente lo que la etapa 3 dejó probado, y hoy solo funciona la primera vez.

## What Changes

- El paquete de campo se puede volver a bajar **siempre**, no solo cuando falta algo. El
  control de descarga sigue existiendo con el paquete completo, en su forma de refresco, en
  la asignación destacada y en la captura.
- La asignación destacada dice **cuándo** se bajó el paquete. `fetched_at` ya se escribe en
  cada fila de la descarga previa y hoy nadie lo lee.
- La deriva de versión se **detecta y se nombra**: si el `template_version_id` guardado no es
  el de la inspección, la pantalla lo dice y ofrece refrescar. La versión congelada de la
  inspección ya viaja en la lista de pendientes, así que la comparación no agrega ninguna
  llamada.
- Un borrador que quedó atado a una versión que ya no está en el dispositivo deja de
  presentarse como una pantalla cargando: se nombra, y se dice que hay que descartarlo y
  empezar de nuevo. Si ya está firmado, se dice que no se puede descartar y que el servidor
  lo va a rechazar — el texto no promete una salida que la base va a negar.
- Refrescar **no toca** respuestas, fotos ni hallazgos: cuelgan del `client_submission_id`,
  no de la versión.

No hay cambios de esquema, de endpoints ni de contratos. El endpoint del documento congelado
ya es estable en el tiempo y se lo usa tal cual.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `offline-capture`: el requisito "An inspection is prepared for the field before signal is
  lost" hoy describe una preparación que solo ocurre una vez. Pasa a exigir que la
  preparación se pueda repetir con el paquete ya completo, que lo descargado se pueda fechar,
  y que el desajuste entre lo guardado y la versión congelada de la inspección se nombre en
  lugar de quedar como una pantalla sin resolver.

## Impact

Solo `apps/web`:

- `src/offline/prefetch.ts` — dos lecturas nuevas: el sello de la descarga y la decisión pura
  de deriva. `prefetchInspection` no cambia: ya sobrescribe.
- `src/components/FieldPackage.tsx` — el control en su segunda forma, y la invalidación
  completa (hoy invalida solo `fieldReady`, así que una segunda descarga no refrescaba la
  versión ni el progreso en pantalla).
- `src/routes/InspectorHomeRoute/` — `presentation.ts` decide cuándo se ofrece el refresco,
  `AssignmentHero.tsx` lo dibuja junto al sello y al aviso de deriva.
- `src/routes/CaptureRoute/index.tsx` — la rama que hoy confunde "cargando" con
  "desajustado".
- `src/api/query-keys.ts` — una clave nueva.

Sin migración: ningún cambio de esquema. Sin cambios en `apps/api` ni en `packages/`.
