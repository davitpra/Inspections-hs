## Why

El reporte de cumplimiento R5 agrega una superficie regulatoria, persistencia inmutable y una cadena de renderizado PDF que ya no forman parte del producto deseado. Retirarlo ahora evita sostener una capacidad sin uso antes de desplegar datos reales, sin eliminar la planificación periódica ni el reporte de recurrencia de hallazgos que sí siguen en alcance.

Este change no cierra una etapa nueva de `Requisitos_V1.2.md` §7: revierte la porción R5 declarada completa en la etapa 7 y actualiza el documento de requisitos para que el alcance vigente deje de exigirla.

## What Changes

- **BREAKING** Eliminar la página `/compliance`, su navegación y todas las operaciones de consulta, generación, listado y descarga de reportes de cumplimiento.
- **BREAKING** Eliminar los endpoints `GET /reports/compliance`, `GET /reports/compliance/list`, `POST /reports/compliance`, `GET /reports/compliance/:id` y `GET /reports/compliance/:id/pdf`.
- **BREAKING** Eliminar los contratos de cobertura, payload congelado, digest, reporte y render; conservar en un módulo neutral los contratos compartidos de frecuencia, estado y etiqueta de períodos.
- **BREAKING** Eliminar el trabajo `reporting.render-compliance-pdf`, el render con Playwright, los helpers de almacenamiento del PDF y el verificador independiente de digest.
- **BREAKING** Eliminar mediante una migración forward las tablas `compliance_report` y `compliance_report_render` y sus funciones de auditoría. La eliminación destructiva se acepta porque no existen datos de producción; los eventos ya escritos en `audit_log` no se reescriben ni se borran para preservar la cadena hash.
- Eliminar de desarrollo los objetos S3 bajo `{site_id}/reports/` mediante credenciales administrativas, sin conceder `DeleteObject` a la aplicación.
- Conservar la frecuencia de inspección, la proyección de períodos debidos, los estados `completed`, `missed`, `cancelled` y `open`, y `GET /findings/recurrence`.
- Retirar Playwright y Chromium de dependencias, CI, configuración y documentación.
- Modificar `docs/Requisitos_V1.2.md` para retirar R5 y actualizar la documentación y decisiones arquitectónicas mediante un ADR posterior.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `reporting`: retira la cobertura agregada, los reportes congelados, el digest, el PDF y la vista de cumplimiento; conserva íntegramente la recurrencia de hallazgos.
- `inspections`: desacopla el estado y la etiqueta de los períodos del reporte eliminado, conserva su uso operativo y retira la proyección sintética exclusiva de cobertura.
- `audit`: retira la producción de eventos de generación y render de reportes, sin alterar ni borrar eventos históricos de la cadena.
- `immutability`: retira las garantías aplicables a las dos tablas eliminadas, sin modificar las garantías del resto del modelo.

## Impact

- Web: `ComplianceRoute`, cliente API, router, navegación, permisos, query keys, estilos y tests asociados.
- API: controller y módulo de reporting, servicio y SQL de compliance, generación de payload/digest, render PDF, job de pg-boss, almacenamiento y tests de integración.
- Contratos: separación de conceptos de período compartidos y eliminación de esquemas exclusivos del reporte y de canonical JSON sin consumidores restantes.
- Persistencia: nueva migración destructiva posterior a `0014_compliance_reports.sql`; el historial de migraciones y `audit_log` permanecen intactos.
- Infraestructura: eliminación de Playwright/Chromium y limpieza administrativa de objetos PDF; S3 y pg-boss permanecen para evidencia fotográfica y otros trabajos.
- Producto y documentación: retirada de R5 de `docs/Requisitos_V1.2.md`, actualización de README, OpenSpec, configuración y un ADR que registra la decisión de desmantelamiento.
