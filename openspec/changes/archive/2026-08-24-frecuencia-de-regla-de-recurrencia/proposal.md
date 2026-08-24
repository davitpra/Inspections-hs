## Why

Una regla de recurrencia no tiene frecuencia. La mensualidad no está declarada en ningún
lado: vive repartida entre la columna generada `period_end` de `scheduled_inspection`
(`period_start + 1 month - 1 day`), el `INSERT` del trabajo de apertura, el CTE `months`
del reporte de cumplimiento y las doce casillas de `monthsOfYear()` en la consola.

La consecuencia práctica es que **cualquier plantilla que entre al sistema se vuelve una
obligación mensual por el solo hecho de tener una regla**. Una auditoría anual o una
revisión trimestral no se pueden expresar: el trabajo las reclamaría doce veces al año, y
el reporte que se le entrega al MLITSD declararía once incumplimientos que nadie cometió.
La propia migración 0008 dejó el hueco anotado —«sin columna de frecuencia […] el día que
haya semanal, ese change agrega la columna»— y la alternativa que descartó por escrito
—abrir una ocurrencia por cada plantilla publicada— falla exactamente por esto.

Es un arreglo dentro de la **etapa 4** de §7 (la programación de inspecciones): no abre
etapa nueva, completa el modelo que esa etapa dejó a medias. `openspec/config.yaml` no
pone la frecuencia fuera de alcance en v1.

## What Changes

- Una regla declara `frequency_months` (1, 3, 6 o 12) y `anchor_month` (1-12). Debe un
  período que empieza en el mes `M` cuando `(M - anchor_month) mod frequency_months = 0`.
- **El período se estira.** Una regla trimestral abre UNA inspección con
  `period_start = 2026-01-01` y `period_end = 2026-03-31`, no tres mensuales ni una de
  enero que en realidad cubre el trimestre. `scheduled_inspection` gana `period_months`,
  copiado de la regla al abrir, y `period_end` pasa a derivarse de él.
- **La frecuencia y el ancla son inmutables.** Entran al array `frozen` del trigger de
  guarda y quedan fuera del `GRANT UPDATE`. Cambiarlas es desactivar la regla y crear otra.
- El trabajo de apertura calcula el inicio del período que **contiene** al mes corriente,
  no «hoy es un mes ancla»: sin eso, un trimestre cuyo primer mes pasó con el planificador
  caído no se abriría nunca, y se perdería la propiedad de recuperación de ADR-005.
- El CTE `owed` del reporte genera un período por serie y no uno por mes, así que un año
  trimestral reporta «4 de 4» y no «4 de 12».
- Un período se nombra con `periodLabel()` en `@hs/contracts` —`Q1 2026`, `H2 2026`,
  `2026`, `Feb–Apr 2026`— y lo usan las cuatro pantallas **y el PDF regulatorio**.

Fuera de alcance, y su ausencia es estructural: **semanal y quincenal**. Un período
semanal no empieza el día 1 de un mes, así que rompería el CHECK de `period_start`, el
calendario anual de la consola y el CTE del reporte. Es otro change y toca mucho más que
una columna.

## Capabilities

### Modified Capabilities

- `inspections` — la regla declara frecuencia y ancla; la ocurrencia declara su largo.
- `reporting` — lo que el sitio debía se cuenta por período de la serie, no por mes.
