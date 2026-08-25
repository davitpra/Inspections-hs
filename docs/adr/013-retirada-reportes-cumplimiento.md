# ADR-013 — Retirada preproducción del reporte de cumplimiento

|                             |                                                        |
| --------------------------- | ------------------------------------------------------ |
| **Estado**                  | Aceptada                                               |
| **Fecha**                   | 2026-08-24                                             |
| **Supersede**               | —                                                      |
| **Superada por**            | —                                                      |
| **Referencias**             | `docs/Requisitos_V1.2.md` §7; ADR-002, ADR-004, ADR-005, ADR-006, ADR-008 |
| **Changes que la consumen** | `retirar-reportes-de-cumplimiento`                    |

## Contexto

El reporte de cumplimiento R5 se retira antes de cualquier despliegue con datos de
producción. No quedan consumidores externos que requieran conservar su UI, sus cinco rutas
HTTP, sus PDFs o su modelo persistido. La recurrencia de hallazgos y la programación de
inspecciones siguen siendo capacidades operativas distintas.

## Decisión

Se elimina la superficie R5 completa: página, navegación, contratos de reporte, generación,
digest, render PDF, trabajo de pg-boss, helpers de almacenamiento y las tablas
`compliance_report` y `compliance_report_render`. La migración forward elimina primero la tabla
hija y después la padre, además de sus funciones de auditoría. Los registros existentes de
`audit_log` no se borran ni se reescriben: la cadena histórica se conserva aunque sus payloads
apunten a recursos de desarrollo ya retirados.

La eliminación destructiva solo es válida bajo la precondición preproducción de este change:
la base contiene datos de desarrollo y no evidencia regulatoria de producción. Fuera de esa
precondición se debe detener el despliegue y revisar la decisión antes de migrar.

Los objetos bajo `{site_id}/reports/` se purgan administrativamente, incluidas sus versiones,
sin añadir `DeleteObject` ni un método de borrado a la aplicación. El almacenamiento de
evidencia conserva uploads, versioning y URLs firmadas de escritura.

Playwright y Chromium dejan de ser restricciones de runtime y hosting porque ningún flujo
superviviente genera documentos. La API sigue en un contenedor por sus otras necesidades,
pero ya no por un navegador headless.

## Consecuencias

- R5 deja de ser alcance vigente; no se reemplaza por otra métrica o exportación.
- La frecuencia, el estado derivado y la etiqueta de los períodos viven en un contrato neutral.
- `reporting` conserva únicamente `GET /findings/recurrence`.
- ADR-002, ADR-004, ADR-005, ADR-006 y ADR-008 siguen gobernando las tablas, trabajos y objetos supervivientes; este ADR delimita únicamente la retirada preproducción.
