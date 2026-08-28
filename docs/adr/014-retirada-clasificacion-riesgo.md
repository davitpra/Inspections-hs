# ADR-014 — Retirada preproducción de la clasificación de riesgo

|                             |                                                                 |
| --------------------------- | --------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                        |
| **Fecha**                   | 2026-08-28                                                      |
| **Supersede**               | —                                                               |
| **Superada por**            | —                                                               |
| **Referencias**             | `docs/Requisitos_V1.2.md` §3 R2, §4, §7; ADR-002, ADR-004, ADR-007, ADR-008, ADR-013 |
| **Changes que la consumen** | `retirar-clasificacion-de-riesgo`                               |

## Contexto

La clasificación de riesgo del hallazgo —matriz de probabilidad por severidad y nivel de la
jerarquía de controles— se retira antes de cualquier despliegue con datos de producción. La base
de desarrollo no contiene evaluaciones de riesgo ni acciones correctivas, y los hallazgos
existentes están sin clasificar. No queda un consumidor operativo que justifique conservar esta
superficie.

La severidad también deja de ser una propiedad de `corrective_action`: el plazo ya no se deriva de
una escala escrita en código, sino que el coordinador de HS declara `due_at` al abrir la acción.
Los hallazgos derivados pueden recibir una acción sin una clasificación previa.

## Decisión

Se elimina la superficie vigente de clasificación de riesgo: el contrato, el endpoint
`POST /findings/:id/risk-assessments`, la tabla `finding_risk_assessment`, la función
`hs_risk_level` y su gemela pura. También se elimina `corrective_action.severity` y se conserva solo
la fecha `due_at` declarada por el coordinador, validada como futura al crear la acción y congelada
por la inmutabilidad del motor.

La migración destructiva solo es válida bajo la precondición preproducción: la base contiene datos
de desarrollo y no evidencia regulatoria de producción. Fuera de esa precondición se debe detener
el despliegue y revisar la decisión antes de migrar.

La migración reemplaza primero `hs_action_audit()` para que deje de leer `NEW.severity`, después
elimina `corrective_action.severity`, elimina `finding_risk_assessment` y finalmente elimina sus
funciones de guarda, auditoría y cálculo. No escribe, borra ni reescribe ninguna fila de
`audit_log`.

Los eslabones históricos de `audit_log`, incluidos los payloads `finding.classified`, se conservan
intactos aunque apunten a una tabla retirada. Describen hechos pasados y no representan una
capacidad vigente.

La eliminación de la tabla y de la columna es DDL del esquema, no el borrado de registros del
dominio. ADR-002 continúa gobernando la inmutabilidad de las tablas supervivientes, y ADR-004
continúa gobernando su aislamiento por sitio mediante RLS.

## Consecuencias

- Un hallazgo ya no tiene clasificación de riesgo ni nivel de jerarquía de controles.
- Una acción correctiva ya no tiene severidad ni plazo derivado; cada creación declara su `due_at`.
- Se conserva el escalamiento, la máquina de estados, la evidencia, la verificación por un tercero,
  la recurrencia y la cadena histórica de `audit_log`.
- Los payloads y las migraciones históricas pueden seguir mencionando la clasificación; esas
  menciones no son superficie vigente y no se reescriben.
- La decisión no introduce otra métrica, etiqueta o prioridad para sustituir la clasificación.
