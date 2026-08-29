## Why

La detección de hallazgos recurrentes sale del alcance de la v1. Retirarla ahora evita sostener
una capacidad sin uso antes de desplegar datos reales, y evita además cargar cada ingesta de
envío con una escritura inmutable que nadie lee.

La superficie tiene dos mitades que contestan preguntas distintas: la **serie**, calculada al
leer con la ventana que el lector pide, y la **marca**, congelada al nacer el hallazgo dentro de
la transacción de ingesta. Las dos se retiran juntas, porque conservar la marca sería conservar
una tabla inmutable cuyo único lector desaparece.

Este change no cierra una etapa nueva de `Requisitos_V1.2.md` §7: revierte la porción de
recurrencia declarada completa en la etapa 7 y actualiza el documento de requisitos para que el
alcance vigente deje de exigirla. Tras ADR-013, `reporting` conservaba únicamente
`GET /findings/recurrence`; al retirarla, la capability queda sin superficie y desaparece.

## What Changes

- **BREAKING** Eliminar la página `/recurrence`, su navegación, su título móvil, su cliente HTTP
  y su clave de caché.
- **BREAKING** Eliminar el endpoint `GET /findings/recurrence` y el módulo `reporting` completo
  —controller, service, SQL de series y de excluidos—, que queda sin ninguna otra ruta.
- **BREAKING** Eliminar los contratos de consulta, serie y reporte de recurrencia, y el campo
  `recurrence` del contrato del hallazgo con su esquema de marca.
- **BREAKING** Eliminar la escritura de marcas dentro de la transacción de ingesta y, mediante
  una migración forward, la tabla `finding_recurrence`, el índice parcial
  `finding_recurrence_idx` de 0010 y el UNIQUE `finding_id_item_key_uq` que 0013 agregó sobre
  `finding` como único destino de la FK compuesta de la marca. La eliminación destructiva se
  acepta porque no existen datos de producción; los eventos ya escritos en `audit_log` no se
  reescriben ni se borran para preservar la cadena hash.
- Conservar íntegra la identidad dual: `item_key` sigue siendo global, write-once, indexada y
  presente en `template_item`, `template_version_item`, `inspection_answer` y `finding`.
- Conservar las reglas de recurrencia de la programación (`inspection_schedule`), que son otro
  concepto —cada cuánto se repite una inspección— y no se tocan.
- Reformular la prueba de aceptación del riesgo A como continuidad de identidad: sigue corriendo
  en CI, con la agrupación por `item_key` escrita por el propio test.
- Retirar `reporting` de las capabilities válidas de `openspec/config.yaml` y eliminar
  `openspec/specs/reporting/` al sincronizar.
- Modificar `docs/Requisitos_V1.2.md`, `README.md` y `openspec/config.yaml`, y registrar la
  decisión en ADR-015.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `reporting`: retira las series, las dos agrupaciones, la ventana, el conteo de excluidos, el
  alcance de lectura y la vista de sitio. No conserva ningún requisito y deja de ser una
  capability del proyecto.
- `findings`: retira la marca de recurrencia —su creación en la transacción de ingesta, su
  carácter no recomputable y su ausencia en los hallazgos manuales— y reformula `item_key` como
  identidad del concepto en vez de clave de agrupación de un reporte.
- `immutability`: retira las garantías aplicables a `finding_recurrence`, sin modificar las
  garantías del resto del modelo.
- `inspections`: reformula la justificación de `item_key` en `inspection_answer`, que se conserva
  con su índice y su FK compuesta.
- `templates`: reformula la identidad dual y la prueba de aceptación de tres versiones como
  continuidad del concepto, sin dependerlas de un reporte de series.

## Impact

- Web: `RecurrenceRoute`, `api/recurrence.ts`, router, navegación, títulos, query keys, fixtures
  de hallazgo y los textos que nombraban la pantalla.
- API: módulo `reporting` completo, `findings/recurrence.ts`, el `LEFT JOIN` y el mapeo de la
  marca en `findings.service.ts`, la llamada en `submissions.service.ts`, el orden de registro de
  `app.module.ts` y el espejo Drizzle de la tabla.
- Contratos: `reporting.ts` y su test desaparecen; `findings.ts` pierde la marca.
- Persistencia: migración destructiva `0038` posterior a `0037`; el historial de migraciones y
  `audit_log` permanecen intactos.
- Tests: se elimina `recurrence.int-spec.ts`; `item-identity`, `findings`, `audit-chain` y
  `template-revisions` conservan su cobertura con su propia agrupación por `item_key`.
- Producto y documentación: retirada de la recurrencia de `docs/Requisitos_V1.2.md` §4, §5 riesgo
  A, §6-bis pregunta 11 y §7, actualización de README, OpenSpec y config, y ADR-015.
