## Context

Motivación en `proposal.md`. Lo que condiciona el cómo:

- La API ya existe y no cambia. `POST /scheduled-inspections/:id/cancel` valida
  `cancelScheduledInspectionSchema` y exige `isAdministrator` (`requireCoordinator`). Si la
  fila ya estaba cancelada, el `UPDATE … WHERE cancelled_at IS NULL` no escribe nada.
  Reprogramar es `POST /scheduled-inspections`, el mismo que abre un período.
- **Toca una tabla inmutable, sin ampliar su concesión.** `scheduled_inspection` concede
  `UPDATE` solo sobre columnas nombradas (0045: `inspector_id, cancelled_at,
  cancellation_reason, template_version_id, visible_early`). Cancelar escribe dos de ellas
  y reprogramar es un `INSERT`. El CHECK que ata los dos campos y el trigger de guarda que
  impide des-cancelar (ADR-002) no cambian, y tampoco cambia la RLS por sitio (ADR-004).
- `currentPeriod` (`apps/web/src/presentation/scheduling.ts`) ya resuelve un mes con dos
  filas: prefiere la no cancelada, y entre canceladas la más reciente. El plan anual ya
  muestra la fila correcta después de reprogramar.
- Las acciones de la fila viven en el `RowMenu` y los diálogos cuelgan de la ruta, no de la
  fila. Al mutar, la `key` de la fila puede cambiar: al reprogramar, la entrada pasa de la
  fila cancelada a la nueva.

## Goals / Non-Goals

**Goals:**
- Cancelar y reprogramar desde el plan por requisito, con los mismos patrones de diálogo y
  de invalidación que abrir y adelantar la visibilidad.

**Non-Goals:**
- Cancelar un período que no se abrió. No hay `id` que cancelar, y abrirlo solo para
  cancelarlo congelaría una versión sin motivo.
- Cancelar varios períodos a la vez.
- Reforzar en el servidor que un período `completed` no se cancele. Queda como riesgo, abajo.
- Tocar la vista por entrada (`PeriodDialog`), que ya describe estas operaciones en su spec.

## Decisions

**Elegibilidad como funciones puras en `presentation.ts` de la ruta.** `canCancel(entry,
canAdminister)` es `kind === 'opened'`, `cancelled_at === null` y `status !== 'completed'`.
`canReschedule(entry, canAdminister)` es `kind === 'opened'` y `cancelled_at !== null`.
Viven junto a `canMakeVisible`, con sus tests, y no en `src/permissions/`: la regla es
sobre el estado del período. El permiso sigue siendo `canAdministerScheduling`, que la
ruta ya recibe.

**`CancelPeriodDialog` nuevo en la ruta, adaptado del que se retiró en `1d009e6`.** Se
conserva lo que ese diálogo resolvía bien: la decisión primero y el motivo después,
`maxLength=500` y botón `button--danger` deshabilitado con el motivo vacío después de
`trim()`. Adopta el patrón de `MakeVisibleDialog` (props `inspection` y `label`, error en
un `notice--warn` con `role="alert"`, invalidar `scheduledInspections` y
`pendingInspections`). Se descartó restaurar el archivo tal cual: dependía de
`periodLabel` de `presentation/dates` y del layout de la consola vieja.

**Reprogramar reutiliza `OpenPeriodDialog`, no un diálogo propio.** Reprogramar ES abrir el
período: el mismo `POST`, la misma versión publicada hoy congelada y la misma opción de
visibilidad anticipada. Una prop opcional `rescheduling` cambia el título ("Schedule … again?")
y suma el texto de que la cancelación queda en el registro, junto con el
`cancellation_reason`. El `UnopenedPeriod` se arma desde la inspección cancelada (`site_id`,
`template_id`, `template_name`, `period_start`, `period_months`). Se descartó revivir
`ReopenPeriodDialog`: envolvía un `OpenPeriodForm` que ya no existe, y habría dos diálogos
con la misma mutación.

**"Cancel period" con `tone: 'danger'` en el `RowMenu`.** El tono marca lo que no se
deshace, que es exactamente para lo que existe (ver el docblock de `RowMenu`). "Schedule
again" va sin tono.

**La fila decide su menú por la lista de acciones, no por `rowControl`.** Hoy una fila
`read` (completada o cancelada) no muestra acción porque `actionLabel` devuelve `null`. El
menú ya se arma como lista y se oculta cuando queda vacía, así que alcanza con sumar las
dos entradas. `rowControl` no cambia de significado: sigue diciendo si hay que abrir o
asignar.

## Risks / Trade-offs

- [El servidor acepta cancelar un período `completed`] → la UI no lo ofrece y la spec lo
  exige solo a nivel de pantalla. Rechazarlo en el servidor es otro change (API + test de
  integración), fuera de este.
- [Dos pestañas reprograman el mismo mes a la vez] → el índice único parcial del período
  activo hace fallar al segundo `INSERT`. El error del servidor se lee en el diálogo, igual
  que al abrir.
- [La `key` de la fila cambia al reprogramar] → el diálogo cuelga de la ruta
  (`acting` en `index.tsx`), igual que `OpenPeriodDialog` hoy.

## Migration Plan

No hay. Es solo web, sin migración ni cambio de contrato. Para volver atrás alcanza con
revertir el commit.
