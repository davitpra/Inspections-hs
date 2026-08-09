# Captura de inspecciones offline

## Why

R1 —el recorrido crítico del sistema— ocurre en 48 acres sin señal. Hoy `apps/web` es el
stub de la etapa 0: un `App.tsx` que imprime `health` y llama a `isAnswered('')` para
probar que el enlace del workspace funciona. No hay router, no hay service worker, no hay
IndexedDB. Un inspector no puede abrir la aplicación en el campo y, si pudiera, cerrarla le
costaría el recorrido entero.

El motor de formularios ya existe (`packages/forms`: documento, visibilidad condicional,
validación, nueve tipos de ítem) y las inspecciones programadas ya se abren solas con
pg-boss. Falta exactamente la pieza del medio: el dispositivo que interpreta esa
`template_version` sin red y guarda lo que el inspector responde hasta que haya con quién
hablar.

Este change continúa la **etapa 3** de `docs/Requisitos_V1.2.md` §7 (tercero de tres, tras
`shared-forms-engine` e `inspection-scheduling`) y construye la mitad del **spike 1** que
vive en el dispositivo. No la cierra: la ingesta idempotente es `submission-ingestion-endpoint`.

## Lo que este change NO es

**No es un motor de sincronización**, y esa es la decisión de ADR-001, no una simplificación
de este change. Un dueño, un dispositivo, un firmante. Sin CRDTs, sin resolución de
conflictos, sin replicación bidireccional, sin edición simultánea. El estado local es un
borrador con dueño único que se convierte en un envío y muere; nunca converge con nada.

## Un supuesto declarado sobre el alcance del servidor

El criterio central del spike 1 —"se crea exactamente un registro; reenviar el mismo
`client_submission_id` no duplica"— es una garantía del **servidor**, y ADR-001 la asigna a
`submission-ingestion-endpoint`. Este change entrega y prueba la mitad del dispositivo: un
solo envío en vuelo, reintentos con retroceso, y un `client_submission_id` que sobrevive al
cierre completo de la aplicación y se reenvía idéntico. El recorrido end-to-end en el
Android real se ejecuta cuando aterrice el endpoint de ingesta; las tareas de ese recorrido
quedan escritas acá, sin marcar.

La única excepción es `POST /uploads/presign`: la subida de fotos está en alcance y sin ese
endpoint no existe. Se implementa acá, mínimo, y se detiene en firmar la URL — ninguna
lógica de envío.

## What Changes

- **`apps/web` deja de ser un stub y pasa a ser una PWA instalable.** TanStack Router y
  TanStack Query (ADR-003), manifiesto de aplicación, y precache del shell con **Serwist**.
  El shell precacheado incluye el bundle del motor de formularios: el service worker tiene
  que poder renderizar la inspección sin una sola petición de red.
- **Descarga previa antes de salir a recorrer.** Al abrir una inspección programada con
  red, el dispositivo baja y guarda en Dexie: la `template_version` completa y congelada,
  el catálogo cerrado de ubicaciones del sitio, y el subconjunto del roster (personas
  activas del sitio). Una inspección sin ese paquete completo se marca como no lista para
  el campo, visiblemente, antes de que el inspector pierda señal.
- **Borrador en Dexie**, escrito por respuesta y no por sesión. Cada respuesta que el
  inspector toca se persiste antes de que la pantalla siguiente se pinte. Cerrar la
  aplicación, quedarse sin batería o que Android mate el proceso no pierde nada más que la
  respuesta que se estaba tipeando.
- **Fotos: subida por presigned URL, antes del envío del formulario.** La foto se guarda
  como blob en Dexie al tomarla, y se sube en cuanto haya red; el envío referencia object
  keys, nunca blobs. Si el envío falla, las fotos ya están del otro lado; si una foto falla,
  se reintenta sin arriesgar el formulario (ADR-001, ADR-006).
