## 1. Retirar las superficies independientes de acciones

- [x] 1.1 Eliminar del router y de sus pruebas las rutas `/actions`, `/actions/inspection/$inspectionId` y `/actions/$id`, sin redirecciones.
- [x] 1.2 Eliminar la entrada de navegación de acciones correctivas y comprobar que ningún enlace restante apunte a una ruta retirada.
- [x] 1.3 Eliminar las carpetas de ruta, componentes y estilos exclusivos del workspace, listado por inspección y detalle de acciones, preservando API clients, query keys, permisos y formularios consumidos por hallazgos.
- [x] 1.4 Mantener `GET /actions` y `GET /actions/:id`, sus contratos y todo comportamiento de acciones para hallazgos, investigaciones, escalamientos, evidencia y auditoría.

## 2. Proyectar decisiones por etapa

- [x] 2.1 Definir en `InspectionFindingsRoute/presentation.ts` el modelo puro de una decisión de etapa y proyectar creación, inicio, declaración de trabajo, verificación y devolución desde cada acción completa.
- [x] 2.2 Tratar la creación y su avance automático a `in_progress` como un solo compromiso, indicar en In progress que ese compromiso puso el trabajo en marcha, conservar `Start work` para acciones históricas en `open` y ordenar sin colapsar decisiones de varias acciones o recorridos repetidos.
- [x] 2.3 Reemplazar `StageEvents` en `FindingStageRecord.tsx` por la presentación de los valores enviados desde `FindingNextStep`: responsable, descripción y `due_at`; razón; nota; y conteos before/after cuando correspondan.
- [x] 2.4 Mantener Raised leyendo solo los hechos del hallazgo, la carga diferida de detalles al abrir las demás etapas y el aviso de conexión sin afirmar que una etapa no contiene decisiones.
- [x] 2.5 Eliminar `eventsInStage`, `ActionEventList` y sus estilos únicamente después de comprobar que las rutas restantes ya no los importan; usar nombres y estilos propios de la ficha del hallazgo para las decisiones.
- [x] 2.6 Preservar la semántica de tabs, el foco, la etapa vigente persistida y la ausencia de controles de transición mientras se lee una etapa pasada.

## 3. Probar el comportamiento observable

- [x] 3.1 Añadir pruebas puras para la proyección de cada tipo de decisión, la creación automática sin duplicado, la devolución con `reason`, y el orden de múltiples acciones y regresiones.
- [x] 3.2 Actualizar la prueba de integración de `InspectionFindingsRoute` para comprobar los valores de Assigned, In progress, Verification y Closed sin estados técnicos, posiciones ni timeline de eventos.
- [x] 3.3 Cubrir Raised sin consulta de acción, carga bajo demanda, fallo de conexión, etapas futuras no navegables y lectura pasada sin mover `finding.state` ni ofrecer transiciones.
- [x] 3.4 Cubrir que las URLs retiradas no resuelven, que no existe entrada de navegación y que creación/transiciones inline continúan invalidando las lecturas afectadas.

## 4. Verificación

- [x] 4.1 Ejecutar `openspec validate retire-actions-routes --strict` y corregir cualquier incoherencia de los artefactos.
- [x] 4.2 Ejecutar las pruebas unitarias de presentación, ruta y router afectadas mediante `pnpm --filter web exec vitest run`.
- [x] 4.3 Ejecutar `pnpm lint`, `pnpm -r build` y, después del build, `pnpm typecheck`.
