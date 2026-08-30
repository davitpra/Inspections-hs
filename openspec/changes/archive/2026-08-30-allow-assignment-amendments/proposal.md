## Why

El compromiso de una acción correctiva no se puede corregir después de asignarlo, aunque el
trabajo todavía no haya comenzado. Esto convierte un error de responsable, descripción o fecha
en un registro permanente y obliga a abrir otra acción, pese a que la etapa `assigned` ya existe
en el ciclo.

El cambio completa la etapa 4 de `docs/requisitos-v1.2.md` §7 haciendo que la asignación sea una
decisión corregible hasta que se declare el inicio del trabajo, sin perder la cadena de auditoría.

## What Changes

- **BREAKING** Las acciones nuevas permanecerán en `open`/`assigned`; ya no avanzarán
  automáticamente a `in_progress` al crearse.
- El coordinador HS o la persona que reportó el hallazgo podrá enmendar responsable, trabajo y
  fecha mientras la acción siga en `assigned`.
- Cada enmienda conservará la instantánea completa, el actor y el instante en almacenamiento
  append-only; nunca se reescribirá el compromiso original.
- Las lecturas, plazos regulatorios y notificaciones usarán el compromiso vigente.
- La interfaz ofrecerá `Edit assignment` junto a `Start work` y mostrará el historial de
  compromisos en el registro de la etapa.
- Una vez iniciado el trabajo, ninguna enmienda adicional será aceptada.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `actions`: cambia la creación, autorización, lectura e historial del compromiso de una acción.
- `findings`: convierte `assigned` en una etapa operativa y añade la edición contextual.
- `immutability`: reemplaza la prohibición absoluta de reasignar por enmiendas append-only sin
  permitir `UPDATE` ni `DELETE`.

## Impact

- Nueva migración y tabla inmutable con RLS, auditoría y privilegios restringidos.
- Cambios en contratos Zod, controlador, servicio, repositorio, escalamiento y notificaciones de
  `actions`.
- Cambios en el flujo y las pruebas de `InspectionFindingsRoute`.
- Los consumidores que esperen que una acción recién creada esté en `in_progress` deberán tratarla
  como `open` hasta que se invoque la transición existente `Start work`.
