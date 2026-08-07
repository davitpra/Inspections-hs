# ADR-009 — Residencia de datos: sin exigencia de territorio canadiense

|                             |                                                          |
| --------------------------- | ---------------------------------------------------------- |
| **Estado**                  | Aceptada                                                 |
| **Fecha**                   | 2026-08-06                                               |
| **Origen**                  | S1 de `Stack_Tecnologico_V1.md`                          |
| **Supersede**               | —                                                        |
| **Superada por**            | —                                                        |
| **Referencias**             | `docs/requisitos-v1.2.md` riesgo G-bis; ADR-008, ADR-011 |
| **Changes que la consumen** | `bootstrap-immutable-persistence`, `identity-roster-csv-import` |

## Decisión

Confirmado con el cliente: **no se requiere alojamiento en Canadá.** Consistente con el
riesgo G-bis de `docs/requisitos-v1.2.md` (PIPEDA probablemente nunca aplicó a un invernadero
de jurisdicción provincial) y con la ausencia de detalle clínico en el sistema.

## Consecuencias

- La elección de hosting se hace por costo operativo, no por jurisdicción. Ver ADR-008.
- Se prefiere igualmente una región del este de Norteamérica por latencia.
- Desbloquea ADR-011: sin restricción de residencia, un IdP gestionado deja de tener contras.

## Condición de revisión

Si esto cambia (un contrato futuro, un cliente gubernamental), el impacto es acotado: mover
un contenedor y una base de datos. **No se construye nada hoy para anticiparlo.**
