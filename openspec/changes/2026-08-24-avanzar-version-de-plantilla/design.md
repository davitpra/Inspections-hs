## Context

Ver `proposal.md — Why` para la motivación. Lo que hace falta saber para elegir el enfoque:

- **La columna está congelada por dos barreras, no por una.** `scheduled_inspection` no
  tiene `GRANT UPDATE (template_version_id)` —`0008_inspection_scheduling.sql` concede
  solo `(inspector_id, cancelled_at, cancellation_reason)`— y además `template_version_id`
  está en el array `frozen` de `hs_scheduling_guard()`, hoy vigente en la redefinición de
  `0029_inspection_frequency.sql` §3. La primera da `42501` para `hs_app`; la segunda da
  `HS001` para cualquier rol, el dueño incluido. Levantar una sola no alcanza, y levantar
  las dos sin poner nada en su lugar deja la columna abierta de par en par.
- **La FK ya es compuesta.** `(template_version_id, template_id)` referencia
  `template_version (id, template_id)`, así que "una versión de otra plantilla" ya es
  imposible y el trigger no tiene que comprobarlo: lo comprueba el motor por otra vía.
- **El envío firmado tiene su propia columna.** `inspection.template_version_id` se escribe
  en la ingesta desde la fila programada (`submissions.service.ts:264`) y vive en una tabla
  sin UPDATE. Es esa columna —y no la de `scheduled_inspection`— la que sostiene ADR-005:
  publicar la v5 no cambia cómo se lee un envío firmado contra la v2.
- **La ingesta compara versiones y rechaza.** `submissions.service.ts:70` rechaza el envío
  cuyo `template_version_id` declarado no es el de la fila programada. Es la razón por la
  que avanzar con un borrador FIRMADO en el outbox es destructivo: el inspector ya caminó
  la planta y firmó.
- **El borrador congela la suya.** `DraftRow.template_version_id` se escribe al abrir el
  borrador desde el paquete guardado y no se recalcula; `documentForDraft` devuelve `null`
  cuando no coinciden. Avanzar con un borrador `capturing` lo deja huérfano y sus
  respuestas se pierden.
- **La deriva ya tiene vocabulario.** `packageDrift()` en `offline/prefetch.ts` distingue
  `'stale-package'` de `'draft-orphaned'` y `driftMessage()` les da texto. Este change se
  monta ahí en lugar de inventar otro camino.
- **Este change CONTRADICE un change archivado, y conviene decirlo.**
  `2026-08-24-refrescar-paquete-de-campo` (design.md, D1) dice: «La versión congelada no se
  mueve… volver a bajar el documento es idempotente». Era cierto cuando se escribió: no
  había forma de revisar una plantilla publicada. La etapa 8 la creó. Lo que aquel change
  construyó —el control de refresco, el sello de la descarga, la deriva con nombre— es
  exactamente la superficie sobre la que este se apoya.

**TABLA INMUTABLE TOCADA: `scheduled_inspection`.** Es el §5 del régimen de 0008. Este
change saca UNA columna del array `frozen` y le concede `GRANT UPDATE`, y a cambio escribe
en el trigger tres reglas nuevas que no existían. No se toca ninguna otra columna del
array, ni `inspection`, ni `inspection_answer`, ni `audit_log`.

## Goals / Non-Goals

**Goals:**

- Que una obligación pendiente pueda tomar la versión corregida de su plantilla sin
  cancelar el período ni cambiar de `id`.
- Que la garantía siga siendo del motor y no del endpoint (ADR-002): un `UPDATE` a mano
  hacia atrás, o sobre un período ya enviado, tiene que fallar en la base.
- Que el avance sea un hecho auditado, distinguible en la cadena de la reasignación y de la
  cancelación.
- Que ninguna de las dos formas de perder trabajo —borrador huérfano, envío rechazado
  después del recorrido— pueda ocurrir por pulsar un botón.

**Non-Goals:**

- Retroceder de versión, o moverse a una versión de otra plantilla. Ninguna de las dos es
  "avanzar" y las dos quedan prohibidas por el motor.
