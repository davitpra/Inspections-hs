## Why

Los requisitos desactivados permanecen en la tabla de programación para poder reactivarlos, pero con el tiempo ocupan el mismo espacio visual que los requisitos operativos. El coordinador necesita retirar de la vista ordinaria los que ya no piensa reutilizar sin borrar su historia ni cambiar los períodos que produjeron.

Este change no cierra una etapa nueva de `docs/requisitos-v1.2.md` §7: completa la administración de requisitos ya entregada con una distinción de presentación entre «desactivado» y «archivado», preservando las obligaciones y la trazabilidad exigidas por esa etapa.

## What Changes

- Permitir que un coordinador archive un requisito únicamente después de desactivarlo.
- Ocultar por defecto los requisitos archivados y ofrecer un control para mostrarlos.
- Permitir restaurar un requisito archivado cuando no haya otro requisito actual para la misma planta y plantilla.
- Mantener los requisitos archivados en la base y en todos los cálculos históricos; archivar solo cambia su presencia en la tabla de administración.
- Registrar el archivo y la restauración en la cadena de auditoría de la planta.
- Mantener la tabla en modo lectura, sin controles de archivo, para cuentas sin permiso de administración.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections`: ciclo de archivo, restauración y visibilidad de requisitos desactivados.
- `audit`: eventos auditables de archivo y restauración de requisitos.

## Impact

- Nueva columna `inspection_schedule.archived_at`, protegida por RLS, privilegios por columna, restricciones y triggers.
- Extensión del contrato `InspectionSchedule` y del `PATCH /inspection-schedules/:id`.
- Cambios en el servicio NestJS y en el cliente web de inspecciones.
- Cambios en la tabla de requisitos de `SchedulingRoute`, sin afectar la proyección anual ni reporting.
- Pruebas de contratos, integración PostgreSQL, presentación y ruta web.
