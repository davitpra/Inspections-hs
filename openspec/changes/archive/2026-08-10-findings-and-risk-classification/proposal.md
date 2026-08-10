# Hallazgos y clasificación de riesgo

## Why

`submission-ingestion` dejó la línea escrita y vacía: en `submissions.service.ts`, después de
insertar las respuestas, hay un comentario que dice «AQUÍ VA LA DERIVACIÓN DE HALLAZGOS (etapa 4,
change `findings`)». Hoy una inspección con la mitad del checklist en `no` se congela, se audita y
no produce nada: el recorrido **R2** de `docs/Requisitos_V1.2.md` §3 no arranca, y el módulo
`actions` de la etapa 5 no tiene de dónde colgar una acción correctiva.

Este change cierra la **etapa 4** de §7 —«Hallazgos, clasificación de riesgo, jerarquía de
controles», con R1 y R2 como propiedad probada— y es el único change de esa etapa. Completa
además el paso que falta de la **costura crítica 1** de ADR-008: `insertar Respuestas → derivar
Hallazgos → escribir eventos`, todo en la misma transacción.

## Lo que este change NO es

**No es acciones correctivas.** El hallazgo clasificado es la entrada de la etapa 5; el
responsable nombrado, la fecha límite derivada de la severidad, el stream de eventos y los
escalamientos +3/+7 son el change siguiente. La consecuencia declarada: al terminar este change un
hallazgo queda registrado, ubicado, fotografiado y clasificado, y nadie tiene todavía la
obligación de arreglarlo.

**No es la detección de recurrencia.** Es la etapa 7. Acá se garantiza la materia prima —que
`item_key` viaje desde la respuesta hasta el hallazgo, y que un hallazgo manual declare que no la
tiene— pero no se escribe ninguna consulta de agrupación.

**No es el builder.** La regla de qué respuesta es negativa no se configura por ítem: es una
función del `response_type`, escrita en código y bajo tabla de casos. Un umbral configurable por
ítem sería una decisión del builder (riesgo B) y no está pedida por ningún requisito.

## What Changes

- **La derivación ocurre dentro de la transacción de ingesta**, en la línea que
  `submission-ingestion` dejó marcada. Un envío que produce hallazgos los produce todos o no se
  comete: no hay un manejador posterior que pueda perder la mitad de R2.
- **Qué es una respuesta negativa es una función pura de `packages/forms`**, el mismo código que
  corre en el dispositivo y en el servidor (ADR-007). En v1: `yes_no` en `false` y `yes_no_na` en
  `no`. **`na` no deriva hallazgo** —§4 lo dice explícitamente— y ningún otro tipo de respuesta
  deriva: `scale`, `number` y las selecciones no tienen semántica de cumplimiento sin una
  configuración que el builder no expone.
- **El payload del envío se extiende con un bloque `findings`**, por `item_key`: descripción,
  `location_id` del catálogo cerrado y las object keys de sus fotos. **BREAKING** sobre
  `inspectionSubmissionSchema`, que hasta hoy solo llevaba `answers` y `photos`. Es la única forma
  de que R2 se cumpla —«foto y descripción obligatorias»— con datos que solo existen en el campo:
  el coordinador clasifica días después y no estuvo ahí.
  Sin borradores en producción todavía, el cambio de forma no necesita convivencia de versiones.
- **La captura offline pide los tres datos al responder negativo**, en la misma pantalla y sin
  red: descripción, ubicación desde el catálogo ya precargado, y al menos una foto. Un envío al
  que le falte cualquiera de los tres se rechaza en el dispositivo antes de firmar, y también en
  el servidor.
- **Una respuesta negativa sin su bloque de hallazgo es `validation_failed`.** El código ya está
  en el conjunto de no reintentables del outbox: el dispositivo no va a reintentar para siempre un
  envío que le falta un dato.
