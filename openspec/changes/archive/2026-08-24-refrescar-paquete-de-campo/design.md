## Context

Ver `proposal.md — Why` para la motivación. Lo que hace falta saber para elegir el enfoque:

- **La versión congelada no se mueve.** `/scheduled-inspections/:id/template-version` resuelve
  `scheduled_inspection.template_version_id`, columna congelada por trigger y sin `GRANT UPDATE`
  (ADR-002 la respalda; la migración es `0008_inspection_scheduling.sql`). Publicar la v3 no
  cambia lo que ese endpoint devuelve para una inspección atada a la v2. **Volver a bajar el
  documento es idempotente**, y la deriva de versión no aparece sola en producción por publicar
  una plantilla: aparece por bases reconstruidas y por payloads locales que quedaron
  desalineados. Se cubre igual porque hoy su modo de falla es una pantalla muerta.
- **Lo que sí envejece es lo otro.** `locations` y `roster` son el catálogo activo y el
  subconjunto activo del sitio al momento de la descarga. Ahí el refresco no es una salvaguarda
  sino la función principal.
- **La descarga previa ya sobrescribe.** `prefetchInspection` escribe con `put` sobre la clave
  compuesta `[scheduled_inspection_id + kind]`, pieza por pieza. No hace falta ningún borrado ni
  ninguna reescritura del mecanismo: lo único que falta es que la interfaz lo ofrezca.
- **El borrador congela su propia versión.** `DraftRow.template_version_id` se escribe al abrir
  el borrador desde el paquete guardado y no se recalcula. `documentForDraft` devuelve `null`
  cuando las dos no coinciden, y esa guarda es correcta: interpretar con la versión equivocada
  produce un envío que el servidor rechaza después del recorrido (ADR-001 — el envío es el punto
  de no retorno).
- **Este change no toca ninguna tabla inmutable, ni ninguna tabla.** No hay migración: todo el
  trabajo es del cliente.

## Goals / Non-Goals

**Goals:**

- Que el control de descarga exista mientras exista la asignación, no solo mientras falte algo.
- Que lo descargado se pueda fechar y versionar en pantalla, con red o sin ella.
- Que la deriva —de paquete contra inspección, y de borrador contra paquete— tenga un nombre y
  una salida en la pantalla donde se descubre.

**Non-Goals:**

- Refrescar solo. Nada de temporizadores, de invalidación por antigüedad ni de descarga en
  segundo plano al reconectar: la descarga previa es un acto del inspector antes de salir, y
  hacerla automática es hacerla invisible.
- Migrar un borrador de una versión a otra. Las respuestas se guardan por clave de ítem, y
  reinterpretarlas contra otro documento es exactamente lo que `documentForDraft` impide a
  propósito.
- Sincronizar entre dispositivos (fuera de alcance en v1) y tocar el servidor.

## Decisions

**D1 — La deriva se decide con lo que ya viaja, no con una llamada nueva.**
`PendingInspection.template_version_id` ya está en el contrato y en la lista de pendientes que
la home consulta. La comparación contra `storedTemplateVersion(id)?.template_version_id` es una
lectura de dos valores que la pantalla ya tiene. La alternativa —volver a pedir el paquete por
red para compararlo— convertiría una lectura garantizada sin señal en una llamada, que es
justamente lo que `query-keys.ts` documenta como el error a no cometer entre
`storedTemplateVersion` y `templateVersionPackage`.

**D2 — La deriva es una función pura en `offline/prefetch.ts`, no en el `presentation.ts` de una
ruta.** La consumen dos rutas (la home y la captura) y describe el estado del paquete en el
dispositivo, que es lo que ese archivo ya posee. Ponerla en la carpeta de una ruta obligaría a la
otra a importar de adentro de una ruta ajena. Devuelve `'none' | 'stale-package' |
'draft-orphaned'` y no un booleano: son dos problemas con dos salidas distintas —uno se arregla
refrescando y el otro no— y un booleano forzaría a la pantalla a volver a distinguirlos.

**D3 — Falta de información es `'none'`, no deriva.** Mientras la consulta del paquete guardado
no resolvió, no se sabe nada. Es el mismo criterio que `readiness()` ya aplica con `'unknown'`:
un aviso dibujado antes de saber manda al inspector a arreglar algo que no está roto.

**D4 — El refresco es secundario y convive con la acción primaria.** `assignmentState` gana
`showsRefresh` en vez de un `action: 'refresh'` nuevo. La acción primaria de una asignación lista
es empezar o retomar el recorrido; degradarla a "refrescar" pondría la preparación por delante
del trabajo. `showsRefresh` es `true` con el paquete completo, incluidos los casos con borrador
en curso o firmado — un roster viejo se arregla igual con la inspección empezada.

**D5 — Un solo componente para las dos formas.** `DownloadForField` acepta la etiqueta y la
clase; no hay un `RefreshFieldPackage` aparte. Es la misma mutación con el mismo manejo de fallo
parcial, y duplicarlo sería duplicar la invalidación, que es donde ya hay un error.

**D6 — La invalidación se completa, y eso es parte del arreglo y no una limpieza al pasar.** Hoy
`onSettled` invalida solo `queryKeys.fieldReady(id)`. `storedTemplateVersion(id)` la consumen el
héroe (versión y sello), la tarjeta de progreso, la vista previa y la revisión; `draft(id)` la
consume la captura. Sin invalidarlas, la segunda descarga cambia Dexie y la pantalla sigue
mostrando lo viejo — el síntoma exacto que este change dice arreglar. Es la clase de fallo que
`query-keys.ts` describe en su encabezado: no rompe nada, solo no actualiza.

**D7 — La captura distingue "cargando" de "desajustado" comparando en la ruta, no cambiando
`documentForDraft`.** La ruta ya tiene el borrador y puede leer el paquete guardado de la caché
compartida. Ensanchar el retorno de `documentForDraft` a una unión obligaría a `ReviewRoute`, que
lo usa igual, a manejar un caso que ahí no tiene pantalla propia.

## Risks / Trade-offs

- **Un refresco a mitad del recorrido cambia el roster o las ubicaciones bajo los pies del
  inspector** → Es el comportamiento pedido: las respuestas ya guardadas no se tocan, y una
  ubicación que desapareció del catálogo sigue guardada en la respuesta que la usó. El riesgo
  real sería lo contrario, un catálogo congelado en el que la persona nueva no existe.
- **Un botón más en la asignación destacada compite con la acción primaria** → Va como
  secundario (`button--outline`) y con el sello de la descarga al lado, que es lo que lo
  justifica: sin la fecha, refrescar es una apuesta.
- **El aviso de borrador huérfano no siempre tiene salida** → Con el borrador firmado no se puede
  descartar (`isDiscardable`) y el envío va a ser rechazado por el servidor. El texto lo dice así
  en vez de ofrecer un botón que la base va a negar. Es la consecuencia de ADR-001, no algo que
  esta pantalla pueda resolver.
- **Nada previene que alguien refresque sin red** → El fallo es el que ya existe: la mutación
  falla por pieza y nombra lo que quedó afuera, y lo que ya estaba guardado sigue estando.

## Migration Plan

No hay. Sin migración SQL, sin cambio de contratos, sin cambio de versión de la base local de
Dexie: el campo `fetched_at` ya se escribe en cada fila desde que existe la tabla. Revertir es
revertir el commit.
