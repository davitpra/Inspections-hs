## 1. Contratos y el endpoint de presign

- [x] 1.1 `packages/contracts/src/submissions.ts`: `presignUploadRequestSchema`
      (`scheduled_inspection_id`, `item_key`, `content_type` restringido a `image/jpeg` e
      `image/png`, `content_length` con tope) y `presignUploadResponseSchema` (`url`,
      `object_key`, `expires_at`). La object key NO viaja en el request — la deriva el servidor
      (D7).
- [x] 1.2 En el mismo archivo, el contrato del envío: `inspectionSubmissionSchema` con
      `client_submission_id` (uuid), `scheduled_inspection_id`, `template_version_id`,
      `answers` (item_key → valor, la forma que `@hs/forms` ya define), `photos` (item_key →
      object keys) y `signed_at`. Sin bytes de imagen, y un comentario que diga por qué (ADR-001).
      La respuesta `acceptedSubmissionSchema` devuelve el registro creado _o el existente_.
- [x] 1.3 Exportar desde `packages/contracts/src/index.ts` y agregar tests de forma en
      `submissions.test.ts`: un payload con un blob no parsea; un `content_type` fuera de la lista
      no parsea; un `client_submission_id` que no es uuid no parsea.
- [x] 1.4 `apps/api/src/uploads/`: módulo con `POST /uploads/presign`. Lee
      `scheduled_inspection` dentro de `withSessionScope` — el aislamiento por sitio lo aplica la
      política RLS, nunca un `WHERE` en el endpoint. Si la inspección no es visible, 403.
- [x] 1.5 Cliente S3-compatible en `apps/api/src/uploads/object-storage.ts`: firma `PutObject`
      con expiración corta y deriva la key como `{site_id}/{scheduled_inspection_id}/{uuid}`.
      Configuración por variables de entorno, documentada en `.env.example`. La credencial no
      lleva `DeleteObject` (ADR-006) y eso queda escrito en el comentario del módulo.
- [x] 1.6 Tests de `apps/api` para el presign: una cuenta sin alcance en la planta recibe 403 y no
      se emite URL; una key propuesta por el cliente se ignora; la URL emitida expira. **Sin
      migración: este change no crea ni altera ninguna tabla.**

## 2. La PWA: shell, router y persistencia

- [x] 2.1 Dependencias en `apps/web`: `@tanstack/react-router`, `@tanstack/react-query`, `dexie`,
      `serwist` y `@serwist/vite` (ADR-003, ADR-001).
- [x] 2.2 Router y layout: rutas `/` (pendientes), `/inspections/$id/prepare`,
      `/inspections/$id/capture`, `/inspections/$id/review`, `/outbox`. `App.tsx` deja de imprimir
      `health`.
- [x] 2.3 `apps/web/src/sw.ts` escrito a mano + `@serwist/vite` con `injectManifest` (D1).
      Precache del shell, del bundle y de `@hs/forms`; runtime caching de nada que sea de captura
      —esas rutas se sirven del precache y no tocan red.
- [x] 2.4 Manifiesto de aplicación e iconos; instalable en pantalla de inicio (ADR-010). Paso de
      onboarding que la ofrece.
- [x] 2.5 `navigator.storage.persist()` al arrancar; el resultado se guarda como estado y una
      denegación se muestra como almacenamiento degradado sin bloquear la captura.
- [x] 2.6 Pantalla offline para rutas fuera del shell de captura: nombra qué necesita conexión y
      no descarta ningún borrador.

## 3. Dexie: el almacén local

- [x] 3.1 `apps/web/src/offline/db.ts` — las cinco tablas de D5 (`drafts`, `answers`, `photos`,
      `outbox`, `prefetch`) declaradas con `db.version(1).stores(...)`, para que la primera
      evolución del esquema tenga a qué encadenarse.
- [x] 3.2 `dexieTokenStore` implementando el `TokenStore` de `session-client.ts` (D10). Sin tocar
      `SessionClient`: si hubo que modificarlo, el diseño se desvió.