- **Tabla `outbox` en Dexie con un solo envío en vuelo.** Una entrada por inspección, con
  estado, intentos y último error. Reintentos con retroceso exponencial. **Una entrada
  nunca se descarta por un 401** — el `SessionClient` ya está construido con esa regla
  (`apps/web/src/auth/session-client.ts`); el outbox la ejerce.
- **`client_submission_id`**: UUID generado en el dispositivo al crear el borrador, no al
  enviarlo. Persistido con el borrador y estable a través de reinicios de la aplicación,
  cambios de red y cualquier número de reintentos. Es la clave de idempotencia del sistema
  entero y su valor se fija una sola vez.
- **`navigator.storage.persist()` en el arranque** y la instalación en pantalla de inicio
  como paso del onboarding (ADR-010).
- **Indicador permanente**: "N respuestas sin enviar, borrador de hace X días", visible en
  todas las pantallas de captura. Advertencia destacada a partir de 3 días sin sincronizar.
  Es la mitigación que convierte el supuesto de los 7 días de ADR-010 en algo que el
  usuario puede verificar por sí mismo.
- **`POST /uploads/presign` en `apps/api`**: firma un PUT contra el bucket S3-compatible
  para una inspección programada del alcance del solicitante. Sin credenciales de borrado,
  con versioning activado en el bucket (ADR-006).
- **Contratos nuevos en `packages/contracts`**: el paquete de descarga previa, el request y
  la respuesta de presign, y el payload del envío con `client_submission_id`. El
  servidor implementa el submit en el change siguiente contra este mismo contrato.

Fuera de alcance, explícito: la transacción de ingesta y el `UNIQUE` sobre
`client_submission_id`; la derivación de hallazgos; la pantalla de firma más allá de
capturarla como respuesta; el builder visual (etapa 8); i18n de cualquier tipo; y toda forma
de sincronización multi-dispositivo o edición simultánea.

## Capabilities

### New Capabilities

- `offline-capture`: qué debe tener el dispositivo descargado antes de perder señal, cómo
  sobrevive un borrador al cierre de la aplicación, cómo se suben las fotos por separado y
  antes del envío, cómo la cola de salida envía una sola vez y reintenta, qué hace estable
  al `client_submission_id`, y qué le dice la interfaz al inspector sobre lo que todavía no
  salió del teléfono.

### Modified Capabilities

Ninguna. `inspections` define la obligación de inspeccionar y no cambia: este change
consume `scheduled_inspection` tal como está, sin tocar su forma ni sus garantías.
`templates` define qué es una versión publicada y qué significa que un conjunto de
respuestas sea válido contra ella; el dispositivo lo importa, no lo redefine.

## Impact

| Área | Efecto |
| --- | --- |
| `apps/web` | El change entero. Dependencias nuevas: `@tanstack/react-router`, `@tanstack/react-query`, `dexie`, `@serwist/vite` + `serwist`. Módulos de descarga previa, borrador, fotos, outbox e indicador de estado. |
| `apps/web/vite.config.ts` | Plugin de Serwist, entrada del service worker, manifiesto. |
| `apps/web/src/auth/session-client.ts` | Sin cambios de forma. Gana un `TokenStore` sobre Dexie: el outbox necesita el token donde `localStorage` no llega. |
| `packages/contracts` | Archivo nuevo de submissions y presign. Ningún contrato existente cambia. |
| `packages/forms` | Sin cambios. Se consume tal cual, dentro del bundle del service worker — la restricción de "sin builtins de Node" de ADR-007 empieza a pagarse acá. |
| `apps/api` | Módulo nuevo y mínimo para `POST /uploads/presign`. Sin migración: no se crea ninguna tabla. |
| Almacenamiento de objetos | Primera pieza que lo usa. Bucket con versioning, credenciales sin `DeleteObject`. |
| Tablas inmutables | Ninguna. Este change no escribe una fila en Postgres. |
