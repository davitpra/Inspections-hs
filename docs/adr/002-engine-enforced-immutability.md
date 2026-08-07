# ADR-002 — Inmutabilidad forzada por la base de datos, no event sourcing

|                             |                                                                     |
| --------------------------- | ------------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                            |
| **Fecha**                   | 2026-08-06                                                          |
| **Supersede**               | —                                                                   |
| **Superada por**            | —                                                                   |
| **Referencias**             | `docs/requisitos-v1.2.md` §2, §4 (LogDeAuditoría, RegistroSuplementario), R5 |
| **Changes que la consumen** | `bootstrap-immutable-persistence`, `corrective-action-lifecycle`, `recurrence-compliance-reporting` |

## Contexto

`docs/requisitos-v1.2.md` §2 lista "Event sourcing, log append-only, registros suplementarios"
como un solo costo. Son tres cosas distintas y solo dos son necesarias.

Lo que el dominio pide (§4): `LogDeAuditoría` append-only, `RegistroSuplementario` con
`supersedes_id`, y el progreso de `AcciónCorrectiva` como stream de eventos.

Lo que el dominio **no** pide: proyecciones, replay, CQRS, event store como fuente única
de verdad.

## Decisión

Modelo relacional normal, con inmutabilidad aplicada **a nivel de motor**:

- Rol de aplicación con `REVOKE UPDATE, DELETE` sobre las tablas inmutables.
- Triggers `BEFORE UPDATE OR DELETE` que levantan excepción, como segunda barrera.
- Rol separado exclusivo para migraciones.
- El estado actual de una `AcciónCorrectiva` es una consulta, no una columna:
  `SELECT DISTINCT ON (action_id) ... ORDER BY seq DESC`.

Con 24 inspecciones al año y 200 personas, el costo de performance de derivar estado es
irrelevante durante toda la vida útil del sistema.

## Cadena de hashes en el log de auditoría

Cada evento del `LogDeAuditoría` incluye el hash SHA-256 del evento anterior. Costo: bajo.
Beneficio: detección real de manipulación, no solo "confíen en nosotros", frente al MLITSD.

## Hash del PDF de cumplimiento (R5)

Se hashea el **payload canónico en JSON**, no los bytes del PDF. La generación de PDF vía
navegador headless no es reproducible byte a byte; el hash del PDF sería inverificable a los
seis meses. El hash del payload se imprime en el pie del PDF.

## Consecuencias

- Si la inmutabilidad vive solo en el código de la aplicación, no existe. La prueba de
  aceptación es intentar un `UPDATE` con el rol de la app y verificar que falla
  (spike 2 → change `bootstrap-immutable-persistence`).
- Las migraciones dejan de ser generadas automáticamente: son archivos SQL versionados que
  incluyen `REVOKE`, triggers y políticas.