- **Hallazgo de entrada manual**: `POST /findings` con descripción, ubicación, foto y
  clasificación, para lo que se ve fuera de una inspección —el casi-accidente presenciado del
  riesgo F—. Un hallazgo manual **no tiene `item_key`** y queda fuera de la recurrencia; es la
  consecuencia que §4 y el riesgo F ya aceptaron por escrito.
- **La clasificación es append-only, no una columna que se corrige.** Una tabla
  `finding_risk_assessment` inmutable, una fila por clasificación, con probabilidad, severidad y
  nivel de la jerarquía de controles. La vigente es la última; reclasificar es una fila nueva con
  motivo obligatorio. Un hallazgo sin ninguna fila está *sin clasificar*, que es un estado
  derivado de la ausencia y no un valor por defecto que alguien tenga que mantener.
- **El nivel de riesgo lo calcula una matriz probabilidad × severidad, dos veces.** Una función
  pura con tabla de casos en TypeScript, y una función inmutable de Postgres que alimenta una
  columna generada. La segunda existe porque la primera puede no ser el único camino a la tabla; un
  test de integración compara las 25 celdas de las dos, igual que 0007 compara el `CHECK` de
  `response_type` con el enum de `@hs/forms`.
- **Quién clasifica es el coordinador de HS.** El miembro del JHSC describe y ubica en el campo;
  clasificar es del coordinador (§3 R2, §4 roles).

## Capabilities

### New Capabilities

- `findings`: qué es un hallazgo, de dónde nace —derivado de una respuesta negativa o de entrada
  manual—, qué datos exige, cómo se clasifica por matriz de riesgo y jerarquía de controles, y qué
  se conserva para que la recurrencia de la etapa 7 pueda agrupar.

### Modified Capabilities

- `inspections`: el envío pasa a llevar el bloque `findings`; la ingesta pasa a derivar hallazgos
  en la misma transacción; una respuesta negativa sin su bloque es un envío rechazado.
- `offline-capture`: capturar un hallazgo sin red —descripción, ubicación del catálogo precargado
  y foto obligatoria— y no dejar firmar mientras falte alguno.
- `immutability`: `finding`, `finding_photo` y `finding_risk_assessment` entran a la lista de
  tablas que ningún rol —tampoco `hs_migrator`— puede modificar ni borrar.
- `audit`: tres tipos de evento nuevos —`finding.derived`, `finding.reported`,
  `finding.classified`— escritos por trigger, con la misma regla de doble reloj del riesgo C.

## Impact

- **Esquema**: migración `0010_findings.sql`. Crea `finding`, `finding_photo` y
  `finding_risk_assessment` con `hs_make_immutable`, `hs_apply_site_isolation`, las FK compuestas
  contra `(site_id, id)` de `location` e `inspection`, el `CHECK` de origen exactamente-uno, la
  restricción diferida de «al menos una foto», la función inmutable de la matriz y los triggers de
  auditoría. `GRANT SELECT, INSERT` y nada más.
- **`packages/forms`**: `negativeAnswers(document, answers)` — sin dependencias de Node, corre
  dentro del service worker.
- **`packages/contracts`**: `findings.ts` con las escalas, el nivel de control y la forma del
  hallazgo manual y de la clasificación; `submissions.ts` gana el bloque `findings`.
- **`apps/api/src/findings`**: módulo nuevo (`controller → service → repository` + funciones puras
  de matriz), consumido por `inspections` en la línea marcada. **La ingesta importa de
  `findings`**, que invierte la dirección que ADR-008 declaraba; el ADR lo registra ahora como
  excepción declarada de la costura crítica 1, porque la lista de pasos de esa costura es una
  transacción y no una secuencia de llamadas. Lo que sigue en pie es que `findings` no llama a
  `inspections`.
- **`apps/web`**: la pantalla de captura gana el sub-formulario de hallazgo, la tabla de Dexie de
  borradores gana sus campos, y la comprobación previa a firmar gana una condición.
- **Consumidores futuros**: `actions` (etapa 5) cuelga la acción correctiva del hallazgo y deriva
  la fecha límite de su severidad; `reporting` (etapa 7) agrupa por `item_key` y ubicación.
