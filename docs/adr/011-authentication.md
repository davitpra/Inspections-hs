# ADR-011 — Autenticación: better-auth dentro de apps/api

|                             |                                                     |
| --------------------------- | ----------------------------------------------------- |
| **Estado**                  | Aceptada                                            |
| **Fecha**                   | 2026-08-06                                          |
| **Origen**                  | S3 de `Stack_Tecnologico_V1.md`                     |
| **Supersede**               | —                                                   |
| **Superada por**            | —                                                   |
| **Referencias**             | `docs/requisitos-v1.2.md` §6 (Autenticación), riesgo I; ADR-001, ADR-009 |
| **Changes que la consumen** | `identity-roster-csv-import`, `offline-inspection-capture` |

## Contexto

Desbloqueada por ADR-009. Sin restricción de residencia, un IdP gestionado deja de tener
contras. Aun así, con 15–20 usuarios internos, sin SSO corporativo del lado del cliente y sin
registro público, la opción de menor superficie es **better-auth dentro de `apps/api`**, sobre
la misma Postgres.

## Decisión

- Email + contraseña, invitación por el coordinador de HS. Sin auto-registro.
- TOTP obligatorio para coordinador y gerencia; opcional para el resto.
- Sesión con `user_id`, `person_id` y `site_scope[]`, de vida corta con refresh.
- Sin cuentas compartidas entre miembros del JHSC — el `actor_id` del log de auditoría tiene
  que identificar a una persona real o la inmutabilidad no prueba nada.

## Requisito derivado del offline

La sesión tiene que sobrevivir a un recorrido de varias horas sin red y a un envío diferido.
El token que acompaña al submit puede estar vencido al momento de sincronizar.

**Refresh silencioso al recuperar conexión, antes de vaciar el outbox, y nunca descartar una
entrada del outbox por un 401.**

## Ciclo de vida del auditor externo

Cerrado en `docs/requisitos-v1.2.md` riesgo I: cuenta creada por el coordinador, `expires_at`
obligatorio (30 días por defecto, 90 máximo), revocable, y **con las lecturas registradas en
el log de auditoría** — única excepción a no loguear lecturas en el sistema.
