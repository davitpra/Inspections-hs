## 1. `created_at` en la regla

- [x] 1.1 Añadir `created_at` a `inspectionScheduleSchema` en `packages/contracts/src/inspections.ts`, con el mismo criterio que `deactivated_at` (`z.iso.datetime({ offset: true })`, no nulo).
- [x] 1.2 Añadir `s.created_at` a `SCHEDULE_SELECT`, a `ScheduleRow` y a `toSchedule` en `apps/api/src/inspections/inspections.service.ts`.
- [x] 1.3 Cubrir en el test de integración de scheduling que la regla listada trae `created_at` con el instante en que se creó.

## 2. La proyección del año (lógica pura)

- [x] 2.1 En `presentation.ts`, `civilMonth(instant, timeZone)` — el `YYYY-MM` de un instante ISO en `America/Toronto`, con `Intl` y no con aritmética de offsets, igual que `civilDate` en `apps/api/src/inspections/period.ts`.
- [x] 2.2 `ruleOwesMonth(rule, periodStart)` — la ventana `created_at`..`deactivated_at` resuelta en meses civiles, inclusiva en los dos extremos.
- [x] 2.3 `projectYear(rules, periods, year)` — una entrada por regla vigente (`currentRules`) y por mes que esa regla debe, de enero a diciembre; la fila real donde existe una y una casilla `unopened` con `site_id`, `template_id` y `period_start` donde no. Los períodos que ninguna regla reclama se agregan a su mes en vez de descartarse.
- [x] 2.4 `earliestEligibleYear(...)` / la navegación: el año en curso, los años con períodos existentes, y sin tope hacia adelante.
- [x] 2.5 Borrar `groupByYear` y sus tests; `monthName` se conserva.
- [x] 2.6 Tests en `presentation.test.ts` para cada uno: año completo con la mitad abierta, año futuro entero sin abrir, mes anterior a `created_at` no proyectado, mes posterior a `deactivated_at` no proyectado, período huérfano de regla desactivada igual visible, período cancelado que no cuenta como "no abierto", y el borde de zona horaria de 2.1 (el mismo caso que el test del servidor).

## 3. Abrir un mes desde su casilla

- [x] 3.1 Exponer en `apps/web/src/api/inspections.ts` el `POST /inspections/scheduled-inspections` que ya existe en el servidor, tipado con `createScheduledInspectionSchema`.
- [x] 3.2 `UnopenedPeriodRow.tsx` — la casilla vacía: el mes, "Not opened yet", y para el coordinador el control que la abre (con inspector opcional, reutilizando el selector de candidatos de `PeriodControls`).
- [x] 3.3 La mutación invalida `queryKeys.scheduledInspections()`; el control queda deshabilitado mientras corre y el error del servidor se muestra donde el resto de la ruta ya muestra los suyos.
- [x] 3.4 Antes de crear, decir qué versión se congela: el control nombra la versión publicada hoy, porque es la que la fila va a llevar para siempre.
- [x] 3.5 Nada de esto se renderiza cuando `canAdminister` es falso.

## 4. La sección

- [x] 4.1 Reescribir `PeriodsSection.tsx` sobre `projectYear`: encabezado con el año y los controles de año anterior / siguiente, y dentro los meses en orden.
- [x] 4.2 El año elegido es estado local de `index.tsx` (inicializado en el año en curso en `America/Toronto`), y se pasa a la sección.
- [x] 4.3 Estilos de la casilla vacía en `index.css` usando la capa semántica de tokens; `pnpm --filter web build` tiene que seguir pasando `check-tokens.mjs`.

## 5. Verificación

- [x] 5.1 `index.test.tsx`: el año en curso muestra doce meses con la mitad sin abrir, la flecha adelante lleva a un año entero sin abrir, y abrir un mes futuro desde su casilla lo convierte en un período con inspector.
- [x] 5.2 `index.test.tsx`: un `jhsc_member` ve la proyección completa y ningún control de apertura.
- [x] 5.3 `pnpm -r build && pnpm typecheck && pnpm lint && pnpm test`, y `pnpm --filter api test:int` por el cambio de 1.2.