- Tocar `inspection.template_version_id`. El envío firmado no se reinterpreta nunca
  (ADR-005).
- Migrar un borrador de una versión a otra. Las respuestas se guardan por clave de ítem y
  reinterpretarlas contra otro documento es lo que `documentForDraft` impide a propósito;
  sigue impidiéndolo.
- Avanzar solo: nada de temporizadores, de avance al abrir el período, ni de avance en el
  trabajo de pg-boss. Es el mismo criterio que el change del refresco: la preparación es un
  acto del inspector antes de salir, y hacerla automática es hacerla invisible.
- Sincronización multi-dispositivo (fuera de alcance en v1).

## Decisions

**D1 — Avanzar, no cambiar, y la diferencia la fuerza el trigger.**
Las tres condiciones —hacia adelante, antes del envío, período vivo— van en
`hs_scheduling_guard()` y no en `InspectionsService`. ADR-002: la inmutabilidad la fuerza
el motor porque un endpoint nuevo, un seed o un comando de servidor no pasan por el
servicio. Escribir las comprobaciones en el servicio sugeriría que sin ellas se podría, que
es exactamente lo que el comentario largo de `inspections.service.ts` dice que este archivo
no hace.

La condición 1 se comprueba comparando `version` por subconsulta a `template_version`, no
por `published_at`: `version` es un entero monótono por `template_id` con único
`(template_id, version)`, y es lo que ya usa `LATEST_PUBLISHED_VERSION_CTE` para ordenar.
La condición 2 es un `EXISTS` sobre `inspection` por `scheduled_inspection_id`, la misma
condición que `periodStatusCase` llama `completed` y que `pendingFor` usa como filtro: si
las tres se alejaran entre sí, un período podría estar "pendiente" para la lista y
"enviado" para el trigger.

**D2 — Con borrador NO se avanza, y la decisión es del cliente.**
El servidor no ve el Dexie del dispositivo: ADR-001 dice que un dueño, un dispositivo, un
firmante, y que el servidor garantiza la corrección del envío, no el estado del borrador.
El único que sabe si hay un borrador abierto es la pantalla, y `AssignmentHero` ya recibe
`draftStatus` y `draftTemplateVersionId` desde el change del refresco. Por eso
`prefetchInspection` recibe `advance` como opción y no lo decide adentro.

La alternativa —que el servidor rechace el avance cuando "hay un borrador"— es imposible de
implementar sin inventar un registro de borradores en el servidor, que es sincronización
multi-dispositivo con otro nombre y está fuera de v1.

**D3 — El avance es un `POST` aparte; el `GET` del documento no cambia.**
`GET /scheduled-inspections/:id/template-version` sigue siendo una lectura pura. Hacer que
mutara sería una descarga con efecto de lado: el mismo `GET` lo hace la vista previa de la
asignación y lo va a hacer cualquier reintento del cliente. El `POST` devuelve el mismo
`TemplateVersionPackage`, así que `prefetchInspection` guarda la respuesta en la fila de
Dexie sin ramificar la escritura: cambia de dónde saca el payload, no qué hace con él.

**D4 — El avance es idempotente y no audita de más.**
El `UPDATE` lleva `WHERE template_version_id IS DISTINCT FROM <la última publicada>`. Un
`UPDATE` que no cambia nada no dispara la rama de auditoría —`hs_scheduled_inspection_audit`
ya escribe "una entrada por hecho, no una entrada mezclada"— y refrescar tres veces seguidas
deja una sola entrada. Refrescar cuando ya está en la última no es un error: no escribe y
devuelve el paquete.

**D5 — Quién puede avanzar: el inspector asignado o el coordinador.**
El inspector asignado, porque es quien pulsa el botón y quien va a usar el formulario; el
coordinador, porque es quien administra la programación. El criterio de actor es el mismo
que `submissions.service.ts:57` aplica para el envío, y se reusa en lugar de escribir un
tercero. El requisito "Only the HS coordinator schedules, reassigns and cancels" NO se
modifica: avanzar no es programar, reasignar ni cancelar — es preparar para el campo, y
prepararse siempre fue del inspector.

