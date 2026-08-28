## Why

La etapa 4 de requisitos-v1.2 §7 construyó la clasificación de riesgo del hallazgo —matriz
de probabilidad × severidad y nivel de la jerarquía de controles— como paso obligatorio
entre un hallazgo y su acción correctiva. Evaluar el riesgo de un hallazgo no es trabajo
que este sistema deba hacer: la clasificación se retira antes de cualquier despliegue con
datos de producción, y con ella la severidad como fuente del plazo de la acción.

Hoy el paso obligatorio es además un bloqueo: los hallazgos derivados nacen sin clasificar
y no hay forma de abrir una acción correctiva sobre ellos.

## What Changes

- Eliminar la superficie completa de clasificación de riesgo: tabla
  `finding_risk_assessment`, la función `hs_risk_level` y su gemela pura `risk.ts`, el
  endpoint `POST /findings/:id/risk-assessments`, y los contratos de `probability`,
  `severity`, `risk_level` y `control_level`.
- **BREAKING** — Un hallazgo deja de tener clasificación. `GET /findings` y
  `GET /findings/:id` ya no devuelven `assessment`, y `POST /findings` (hallazgo manual)
  ya no acepta ni exige `classification`.
- **BREAKING** — Una acción correctiva deja de tener severidad. La fecha límite la escribe
  el coordinador al abrirla (`due_at` en el cuerpo) y sigue congelada en la fila; se
  eliminan `dueAt()` y la tabla de días por severidad.
- Unificar los dos contratos de creación de acción: la única diferencia entre el camino de
  hallazgo y el de investigación era la severidad, así que pasan a compartir uno solo.
- Conservar intactos el escalamiento +3/+7, la máquina de estados, la evidencia, la
  verificación por un tercero y la detección de recurrencia — ninguno leyó nunca la
  clasificación.
- Conservar `audit_log` sin borrar ni reescribir una sola fila, aunque los eslabones
  históricos `finding.classified` apunten a una tabla retirada.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `findings`: se retiran los requisitos de cadena de clasificación, matriz del motor,
  nivel de jerarquía de controles y rol que clasifica; el hallazgo manual deja de nacer
  clasificado.
- `actions`: el plazo deja de derivarse de la severidad del hallazgo y pasa a ser una
  fecha declarada por el coordinador y congelada al crear la acción; abrir una acción ya
  no exige clasificación previa.

## Impact

- `packages/contracts`: `findings.ts`, `actions.ts` y `notifications.ts` pierden las
  escalas de riesgo, la severidad y el cálculo de plazos.
- `packages/forms`: `document/controls.ts` queda sin consumidor y se elimina.
- `apps/api/src/findings`: se eliminan `risk.ts`, `classify()` y el endpoint de
  clasificación.
- `apps/api/src/actions`: desaparece `requireClassifiedFinding()` y la severidad deja de
  viajar al repositorio.
- Esquema: migración destructiva que elimina `finding_risk_assessment`, sus funciones y la
  columna `corrective_action.severity`. Válida **solo** bajo la precondición preproducción
  de ADR-013; fuera de ella hay que detener el despliegue y revisar la decisión.
- `apps/web`: solo la línea de severidad del detalle de una acción y los clientes HTTP;
  ninguna pantalla mostraba `risk_level`, `probability` ni `control_level`.
- Documentación: nuevo ADR de retirada y corrección de R2, la entidad Hallazgo y la etapa
  4 en `docs/Requisitos_V1.2.md`.
- Sin dependencias nuevas y sin dependencias retiradas.
