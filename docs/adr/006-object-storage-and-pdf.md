# ADR-006 — Almacenamiento de objetos y generación de PDF

|                             |                                                            |
| --------------------------- | ------------------------------------------------------------ |
| **Estado**                  | Aceptada                                                   |
| **Fecha**                   | 2026-08-06                                                 |
| **Supersede**               | —                                                          |
| **Superada por**            | —                                                          |
| **Referencias**             | `docs/requisitos-v1.2.md` R5; ADR-001, ADR-002, ADR-008    |
| **Changes que la consumen** | `offline-inspection-capture`, `recurrence-compliance-reporting` |

## Decisión

- Almacenamiento S3-compatible con **versioning activado** y sin ruta de borrado desde la
  aplicación. Coherente con la inmutabilidad global.
- Subida por presigned URL desde el dispositivo (ver ADR-001).
- Object Lock / retención si el proveedor elegido lo soporta — deseable, no bloqueante.
- PDF generado en el servidor con Playwright (HTML → PDF), hasheando el payload y no el
  archivo (ver ADR-002).

## Consecuencia sobre el hosting

Playwright necesita Chromium: la API no puede ir a serverless. Ver ADR-008.