- [x] 3.3 Tests del almacén con `fake-indexeddb`: se escribe, se lee, y una transacción
      interrumpida no deja media respuesta.

## 4. Descarga previa

- [x] 4.1 `prefetchInspection(scheduledInspectionId)`: baja la `template_version` congelada, el
      catálogo de ubicaciones del sitio y el subconjunto activo del roster, y escribe las tres
      filas de `prefetch` (`kind` en `template_version | locations | roster`).
- [x] 4.2 `isFieldReady()` = las tres presentes. La lista de pendientes muestra el estado y, si
      falta algo, lo nombra — con red todavía disponible.
- [x] 4.3 Abrir para captura una inspección que no está lista y sin red no inicia la captura:
      nombra qué falta y que hace falta conexión.
- [x] 4.4 La `template_version` guardada es la que la inspección tiene congelada. Test: publicar
      una versión más alta y reconectar no cambia el documento local ni la interpretación.

## 5. Borrador y captura

- [x] 5.1 Crear borrador: `client_submission_id` con `crypto.randomUUID()` **como clave primaria
      de la fila** (D4), junto con `scheduled_inspection_id`, `account_id`, `site_id` y
      `template_version_id`.
- [x] 5.2 `saveAnswer(item_key, value)`: escribe en `answers` dentro de una transacción `readwrite`
      **antes** de que la pantalla siguiente se pinte. Nada de debounce.
- [x] 5.3 En la misma transacción, recalcular visibilidad con `@hs/forms` y **podar** las
      respuestas de los ítems que quedaron ocultos (D6). Un ítem oculto no conserva respuesta y no
      se reporta como faltante.
- [x] 5.4 Renderizado de los nueve tipos de ítem contra el documento congelado, usando el motor
      compartido para obligatoriedad, rango y pertenencia al catálogo. El cliente no tiene una
      segunda opinión sobre validez.
- [x] 5.5 Reanudar: reabrir restaura respuestas, `current_item_key` y fotos, sin red.
- [x] 5.6 Aislamiento por cuenta: un borrador de la cuenta A no se lista ni se lee cuando firma la
      cuenta B en el mismo dispositivo.
- [x] 5.7 Una inspección con envío aceptado se abre en solo lectura y no genera borrador nuevo.
- [x] 5.8 Tests con `fake-indexeddb`: doce respuestas sobreviven a recrear la base desde cero
      (equivalente a cerrar la aplicación); la poda de ocultos deja el conteo correcto.

## 6. Fotos

- [x] 6.1 Captura: el blob se escribe en `photos` con `upload_state: 'pending'` en el momento de
      tomarla. Visible en el borrador sin red.
- [x] 6.2 `uploadPhoto(id)`: pide `POST /uploads/presign` para **esa** foto y hace el PUT directo
      al bucket, justo antes de subir y no por lote (D7). Al terminar guarda `object_key` y
      `upload_state: 'uploaded'`.
- [x] 6.3 Una foto ya subida no vuelve a pedir presign ni a subir. Un fallo de una foto no toca a
      las otras ni a las respuestas.
- [x] 6.4 Tests: cinco fotos con una que falla suben cuatro y reintentan la quinta sin
      re-capturarla; una subida exitosa es idempotente en la siguiente corrida.

## 7. Outbox

- [x] 7.1 `enqueue(client_submission_id)` al completar y firmar la inspección. Una entrada por
      inspección.
- [x] 7.2 El lock de D3: `sending_since` + `lock_owner` tomados en una transacción `readwrite`.
      Un lock más viejo que el timeout se considera abandonado y se puede robar; queda escrito en
      el comentario por qué eso es aceptable (`client_submission_id` lo absorbe).
- [x] 7.3 Guarda previa: no se envía mientras alguna foto de la inspección esté sin subir; en su
      lugar se intentan las subidas pendientes.
- [x] 7.4 Construcción del payload contra `inspectionSubmissionSchema`: solo object keys, nunca
      bytes. El `client_submission_id` es el de la fila, no uno nuevo.
