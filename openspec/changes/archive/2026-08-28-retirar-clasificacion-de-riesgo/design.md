## Context

Ver `proposal.md` — Why. Lo que condiciona el cómo:

- La clasificación vive en una tabla **inmutable** (`finding_risk_assessment`: REVOKE
  UPDATE/DELETE, RLS por sitio, triggers de guarda y de auditoría, migración 0010), y la
  severidad que produce está **congelada** en una columna de `corrective_action`
  (migración 0011), que también es inmutable.
- La matriz está escrita dos veces a propósito: `apps/api/src/findings/risk.ts` y
  `hs_risk_level()` en 0010, con un test de integración que compara las 25 celdas.
- Aguas abajo casi no hay nada: ninguna pantalla, reporte ni notificación lee
  `risk_level`, `probability` ni `control_level`. El único consumidor de la severidad
  fuera de `findings` es `dueAt()`, y el escalamiento +3/+7 mira solo `due_at`.
- La base de desarrollo tiene 0 filas en `finding_risk_assessment` y 0 en
  `corrective_action`. Los tres hallazgos existentes están sin clasificar.

## Goals / Non-Goals

**Goals:**

- Que no quede ningún resto de la clasificación: ni tabla, ni función, ni escala, ni
  campo en un contrato de lectura.
- Que abrir una acción correctiva sobre un hallazgo recién derivado funcione.
- Que la retirada no toque una sola fila de `audit_log`.

**Non-Goals:**

- No se construye la pantalla que abre acciones correctivas. `createAction` y
  `createInvestigationAction` siguen sin llamador en `apps/web`; este change solo ajusta
  su firma. La pantalla es un change aparte.
- No se reemplaza la clasificación por otra métrica, etiqueta ni prioridad.
- No se toca la detección de recurrencia, que responde una pregunta distinta.

## Decisions

**1. Eliminación destructiva, no `deactivated_at`.** El invariante «nunca DELETE» de
ADR-002 gobierna los REGISTROS del dominio, no el esquema. Retirar una capability es DDL
del migrador, y ya hay precedente en ADR-013: se elimina la tabla entera bajo precondición
preproducción. La alternativa —dejar la tabla huérfana y sin endpoint— deja un esquema que
miente sobre lo que el sistema hace.

**Este change toca tablas inmutables:** elimina `finding_risk_assessment` completa y
elimina la columna `severity` de `corrective_action`. Ninguna de las dos operaciones
escribe ni reescribe filas: la primera borra la tabla, la segunda es un `ALTER`. Los
REVOKE, políticas RLS y triggers de las tablas supervivientes quedan como estaban.

**2. `due_at` explícito en vez de una severidad explícita.** La opción descartada era
conservar `severity` y pedírsela al coordinador al abrir la acción, como hace hoy el
camino de investigación. Se descarta porque deja en pie una escala de riesgo de cinco
niveles —lo mismo que se está retirando— disfrazada de campo de plazo, y porque
`DUE_DAYS_BY_SEVERITY` es «configuración escrita en código, no una regla legal», según su
propio comentario. Pedir la fecha dice exactamente lo que el coordinador se compromete a
hacer, sin intermediario.

**3. Un solo contrato de creación.** `createInvestigationActionRequestSchema` existía
únicamente porque una investigación no tenía clasificación de la que sacar la severidad.
Sin severidad, los dos cuerpos son idénticos, así que se elimina el segundo esquema y
ambos endpoints usan `createActionRequestSchema`. El padre sigue viviendo en la ruta y en
el `CHECK` de un solo padre.

**4. «La fecha es futura» es una regla del servicio, y se dice.** No puede ser un `CHECK`
—`now()` no es `IMMUTABLE`— ni puede vivir en `packages/contracts`, que no lee el reloj
(ADR-007, y la regla de `eslint.config.js` sobre `actions.ts`). Queda como comprobación
explícita en `ActionsService` contra `new Date()`, con su propio código `invalid_due_at`.
Es una de las pocas garantías del módulo que el motor no duplica, y el comentario del
servicio debe decirlo en vez de sugerir lo contrario.

**5. La jerarquía de controles se va con la clasificación.** `CONTROL_LEVELS` vivía en
`packages/forms/src/document/controls.ts` desde antes; la migración 0024 ya retiró el nivel
**prescrito** del documento de plantilla, así que la clasificación era su último consumidor.
El archivo se elimina en vez de quedar como vocabulario sin usuario.

**6. `hs_action_audit()` se reemplaza antes de dropear la columna.** El trigger de
auditoría de `corrective_action` construye su payload con `NEW.severity`. Se hace
`CREATE OR REPLACE` primero y el `DROP COLUMN` después, dentro de la misma migración, para
que no exista un instante en que un INSERT quede sin eslabón.

## Risks / Trade-offs

- **Se pierde el plazo derivado de la severidad, que era la parte del sistema que
  empujaba a atender antes lo grave** → mitigación: ninguna automática. Es la
  consecuencia aceptada de la decisión; queda registrada en el ADR para que el día que
  alguien pida «priorizar acciones» se sepa qué se retiró y por qué.
- **La migración es destructiva y solo es válida preproducción** → mitigación: la
  precondición se escribe en el ADR y en la cabecera de la migración, igual que en
  ADR-013. Si la base tiene evidencia regulatoria, se detiene el despliegue.
- **Los payloads históricos `finding.classified` de `audit_log` quedan apuntando a una
  tabla que ya no existe** → mitigación: es exactamente lo que ADR-013 decidió para R5.
  La cadena se conserva y sigue verificando; un payload histórico describe lo que pasó,
  no lo que hoy se puede hacer.
- **`GET /findings` y los dos endpoints de creación de acción cambian de forma** →
  mitigación: los únicos clientes son `apps/web` y `demo-content.mjs`, los dos en este
  repositorio y los dos actualizados en este change.

## Migration Plan

1. Migración forward `0037_retire_risk_classification.sql` con su entrada de journal, en
   este orden: reemplazar `hs_action_audit()`, dropear `corrective_action.severity`,
   dropear `finding_risk_assessment`, dropear `hs_finding_assessment_guard()`,
   `hs_finding_assessment_audit()` y `hs_risk_level(text, text)`.
2. Sin rollback por migración: la tabla retirada no se recrea. La reversión es el reverso
   del despliegue completo desde el commit anterior, válida solo mientras la precondición
   preproducción siga siendo cierta.
3. Sin backfill: no hay ningún dato que trasladar. Las acciones existentes en la base de
   desarrollo son cero; si en un entorno de desarrollo hubiera alguna, pierde su columna
   `severity` y conserva su `due_at`.
