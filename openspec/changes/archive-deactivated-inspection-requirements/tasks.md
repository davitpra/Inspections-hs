## 1. Persistencia y contratos

- [x] 1.1 Agregar `inspection_schedule.archived_at` al esquema Drizzle y a una migración SQL con `CHECK`, REVOKE/GRANT por columna, trigger de guarda, RLS conservada y eventos de auditoría.
- [x] 1.2 Extender `InspectionSchedule` y `UpdateInspectionSchedule` con `archived_at` y `archived`, incluidos sus tests de contrato.

## 2. API de inspecciones

- [x] 2.1 Proyectar `archived_at` en las lecturas y aceptar archivo/restauración en `updateSchedule` dentro del alcance de sesión.
- [x] 2.2 Rechazar con errores declarados el archivo de una regla activa y la restauración cuando exista otra regla no archivada para la misma planta y plantilla.
- [x] 2.3 Cubrir archivo, restauración, colisiones, RLS, restricciones del motor y eventos de auditoría con integración PostgreSQL.

## 3. Tabla de requisitos

- [x] 3.1 Extender el cliente web y separar las reglas actuales visibles de las archivadas sin filtrar la entrada de la proyección anual.
- [x] 3.2 Agregar `Archive requirement` solo a filas desactivadas y una confirmación que explique que la historia no cambia.
- [x] 3.3 Agregar `Show archived`, estado `Archived` y acción `Restore`, manteniendo esos controles fuera de cuentas lectoras.
- [x] 3.4 Cubrir visibilidad por defecto, archivo, restauración, permisos y conservación de la proyección anual en tests web.

## 4. Verificación

- [x] 4.1 Validar el change con `openspec validate archive-deactivated-inspection-requirements --strict`.
- [x] 4.2 Ejecutar build antes de typecheck, lint, pruebas unitarias y la integración de programación contra PostgreSQL.
