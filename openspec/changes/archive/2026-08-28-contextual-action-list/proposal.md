## Why

La etapa 5 de requisitos-v1.2 §7 implementó el ciclo de vida de acciones correctivas, pero su listado no identifica el sitio, la persona asignada ni el origen del trabajo. La ruta tampoco permite separar el trabajo activo por plantilla, por lo que no sirve todavía como cola operativa para priorizar remediaciones.

## What Changes

- Reemplazar el listado plano de acciones correctivas por una tabla ordenada por vencimiento.
- Mostrar el sitio, la persona asignada y una fuente que distinga plantillas de inspección, hallazgos manuales e investigaciones de incidentes.
- Permitir filtrar en el cliente por estado, fuente y sitio sin ocultar por defecto acciones válidas de fuentes no relacionadas con inspecciones.
- Hacer que el listado de la API devuelva resúmenes livianos, conservando el historial y la evidencia completos solo en el detalle.
- Mantener el listado exclusivamente online y el aislamiento por sitio mediante las políticas RLS existentes.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `actions`: el listado de acciones incorpora contexto operativo, fuentes discriminadas y una representación resumida para la tabla.

## Impact

- `packages/contracts`: nuevo contrato de resumen para listados de acciones.
- `apps/api/src/actions`: consulta enriquecida con el contexto de sitio, responsable y origen.
- `apps/web/src/routes/ActionsRoute`: tabla, filtros y lógica pura de presentación.
- `GET /actions`: cambia de una lista de detalles completos a una lista de resúmenes; el endpoint de detalle no cambia.
- No se agregan dependencias ni se modifica el esquema de base de datos.
