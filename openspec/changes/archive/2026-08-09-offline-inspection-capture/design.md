## Context

Ver `proposal.md` — Why, y `specs/offline-capture/spec.md` para los requisitos. Restricciones
que dan forma al diseño y que no se re-discuten acá:

- **ADR-001** — el offline no es sincronización. Dexie para el almacén local, Serwist para el
  service worker, tabla `outbox` propia, `client_submission_id` para la idempotencia. Descartados
  y no reconsiderables: ElectricSQL, PowerSync, RxDB con replicación, WatermelonDB, Yjs,
  Replicache y cualquier cosa con CRDTs.
- **ADR-003** — Vite + React + TanStack Router + TanStack Query. Nada de Next.js ni de RSC: el
  control fino del service worker es el motivo entero de la elección.
- **ADR-006** — subida por presigned URL, bucket con versioning, sin ruta de borrado desde la
  aplicación.
- **ADR-010** — Android. `navigator.storage.persist()`, instalación en pantalla de inicio,
  indicador permanente, advertencia a los 3 días. El supuesto es sincronizar dentro de 7 días.
- **ADR-007** — `packages/forms` no puede depender de builtins de Node porque viaja dentro del
  bundle del service worker. Este change es el primero donde esa regla se paga de verdad.

Estado de partida: `apps/web` es el stub de la etapa 0 (`App.tsx` con `health` y `isAnswered`),
sin router, sin service worker, sin almacén local. `apps/web/src/auth/session-client.ts` ya
existe y ya está construido para esto: inyecta el `TokenStore` en vez de asumir `localStorage`
—"el service worker de la etapa 3 no lo tiene"— y serializa el refresh para que tres requests
vencidos no gasten el token tres veces. `packages/forms` expone documento, visibilidad y
validación puras. `packages/contracts` tiene `scheduledInspectionSchema`, `locationOptionSchema`
y `personOptionSchema`, que son exactamente las tres piezas de la descarga previa.

**Tablas inmutables tocadas: ninguna.** Este change no escribe una fila en Postgres. `apps/api`
solo gana un endpoint que firma una URL.

## Goals / Non-Goals

**Goals:**

- Que un recorrido de horas sin señal no pueda perder una respuesta ya ingresada.
- Que la aplicación pueda morir en cualquier instante y reabrir en el mismo lugar.
- Que un envío salga del dispositivo una sola vez, sin importar cuántos reintentos, tabs o
  despertares del service worker haya.
- Que el inspector pueda ver, sin preguntar a nadie, cuánto trabajo suyo no salió del teléfono.

**Non-Goals de diseño** (además de los del proposal):

- Reintentos en segundo plano cuando la aplicación está cerrada. Background Sync tiene soporte
  desigual y aporta poco con un supuesto de 7 días; el outbox corre al abrir la aplicación y al
  volver la conectividad, con la aplicación en primer plano. Se puede agregar después sin cambiar
  ninguna decisión de acá.
- Compresión o redimensionado de fotos. Es una optimización de ancho de banda, no un requisito;
  agregarla ahora enturbia el spike 1.
- Cifrado del almacén local. El dispositivo es corporativo y Android cifra en reposo. Sin
  detalle clínico en el sistema (invariante de contexto), no hay dato que lo pida.

## Decisions

### D1 — Serwist con `injectManifest`, no `generateSW`

`generateSW` genera el service worker a partir de configuración declarativa. Sirve para
precachear estáticos y nada más. Acá el service worker tiene que ser código propio: es el lugar
donde vive el runtime caching de las rutas de captura y donde el outbox eventualmente correrá.

Se escribe `apps/web/src/sw.ts` a mano y `@serwist/vite` le inyecta el manifiesto de precache.
El costo es escribir el archivo; el beneficio es que la pieza más importante del change no está
detrás de una capa de configuración.

**Alternativa considerada:** `vite-plugin-pwa` con Workbox. Equivalente en capacidad. Serwist
está mantenido activamente y su integración con Vite es más directa; ADR-001 nombra a los dos
como aceptables.

### D2 — El outbox corre en la ventana, no en el service worker

El requisito de "un solo envío en vuelo" es más fácil de garantizar en un contexto que en dos.
El service worker precachea y sirve; el outbox vive en la ventana, arranca al montar la
aplicación, al evento `online` y al terminar una inspección.

