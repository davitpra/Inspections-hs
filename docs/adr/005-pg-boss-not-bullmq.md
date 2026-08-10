# ADR-005 — pg-boss, no BullMQ + Redis

|                             |                                                    |
| --------------------------- | ---------------------------------------------------- |
| **Estado**                  | Aceptada                                           |
| **Fecha**                   | 2026-08-06                                         |
| **Supersede**               | —                                                  |
| **Superada por**            | —                                                  |
| **Referencias**             | `docs/requisitos-v1.2.md` R3; ADR-008              |
| **Changes que la consumen** | `corrective-action-lifecycle`, `incident-reporting` |

## Contexto y decisión

Los trabajos programados del sistema son:

- Escalamiento de acciones vencidas: +3 días al supervisor, +7 días a gerencia (R3).
  **Implementado** en `actions.escalate-overdue` (change `corrective-action-lifecycle`),
  con la idempotencia en el único `(action_id, level)` y no en el handler.
- Apertura de inspecciones del período por sitio.
- Notificaciones al coordinador de HS.

Todo eso es un cron diario sobre decenas de filas. `pg-boss` corre sobre la misma base
Postgres y elimina Redis del diagrama de infraestructura. Con un solo desarrollador, cada
pieza de infraestructura menos es una fuente de incidentes menos.

## Condición de revisión

Se revisa si aparece un requisito de latencia sub-minuto. Hoy no existe.
