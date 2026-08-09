# Ingesta de envíos de inspección

## Why

El dispositivo ya sabe enviar y no hay quién reciba. `offline-inspection-capture` dejó el
outbox construido, con lock por entrada, retroceso exponencial y un `client_submission_id`
que sobrevive al cierre de la aplicación; `packages/contracts/src/submissions.ts` ya declara
el payload y la respuesta; `packages/forms` ya valida. Falta el otro lado: `POST` a
`/inspection-submissions` hoy no existe, así que la cola de un inspector nunca se vacía y el
recorrido R1 no cierra.

Este change cierra la **etapa 3** de `docs/Requisitos_V1.2.md` §7 —cuarto y último change de
la etapa, tras `shared-forms-engine`, `inspection-scheduling` e `offline-inspection-capture`—
y completa el **spike 1**: una inspección capturada sin señal llega al servidor, se congela y
no se duplica por reintentar.

Es además la **costura crítica 1** de ADR-008: el punto de no retorno de R1 y el único lugar
donde el sistema puede corromper un registro legal. Merece el código más cuidado del
proyecto y por eso es un change propio y no un endpoint más del módulo `inspections`.

## Lo que este change NO es

**No deriva hallazgos.** La costura de ADR-008 los enumera —`insertar Respuestas → derivar
Hallazgos → escribir eventos`— y acá se implementa todo menos ese paso. La derivación es la
etapa 4 (`findings`) y llega en el change siguiente. La consecuencia declarada: al terminar
este change una inspección con ítems de cumplimiento en `no` queda registrada, congelada y
auditada, y no produce ningún hallazgo todavía.

Que se pueda partir así es una propiedad del diseño y no un atajo: los hallazgos se derivan
de filas de `inspection_answer` que ya estarán escritas, dentro de la misma transacción, en
el change que las consuma.

**No es un endpoint nuevo de contrato.** El esquema del payload, el de la respuesta, la ruta
y los códigos de error ya están fijados por la mitad que corre en el dispositivo. Este change
implementa contra ese contrato; no lo redefine.

## What Changes

- **`POST /inspection-submissions`**: una transacción, todo o nada. Verifica idempotencia,
  valida las respuestas contra la `template_version` congelada con `validateAnswers` de
  `@hs/forms`, inserta la inspección, inserta las respuestas como filas, y cierra.
- **Idempotencia por `client_submission_id`.** Reenviar el mismo identificador devuelve el
  registro existente con `created: false` y el mismo status, nunca un `409` ni un segundo
  registro (ADR-001). La garantía es un índice único del motor, no una comprobación previa
  del servicio: dos envíos concurrentes del mismo id llegan a la misma fila.
- **Dos tablas nuevas, inmutables**: `inspection` —el registro congelado: sitio, inspección
  programada, versión de plantilla, quién firmó, reloj del dispositivo y reloj del servidor—
  e `inspection_answer` —una fila por respuesta.
- **Las respuestas son filas, no un JSONB.** Cada fila lleva `item_key` indexada y
  `template_version_item_id`: la identidad dual de §4. La consulta de recurrencia de la
  etapa 7 agrupa por `item_key`, y agrupar por una clave adentro de un documento JSONB es la
  decisión que la haría inviable cuando ya no se pueda cambiar.
- **Fotos y firma como object keys.** El endpoint funde las object keys que el dispositivo
  subió antes (`photos`) dentro del conjunto de respuestas para validarlo, y comprueba que
  cada key pertenezca al prefijo de esta inspección. Nunca entran bytes por acá (ADR-001).
- **Un evento de auditoría encadenado por envío**, escrito por trigger y no por código de
  aplicación, con el doble timestamp del riesgo C: `occurred_at` es la firma del dispositivo,
  `recorded_at` lo pone el motor. Un reenvío idempotente **no** escribe un segundo evento.
- **Una inspección enviada por inspección programada.** Un segundo envío con otro
  `client_submission_id` para el mismo `scheduled_inspection_id` se rechaza con
  `already_submitted`: un dueño, un dispositivo, un firmante (§4, ADR-001).
- **Una validación fallida no deja estado parcial**, y no porque el servicio ordene bien los
  pasos: porque todo ocurre en una transacción que no se comete.

## Capabilities

### New Capabilities

Ninguna. La ingesta es comportamiento de `inspections`, que ya existe.

### Modified Capabilities

- `inspections`: la capability hoy solo declara la **obligación** de inspeccionar
  (`inspection_schedule`, `scheduled_inspection`). Este change le agrega su **cumplimiento**:
  qué es una inspección enviada, cómo se congela, cómo se identifica un envío repetido, qué
  se guarda de cada respuesta y qué se rechaza.
- `audit`: un tipo de evento nuevo, `inspection.submitted`, y el requisito de que un reenvío
  idempotente no agregue eslabón a la cadena del sitio.
- `immutability`: `inspection` e `inspection_answer` entran a la lista de tablas que ningún
  rol —tampoco `hs_migrator`— puede modificar ni borrar.

## Impact

- **Esquema**: migración `0009_inspection_submissions.sql`. Crea `inspection` e
  `inspection_answer` con `hs_make_immutable`, `hs_apply_site_isolation`, el único de
  idempotencia, los índices de recurrencia y el trigger de auditoría. `GRANT SELECT, INSERT`
  y nada más: ninguna columna de estas dos tablas admite `UPDATE`.
- **`apps/api/src/inspections`**: `submissions.controller.ts`, `submissions.service.ts` y
  funciones puras de fusión y verificación de object keys. Espejo Drizzle en
  `apps/api/src/db/schema/inspections.ts`.
- **`packages/contracts`**: sin cambios de forma. Se agrega el código de error
  `already_submitted` a lo que el endpoint puede devolver, que el outbox ya sabe interpretar.
- **`apps/web`**: sin cambios de código. Lo que cambia es que la cola por fin se vacía, y las
  tareas end-to-end que `offline-inspection-capture` dejó escritas sin marcar se ejecutan
  acá.
- **Consumidores futuros**: `findings` engancha su derivación dentro de esta misma
  transacción; `reporting` lee `inspection_answer` agrupando por `item_key`.