Esto contradice la lectura optimista de "el outbox llamará a `ensureFreshSession()` desde el
service worker" del comentario de `session-client.ts`. Se mantiene la preparación —el
`TokenStore` sigue inyectado y se implementa sobre Dexie, no sobre `localStorage`— porque mudar
el outbox al service worker más adelante no debe requerir tocar la sesión. Pero hoy no se muda.

**Alternativa considerada:** outbox en el service worker con Background Sync. Ver Non-Goals.

### D3 — La exclusión mutua del envío es un lock en Dexie, no una variable de módulo

Una bandera en memoria protege contra dos llamadas en el mismo contexto y contra nada más. Dos
tabs de la PWA, o un tab más el service worker el día que se mude, envían dos veces el mismo
`client_submission_id` y el servidor tiene que absorberlo — lo cual funciona, pero convierte la
idempotencia del servidor en la única defensa en lugar de la última.

El lock es una fila en la entrada del outbox: `sending_since` (timestamp) y `lock_owner` (id
aleatorio de la instancia), tomados dentro de una transacción `readwrite` de Dexie, que es
atómica entre tabs porque IndexedDB lo es. Un lock más viejo que el timeout de envío se
considera abandonado y se puede robar: sin eso, un tab que muere a mitad de un envío bloquea la
entrada para siempre.

Robar un lock puede producir dos envíos concurrentes del mismo ID. Es aceptable y es
precisamente lo que `client_submission_id` existe para absorber: acá se reduce la frecuencia,
el servidor garantiza la corrección.

### D4 — El `client_submission_id` se genera con el borrador y es la clave primaria del borrador

No es un campo que se agrega al enviar: es el `id` de la fila del borrador en Dexie. Un
identificador que es la clave primaria no se puede regenerar por accidente en un `put`, y no
existe un camino de código donde el borrador exista sin él.

Se genera con `crypto.randomUUID()`. Requiere contexto seguro, que la PWA siempre tiene.

### D5 — El esquema de Dexie: cinco tablas, y el blob vive con la foto

```
drafts        client_submission_id (pk) · scheduled_inspection_id · account_id · site_id
              template_version_id · created_at · updated_at · current_item_key · status
answers       [client_submission_id+item_key] (pk) · value · answered_at
photos        id (pk) · client_submission_id · item_key · blob · object_key
              upload_state · attempts · last_error
outbox        client_submission_id (pk) · state · attempts · next_attempt_at
              last_error · sending_since · lock_owner
prefetch      [scheduled_inspection_id+kind] (pk) · payload · fetched_at
```

Las respuestas van en tabla propia y no en un objeto dentro de `drafts`: el requisito es
persistir *cada respuesta* antes de pintar la pantalla siguiente, y reescribir el documento
entero del borrador en cada tecla es la forma conocida de que eso se vuelva lento y se termine
haciendo con debounce — es decir, de dejar de cumplirlo.

Los blobs viven en `photos` y no en el sistema de archivos: IndexedDB los almacena
nativamente y `navigator.storage.persist()` los cubre.

`prefetch` guarda las tres descargas por inspección con `kind` en
`template_version | locations | roster`, y "field-ready" es la presencia de las tres. Un solo
lugar para consultarlo, y un fallo parcial deja evidencia de qué falta en vez de un booleano
que no explica nada.

### D6 — El borrador se lee, se valida y se completa con `packages/forms`, sin reimplementar nada

La visibilidad condicional, la obligatoriedad y la validación de tipo salen de `@hs/forms`
contra el documento congelado que `prefetch` guardó. El cliente no tiene una segunda opinión
sobre si una inspección está completa: llama a la misma función que el servidor llamará. Esa es
la razón de que `shared-forms-engine` fuera primero.

El requisito de que un ítem oculto no retenga respuesta se resuelve podando: al escribir una
respuesta se recalcula la visibilidad y se borran las respuestas de los ítems que quedaron
ocultos, en la misma transacción de Dexie. Guardarlas "por si acaso" y filtrarlas al enviar
significa que el contador de "N respuestas sin enviar" miente.

### D7 — El presign es por foto y se pide al momento de subir, no al capturar

Las URLs firmadas expiran. Pedirlas al capturar, en el campo y sin red, no es posible; pedirlas
por lote al reconectar hace que la última expire mientras sube la primera. Se pide una por foto,
justo antes de su PUT.

`POST /uploads/presign` recibe `scheduled_inspection_id`, `item_key`, `content_type` y
`content_length`; devuelve `url`, `object_key` y `expires_at`. El servidor deriva la object key
—`{site_id}/{scheduled_inspection_id}/{uuid}`— y no acepta una del cliente: dejar que el
dispositivo elija dónde escribe es dejar que escriba encima de otra inspección. El alcance por
sitio lo aplica RLS al leer `scheduled_inspection`, no un `WHERE` en el endpoint (invariante de
contexto).

