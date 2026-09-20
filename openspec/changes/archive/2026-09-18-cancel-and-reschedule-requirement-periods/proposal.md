## Why

El plan anual de un requisito (`/scheduling/:scheduleId`) deja abrir un período, asignarle
inspector y adelantar su visibilidad, pero no cancelarlo. Y un período cancelado queda de
solo lectura, sin forma de volver a programarlo. El servidor ya hace las dos cosas:
`POST /scheduled-inspections/:id/cancel` exige motivo y lo pueden llamar las dos cuentas
administrativas, y `POST /scheduled-inspections` sobre un período cancelado crea una fila
nueva sin tocar la cancelada. La web tuvo las dos acciones en la consola vieja
(`CancelPeriodDialog`, `ReopenPeriodDialog`) y las perdió en `1d009e6`, al pasar a la
planificación por requisito. Hoy, un mes que no se va a inspeccionar —un cierre de planta,
por ejemplo— solo puede terminar como `missed`, que es justamente lo que el registro no
debería decir.

El requisito vigente "Each owed period of a requirement is planned on its own row" limita
las operaciones de la fila a abrir y asignar, y dice que un período cancelado "SHALL offer
no assignment". En cambio, "Period operations are exposed on demand from an annual entry"
sí nombra cancelar con motivo y programar de nuevo. Las dos vistas se contradicen, y este
change pone la del plan por requisito en línea con la otra.

No cierra una etapa nueva de §7: **completa la etapa 7 (consulta operativa de períodos)**.
La etapa quedó con la vista por requisito sin dos operaciones que la API y la spec ya
daban por existentes.

## What Changes

- El menú «⋮» de cada fila del plan anual ofrece **"Cancel period"** en un período abierto
  cuyo estado es `open` o `missed`. Abre un diálogo que pide el motivo (obligatorio, hasta
  500 caracteres, el mismo `reasonSchema` del contrato). El botón no se habilita con el
  motivo vacío.
- Un período `completed` no ofrece cancelar. Un período no abierto tampoco: no hay fila que
  cancelar.
- El menú de un período cancelado ofrece **"Schedule again"**. Abre la misma confirmación
  que abrir un período, que congela la versión publicada HOY y no la que tenía la fila
  cancelada. La confirmación deja a la vista el motivo de la cancelación y aclara que la
  cancelación queda en el registro.
- Las cuentas sin administración de programación siguen leyendo el plan sin ninguna de las
  dos acciones.
- Sin cambios de API, de contratos ni de esquema.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections`: "Each owed period of a requirement is planned on its own row" suma
  cancelar con motivo para `open` y `missed`, y programar de nuevo para un período
  cancelado. Un cancelado sigue sin ofrecer asignación.

## Impact

- `apps/web/src/api/inspections.ts`: vuelve `cancelScheduledInspection(id, reason)`.
- `apps/web/src/routes/ScheduleRequirementRoute/`: `presentation.ts` + su test (elegibilidad
  de cada acción), `RequirementPeriodRow.tsx` (entradas del menú), `CancelPeriodDialog.tsx`
  (nuevo), `OpenPeriodDialog.tsx` (modo reprogramar), `index.tsx` (montaje de los diálogos)
  e `index.test.tsx`.
- **Sin migración.** `scheduled_inspection` ya concede el `UPDATE` de `cancelled_at` y
  `cancellation_reason`, y el CHECK y el trigger de guarda no cambian.
