## 1. Decisión y alcance vigente

- [x] 1.1 Crear ADR-013 para registrar la retirada preproducción de R5, la eliminación destructiva de sus tablas y objetos, la conservación de `audit_log` y la desaparición de Playwright como restricción de hosting; actualizar solamente el índice de ADRs y referencias vigentes, sin reescribir ADRs aceptados.
- [x] 1.2 Modificar `docs/Requisitos_V1.2.md` para retirar la métrica y recorrido R5 y corregir la etapa 7, sin alterar los recorridos de Scheduling ni recurrencia.
- [x] 1.3 Actualizar `README.md`, `openspec/config.yaml`, `CLAUDE.md` y los artefactos de los changes activos que mencionen el reporte eliminado, preservando intactos los changes archivados.

## 2. Contratos compartidos de períodos

- [x] 2.1 Crear `packages/contracts/src/periods.ts` con `PeriodStatus`, `PeriodMonths`, sus esquemas, constantes, etiquetas y `periodLabel`, y exportarlo desde el barrel público.
- [x] 2.2 Actualizar inspections, submissions, notifications y todos los consumidores API/web para importar el contrato neutral sin aliases de compatibilidad con compliance.
- [x] 2.3 Mover a `periods.test.ts` las pruebas de estados, frecuencias y etiquetas, incluyendo períodos alineados, desalineados y que cruzan de año.
- [x] 2.4 Eliminar `compliance.ts`, sus pruebas report-only, `canonical-json.ts`, sus pruebas y sus exports después de comprobar que no queda ningún consumidor no relacionado con el reporte.

## 3. Retirada de la aplicación web

- [x] 3.1 Eliminar `ComplianceRoute`, sus subcomponentes, lógica de presentación y pruebas, junto con `apps/web/src/api/compliance.ts`.
- [x] 3.2 Retirar `/compliance` del router, navegación y títulos móviles, y eliminar sus query keys y `canGenerateComplianceReport` con sus casos de prueba.
- [x] 3.3 Eliminar solamente los estilos exclusivos de fracción/reporte/hash y conservar los estilos de períodos utilizados por Scheduling y otras rutas.
- [x] 3.4 Sustituir las referencias históricas a compliance en el cliente HTTP, sus pruebas y `OfflineRoute` por ejemplos y contenido de capacidades supervivientes.

## 4. Retirada de API y generación

- [x] 4.1 Eliminar los cinco endpoints `/reports/compliance*`, la inyección de `ComplianceService` y sus imports, conservando `GET /findings/recurrence` y su orden de resolución.
- [x] 4.2 Eliminar `ComplianceService`, errores, SQL de cobertura, digest, documento PDF, renderer, worker, verificador independiente y sus pruebas unitarias e integración exclusivas.
- [x] 4.3 Simplificar `ReportingModule` para conservar únicamente recurrence y retirar sus imports de Jobs/Uploads y providers de compliance.
- [x] 4.4 Retirar `reporting.render-compliance-pdf` del registro tipado de pg-boss y conservar sin cambios funcionales la apertura de períodos y el escalamiento de acciones.
- [x] 4.5 Eliminar de `ObjectStorageService` el PUT, signed GET y derivación de keys exclusivos de reportes; conservar los flujos S3 de evidencia y retirar exports de módulo que hayan quedado sin consumidor.
- [x] 4.6 Eliminar la generación/listado de compliance de `demo-content.mjs` y el script `verify-compliance-digest.mjs`, manteniendo el resto del escenario de demo y sus comandos.
- [x] 4.7 Retirar del test de Scheduling la comparación con `COMPLIANCE_PERIODS_SQL`, conservar la cobertura de `periodStatusCase()` y limpiar comentarios que acoplen el estado operativo al reporte eliminado.

## 5. Migración destructiva y objetos

- [x] 5.1 Añadir la migración SQL forward `0031_remove_compliance_reports.sql` y su entrada de journal: eliminar `compliance_report_render` antes de `compliance_report`, incluyendo con las tablas sus GRANT/RLS/triggers, y eliminar `hs_compliance_render_audit()` y `hs_compliance_report_audit()` sin ejecutar ninguna escritura sobre `audit_log`.
- [x] 5.2 Eliminar el espejo Drizzle de compliance y su export, y comprobar en una base migrada desde cero que ambas tablas y funciones no existen, que el resto de RLS permanece y que una cadena con eventos históricos sigue verificando.
- [x] 5.3 Purgar con credenciales administrativas todos los objetos y todas sus versiones bajo cada prefijo `{site_id}/reports/`, verificar que no quede ninguna versión y comprobar que los prefijos de evidencias no cambiaron; no añadir `DeleteObject` ni un método de borrado a la aplicación.
- [x] 5.4 Descartar los trabajos `reporting.render-compliance-pdf` del pg-boss de desarrollo y verificar que la API ya no registra un worker para ese nombre.

## 6. Dependencias e infraestructura

- [x] 6.1 Eliminar Playwright de `apps/api/package.json`, regenerar `pnpm-lock.yaml` con pnpm y retirar la instalación de Chromium del workflow de CI.
- [x] 6.2 Eliminar `PDF_RENDER_TIMEOUT_MS` y comentarios report-only de `.env.example`; reducir permisos de lectura S3 de desarrollo si la búsqueda final confirma que ningún flujo superviviente usa signed GET.
- [x] 6.3 Revisar la política y documentación de object storage para que sigan describiendo uploads de evidencia, versionado y ausencia de borrado por la aplicación sin mencionar PDFs de compliance.

## 7. Regresiones y validación

- [x] 7.1 Añadir o ajustar pruebas para comprobar que las cinco rutas `/reports/compliance*` y `/compliance` ya no están registradas, mientras recurrence continúa accesible.
- [x] 7.2 Ejecutar los tests focalizados de contracts, web, reporting recurrence, Scheduling, uploads y auditoría; corregir únicamente regresiones causadas por este change.
- [x] 7.3 Ejecutar `pnpm -r build` antes de `pnpm typecheck`, y después `pnpm lint`, `pnpm test` y `pnpm --filter api test:int`.
- [x] 7.4 Buscar referencias residuales a Compliance/PDF/Playwright y clasificar como válidas únicamente las de historial de migraciones, ADRs supersedidos, changes archivados y payloads históricos de auditoría.
- [x] 7.5 Ejecutar `openspec validate 2026-08-24-retirar-reportes-de-cumplimiento --strict` y dejar el change listo para sincronización y archivo una vez completada la implementación.
