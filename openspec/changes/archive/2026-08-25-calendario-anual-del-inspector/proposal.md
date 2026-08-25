## Why

La portada solo separa el trabajo pendiente de una muestra reciente del trabajo terminado, por lo que el inspector no puede reconocer de un vistazo todos sus períodos asignados en el año. La matriz anual existente puede ofrecer esa continuidad sin mezclar obligaciones del sitio ni asignaciones de otras cuentas.

Este cambio completa la superficie de consulta operativa de períodos de la etapa 7 de `requisitos-v1.2` §7; no modifica recurrencia ni programación administrativa.

## What Changes

- Añadir a la portada del inspector un calendario anual con todas las inspecciones abiertas, completadas o canceladas asignadas a su cuenta.
- Permitir navegar por los años en los que la cuenta tiene asignaciones y consultar el detalle de cada período abierto.
- Excluir de esta matriz las asignaciones de otras cuentas y los períodos proyectados que todavía no existen.
- Reutilizar la presentación anual sin trasladar controles administrativos a la portada.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections`: amplía la portada del inspector con una vista anual de todos sus períodos asignados.

## Impact

- `apps/web/src/routes/InspectorHomeRoute/`: composición, filtrado por cuenta y pruebas de la portada.
- Presentación anual compartida actualmente alojada en `apps/web/src/routes/SchedulingRoute/`.
- No cambia APIs, contratos, base de datos ni tablas inmutables.