El PUT va directo al bucket y no pasa por la API. La credencial del servidor firma solo
`PutObject`; no tiene `DeleteObject` (ADR-006).

### D8 — Un envío es "no reintentable" por 4xx y reintentable por todo lo demás

Reintentar eternamente un payload que el servidor considera inválido es un bucle que consume
batería y no converge. Un `400` o un `422` detienen la entrada y la muestran con el motivo del
servidor; la red, el `5xx` y el timeout reintentan con retroceso exponencial (1s, 2s, 4s… con
tope de 5 minutos y jitter).

El `401` no es ninguna de las dos cosas: no cuenta como intento, dispara
`ensureFreshSession()`, y si la sesión no se puede renovar la entrada queda en cola y se pide
login. Esa regla ya está escrita en `session-client.ts` y este change es quien la ejerce.

`409` tampoco: cuando aterrice `submission-ingestion-endpoint`, un reenvío del mismo
`client_submission_id` devuelve el registro existente, no un conflicto (ADR-001). Si llegara un
`409`, se trata como éxito — el registro existe, que es todo lo que el dispositivo quería.

### D9 — La edad del borrador se cuenta desde `created_at`, no desde el último toque

"Borrador de hace X días" tiene que responder a la pregunta del riesgo D: *cuánto hace que este
trabajo no llega al servidor*. Un inspector que abre la aplicación todos los días y toca una
respuesta reiniciaría el contador con `updated_at`, y la advertencia de los 3 días —la única
mitigación verificable de ADR-010— no se dispararía nunca.

### D10 — El `TokenStore` se muda a Dexie

`localStorageTokenStore` queda para los tests y para cualquier pantalla que no sea de captura.
El outbox usa un store sobre Dexie: mismo contrato, misma clase `SessionClient`, cero cambios
en su código. Es lo que la inyección de `TokenStore` estaba esperando.

## Risks / Trade-offs

- **El spike 1 no se puede verificar completo en este change** → Ver el supuesto declarado en el
  proposal. Se prueba la mitad del dispositivo contra un doble del contrato de submit, y las
  tareas del recorrido en Android real quedan escritas sin marcar. Si al implementar
  `submission-ingestion-endpoint` el contrato no calza, el error aparece en un test de contrato
  y no en 48 acres.
- **Robar un lock abandonado puede producir dos envíos concurrentes** → Es el caso que
  `client_submission_id` existe para absorber (D3). El timeout se elige holgado respecto del
  tiempo de un submit sin fotos.
- **Android puede matar el proceso durante el `put` de una respuesta** → Se pierde a lo sumo la
  respuesta en curso, que es exactamente lo que el requisito admite. La transacción de Dexie es
  atómica: no queda media respuesta.
- **`navigator.storage.persist()` puede ser denegado** → No bloquea la captura; se registra como
  estado degradado. ADR-010 ya lo trata como refuerzo y no como salvavidas, y el indicador
  permanente es la mitigación real.
- **El precache del shell crece con `packages/forms` adentro** → Es el precio de ADR-007 y se
  paga una vez, en la instalación, con red. Se mide el tamaño del bundle del service worker en
  CI para que el crecimiento sea visible en un diff.
- **Serwist es una dependencia nueva y relativamente joven** → El acoplamiento es un plugin de
  Vite más un `sw.ts` propio (D1). Cambiar a Workbox sería reescribir el plugin, no el service
  worker.
- **Sin Background Sync, un envío requiere que el inspector abra la aplicación** → Es el supuesto
  operativo de ADR-010 y por eso el indicador permanente es obligatorio y no dismissible.

## Migration Plan

No hay migración de datos: no existen dispositivos con estado previo. El esquema de Dexie nace
en la versión `1` y se declara con `db.version(1).stores(...)` para que la primera evolución
tenga a qué encadenarse.

El bucket S3-compatible debe existir antes del despliegue, con versioning activado y una
credencial de aplicación limitada a `PutObject` y `GetObject` sobre su prefijo. Sin
`DeleteObject` (ADR-006).

Rollback: la PWA es un bundle estático; se revierte volviendo al build anterior. Un dispositivo
con un service worker viejo lo reemplaza en la siguiente carga con red. El riesgo real del
rollback no es el bundle sino el borrador local, y por eso el esquema de Dexie sube de versión
en vez de recrearse.