**D6 — `packageDrift` gana `'newer-version'`, no un booleano al lado.**
Es el mismo motivo que D2 del change del refresco: son estados con salidas distintas y un
booleano obligaría a la pantalla a volver a distinguirlos. Quedan cuatro:
`'none' | 'stale-package' | 'draft-orphaned' | 'newer-version'`. El orden de precedencia es
el que ya está —el borrador huérfano primero, porque refrescar no lo salva— y
`'newer-version'` va último: solo se mira cuando lo guardado y lo congelado ya coinciden.

**D7 — La lista de pendientes trae la versión publicada; Scheduling la compara con lo que
ya tiene.** `PendingInspection` gana `template_version`, `latest_template_version` y
`latest_template_version_id`, resueltos en el servidor con `LATEST_PUBLISHED_VERSION_CTE`
—la misma expresión que usan la apertura de período y el listado de plantillas, por el
motivo que ese archivo explica: que el tercero discrepe de los dos primeros es un fallo
silencioso—. La consola de programación, en cambio, NO necesita contrato nuevo: ya consulta
`queryKeys.templates()`, que trae `latest_version` por plantilla, y `ScheduledInspection` ya
lleva `template_version`. Es el mismo patrón que `OpenPeriodForm.tsx:63` usa para decir
"freezes version N".

## Risks / Trade-offs

- **Se pierde una garantía que estaba escrita: la versión de un período abierto ya no es
  estable en el tiempo.** Es el cambio pedido y no un efecto colateral. Lo que se conserva
  es la garantía que un inspector del MLITSD puede necesitar: la versión contra la que se
  FIRMÓ un envío no se mueve, y ahora además hay una entrada de auditoría por cada avance,
  con la versión anterior y la nueva. El reporte de cumplimiento no se ve afectado: cuenta
  períodos debidos contra períodos enviados, no versiones.
- **Un borrador firmado en el outbox + un avance = envío rechazado después del recorrido**
  → es el peor caso del change y por eso D2 lo evita en el cliente. Si aun así ocurre (dos
  dispositivos, un avance pedido por el coordinador), el texto que ya existe para el
  borrador huérfano firmado lo nombra: el servidor lo va a rechazar y no hay salida. Es
  ADR-001, no algo que esta pantalla pueda resolver.
- **Una versión que avanza entre la descarga y la captura** → no puede pasar sin acto: la
  captura no avanza nada, y el avance ocurre en el mismo `prefetchInspection` que después
  escribe el documento nuevo. El borrador se abre desde lo guardado, que ya es la versión
  nueva.
- **El trigger se vuelve más largo y con más de una responsabilidad** → ya la tenía: es un
  trigger compartido por tres tablas con un `CASE` por `TG_TABLE_NAME`. Las reglas nuevas
  van en su propio bloque `IF TG_TABLE_NAME = 'scheduled_inspection'`, leyendo por `jsonb`
  como el resto y por el mismo motivo que 0029 documenta —plpgsql no corta antes de tocar
  un campo que la otra tabla no tiene.
- **Un `GRANT UPDATE` más sobre una tabla del §5** → es de una columna, y la segunda
  barrera (el trigger) es la que define qué valor se acepta. Sin las dos, "parcialmente
  mutable" quiere decir "entera", que es lo que 0029 §4 ya escribió.

## Migration Plan

`0030_advance_template_version.sql`, hacia adelante y sin backfill: no hay dato que
convertir, solo privilegios y dos funciones que se reemplazan con `CREATE OR REPLACE`. Los
tres triggers apuntan a `hs_scheduling_guard()` por nombre y no hay que recrearlos; el de
auditoría apunta a `hs_scheduled_inspection_audit()` igual.

Revertir es revertir el commit y escribir la migración inversa: devolver
`template_version_id` al array `frozen` y `REVOKE UPDATE (template_version_id)`. Las filas
que hayan avanzado se quedan donde quedaron —es el valor correcto de todos modos— y las
entradas `inspection.version_advanced` de la cadena no se tocan: el log es append-only.
