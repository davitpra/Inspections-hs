## Why

Un coordinador puede abrir un período futuro sin hacerlo visible, pero hoy esa decisión queda congelada para siempre. Si después necesita adelantar el trabajo, no puede poner la inspección en la lista pendiente del inspector sin cancelar y volver a crear el período.

Este change completa una operación de la consulta operativa de períodos de la etapa 7 de `Requisitos_V1.2.md` sin cerrar una etapa nueva: permite adelantar de forma explícita y auditable una obligación ya abierta.

## What Changes

- Permitir que un `hs_coordinator` haga visible anticipadamente una inspección futura ya abierta y asignada.
- Mantener la transición como irreversible: `visible_early` solo puede avanzar de `false` a `true`.
- Rechazar el cambio para inspecciones canceladas o completadas y proteger esas reglas en PostgreSQL.
- Registrar la decisión en la cadena de auditoría.
- Ofrecer `Make visible` en el menú contextual del período y exigir confirmación antes de aplicar el cambio.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections`: añade la operación de visibilidad anticipada sobre una inspección programada existente y su efecto en la lista pendiente.
- `audit`: registra la transición de visibilidad anticipada con el actor y el período afectados.
- `immutability`: convierte `scheduled_inspection.visible_early` de asignación única a transición monótona protegida por el motor.

## Impact

- Controlador y servicio NestJS de inspecciones.
- Nueva migración SQL sobre `scheduled_inspection`, su guard y su trigger de auditoría.
- Cliente web, menú y diálogo de `ScheduleRequirementRoute`.
- Pruebas unitarias, de ruta e integración contra PostgreSQL.
