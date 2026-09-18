## 1. Cliente de la API

- [x] 1.1 En `apps/web/src/api/inspections.ts`, restaurar `cancelScheduledInspection(id, reason)`
  junto a `makeScheduledInspectionVisible`: `POST /scheduled-inspections/${id}/cancel` con
  `{ reason }`, parseado con `scheduledInspectionSchema`. Tomar la versión de `1d009e6^`
  con su docblock ("un período no se des-cancela, se reprograma").

## 2. Reglas puras de la ruta

- [x] 2.1 En `apps/web/src/routes/ScheduleRequirementRoute/presentation.ts`, agregar
  `canCancel(entry, canAdminister)` (abierto, `cancelled_at === null`, `status !== 'completed'`)
  y `canReschedule(entry, canAdminister)` (abierto y `cancelled_at !== null`). Los dos
  devuelven `false` sin `canAdminister` (design: "Elegibilidad como funciones puras").
- [x] 2.2 En `presentation.test.ts`, casos para `open`, `missed`, `completed`, cancelado, no
  abierto y sin permiso, para cada función.

## 3. Diálogos

- [x] 3.1 Crear `routes/ScheduleRequirementRoute/CancelPeriodDialog.tsx` con el patrón de
  `MakeVisibleDialog`: props `inspection` y `label`, título "Cancel {label}?", texto de que no
  se deshace y de que el período se programa de nuevo, `<label htmlFor>` + `<textarea
  maxLength={500}>`, botón `button--danger` "Confirm cancellation" deshabilitado con
  `reason.trim() === ''` o mientras está pendiente, y "Keep this period" para cerrar.
  En éxito, invalidar `scheduledInspections` y `pendingInspections` y cerrar. En error,
  `notice--warn` con `role="alert"`. Sin actualización optimista.
- [x] 3.2 En `OpenPeriodDialog.tsx`, agregar la prop opcional `rescheduling?: { reason: string | null }`.
  Con ella, el título es "Schedule {label} again?", se agrega el texto "The cancellation
  stays on the record…" y se muestra "Cancelled: {reason}" si hay motivo. Lo demás (versión
  congelada, visibilidad anticipada, mutación) no cambia.

## 4. Fila y ruta

- [x] 4.1 En `RequirementPeriodRow.tsx`, ampliar `onAct` a `'open' | 'assign' | 'visible' |
  'cancel' | 'reschedule'` y sumar al arreglo `actions` "Cancel period" (`tone: 'danger'`,
  si `canCancel`) y "Schedule again" (si `canReschedule`). Pasarle a la fila lo que esas
  funciones necesitan (ya recibe `canAdminister`).
- [x] 4.2 En `index.tsx`, ampliar el tipo de `acting.kind` y montar `CancelPeriodDialog`
  (`acting.kind === 'cancel'`, entrada abierta) y `OpenPeriodDialog` con `rescheduling`
  (`acting.kind === 'reschedule'`). Para este último, armar el `UnopenedPeriod` desde la
  inspección cancelada y pasar `publishedVersion`, con `key={entryKey(acting.entry)}`.
- [x] 4.3 Actualizar el docblock de `RequirementPeriodRow` para que nombre las cinco
  acciones del menú.

## 5. Tests de la ruta

- [x] 5.1 En `routes/ScheduleRequirementRoute/index.test.tsx`: el menú de un período `open`
  ofrece "Cancel period", y el de uno `completed` no.
- [x] 5.2 Con el motivo vacío o solo espacios no se envía la petición; con motivo, se hace
  un solo `POST …/cancel` con `{ reason }` y la fila pasa a "Cancelled" con el motivo.
- [x] 5.3 Un error del servidor al cancelar se lee en el diálogo y la fila conserva su estado.
- [x] 5.4 El menú de un período cancelado ofrece "Schedule again". Al confirmarlo se hace un
  `POST /scheduled-inspections` con el mismo `site_id`, `template_id` y `period_start`, y la
  fila pasa a presentar la inspección nueva.
- [x] 5.5 Una cuenta `inspector` no ve ninguna de las dos acciones.

## 6. Verificación

- [x] 6.1 `pnpm lint`, `pnpm -r build`, `pnpm typecheck` y los tests de `apps/web` de la
  ruta (cuando el usuario lo pida).
- [ ] 6.2 En el navegador, como `demo.management@example.com`: cancelar octubre del requisito
  mensual de St. Thomas con motivo, comprobar que sale de "My inspections" y reprogramarlo.