- [x] 7.5 Clasificación de la respuesta (D8): `4xx` de validación detiene la entrada y la muestra
      con el motivo del servidor; red / `5xx` / timeout reintentan con retroceso exponencial
      (1s → tope 5min, con jitter); `401` no cuenta como intento, dispara `ensureFreshSession()`
      y si no se puede renovar deja la entrada en cola y pide login; `409` se trata como éxito.
- [x] 7.6 Una entrada se elimina **solo** después de que el servidor la aceptó. Una entrada
      rechazada conserva el borrador legible en el dispositivo.
- [x] 7.7 Disparadores: al montar la aplicación, en el evento `online`, y al terminar una
      inspección. Sin Background Sync (Non-Goal de `design.md`).
- [x] 7.8 Tests: dos corridas concurrentes de la misma entrada producen un solo envío; una sesión
      vencida no pierde el envío; los reintentos crecen y `attempts`/`last_error` quedan
      guardados; un doble del contrato de submit verifica que el segundo intento manda el mismo
      `client_submission_id` que el primero.

## 8. El indicador permanente

- [x] 8.1 Selector: cuenta de respuestas sin enviar (suma de `answers` de los borradores no
      aceptados) y edad del borrador sin sincronizar más viejo, calculada desde `created_at` y no
      desde `updated_at` (D9).
- [x] 8.2 Componente presente en toda pantalla de captura, con o sin red: "N answers not
      submitted, draft from X days ago". No descartable mientras haya trabajo sin enviar.
- [x] 8.3 Advertencia destacada a partir de 3 días (ADR-010). A los 2 días el indicador informa y
      la advertencia no aparece.
- [x] 8.4 El indicador se limpia para una inspección solo cuando el servidor aceptó su envío.
- [x] 8.5 Tests de los umbrales, incluida la trampa de D9: tocar una respuesta todos los días no
      reinicia el contador.

## 9. Verificación

- [x] 9.1 `pnpm typecheck`, `pnpm lint` y `pnpm test` en verde en todo el workspace.
- [x] 9.2 Test de la regla de ADR-007 sobre el bundle: el service worker construido no contiene
      ningún builtin de Node. Medir y registrar el tamaño del precache para que su crecimiento
      aparezca en un diff.
- [x] 9.3 Recorrido manual en Chrome con red deshabilitada: preparar, capturar en avión, cerrar la
      pestaña, reabrir, reconectar. Un solo envío.
      **Verificado salvo el último tramo.** Con la API y el preview caídos: el shell y la
      ruta de captura se sirvieron del precache (`deliveryType: cache-storage`, 0 bytes de
      red), la respuesta escrita en avión persistió, y cerrar la pestaña y reabrirla
      devolvió el mismo `client_submission_id` con sus 10 respuestas y su `current_item_key`.
      Al reconectar, el outbox corrió, tocó la API real y quedó `queued` con `attempts` +1 y
      su retroceso — sin perderse. "Un solo envío" no se puede afirmar todavía: lo prueba
      `submission-ingestion-endpoint`, que es quien crea `POST /inspection-submissions`.

## 10. Spike 1 en Android real — bloqueado por `submission-ingestion-endpoint`

Estas tareas no se marcan en este change. Quedan escritas acá porque son el criterio de
aceptación del recorrido y su verificación es conjunta (ver el supuesto declarado en
`proposal.md`).

- [ ] 10.1 Instalar la PWA en un Android real desde el onboarding y confirmar que
      `navigator.storage.persist()` fue concedido.
- [ ] 10.2 Preparar una inspección con red, activar modo avión, completarla entera con 5 fotos y
      firmarla.
- [ ] 10.3 Cerrar la aplicación por completo (no minimizar). Reabrir en avión: el borrador está
      entero, con sus 5 fotos.
- [ ] 10.4 Reconectar. Verificar que se crea **exactamente un** registro, con sus 5 object keys.
- [ ] 10.5 Reenviar el mismo `client_submission_id` a mano: devuelve el registro existente, no un
      duplicado ni un 409.
