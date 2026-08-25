## 1. Modelo de presentacion del ano

- [x] 1.1 Extender `SchedulingRoute/presentation.ts` con claves y agrupacion pura para representar el mismo `YearEntry[]` por requisito/mes en matrix y por periodo/requisito en list, sin duplicar la aritmetica de `projectYear()`.
- [x] 1.2 Reemplazar `yearStats` por resumenes del ano (`total`, `completed`, `missed`, `unassigned`, `unopened`) que excluyan cancelados de los subconjuntos accionables y permitan el solapamiento intencional de missed/unassigned.
- [x] 1.3 Agregar filtros puros por requisito y estado, incluido limpiar filtros, y derivar el aviso de no asignados desde las entradas del ano seleccionado.
- [x] 1.4 Cubrir en `presentation.test.ts` reglas mensuales, trimestrales, semestrales y anuales; posiciones no debidas; igualdad de entradas entre vistas; cancelados; filtros; y aviso limitado al ano.

## 2. Administracion de requisitos

- [x] 2.1 Reemplazar `RulesSection` por `RequirementsSection`, con encabezado permanente, contador, estado vacio y una fila compacta por plantilla usando `currentRules()`.
- [x] 2.2 Rehacer la fila como `RequirementRow`: nombre, cadencia legible, inspector por defecto y estado; mover cambiar inspector, desactivar y reactivar a acciones enfocadas y usar tono neutral para reactivar.
- [x] 2.3 Crear `RequirementDialog` para alta con plantilla publicada disponible, frecuencia, ancla solo cuando aplica, inspector por defecto opcional y vista previa de meses de inicio; enviar `default_inspector_id` en la llamada existente.
- [x] 2.4 Crear confirmacion estructurada para desactivar que nombre el efecto sobre periodos futuros y preserve los ya abiertos, reemplazando `window.confirm`.
- [x] 2.5 Distinguir carga, respuesta vacia y error de plantillas/candidatos dentro de cada dialogo y bloquear solo la confirmacion que dependa de datos fallidos.
- [x] 2.6 Actualizar los tests de ruta para unicidad de plantilla, alta mensual y no mensual, inspector por defecto en el alta, cambio explicito del inspector, desactivacion/reactivacion y lectura sin controles para `jhsc_member`.

## 3. Workspace anual

- [x] 3.1 Crear `ScheduleToolbar` con navegacion de ano, filtros por requisito/estado, selector accesible Matrix/List y `Clear filters`; inicializar List en viewport pequeno y Matrix en viewport amplio.
- [x] 3.2 Crear `ScheduleMatrix` con una fila por requisito, doce posiciones de mes, huecos no debidos distintos de unopened, nombres accesibles completos y seleccion de cada periodo proyectado.
- [x] 3.3 Crear `ScheduleList` como lista operativa compacta con periodo, requisito, estado, inspector y la misma seleccion de entrada que la matrix.
- [x] 3.4 Crear resumenes accionables sobre el ano completo, mantener sus conteos al filtrar y hacer que el aviso de no asignados active el filtro correspondiente en vez de enlazar a otro ano.
- [x] 3.5 Reemplazar `PeriodsSection` por `ScheduleSection`, entregando el mismo arreglo filtrado a matrix/list y mostrando un estado vacio que diferencie ano sin obligaciones de filtros sin resultados.

## 4. Detalle y operaciones de periodo

- [x] 4.1 Crear `PeriodDialog` para mostrar etiqueta, plantilla, estado, inspector, motivo de cancelacion y explicacion de missed desde una sola entrada `opened` o `unopened`.
- [x] 4.2 Mover apertura y asignacion al dialogo: cargar candidatos/plantilla solo al abrirlo, conservar inspector opcional al abrir, advertir la `template_version` congelada y exigir confirmacion explicita para reasignar.
- [x] 4.3 Conservar ausencia de actualizacion optimista, restauracion del inspector persistido y mensaje del servidor cuando una asignacion falla.
- [x] 4.4 Integrar cancelacion y reprogramacion desde el detalle, conservar sus semanticas actuales y adoptar `modal__head`, `modal__text` y `modal__actions` con tono de peligro solo para cancelar.
- [x] 4.5 Mantener el detalle legible para roles sin administracion y ocultarles apertura, asignacion, cancelacion y reprogramacion.
- [x] 4.6 Actualizar los tests de apertura futura, asignacion confirmada, error de asignacion, missed, cancelacion con motivo, reprogramacion y congelacion de version para el flujo bajo demanda.

## 5. Integracion y lenguaje de la ruta

- [x] 5.1 Reducir `SchedulingRoute/index.tsx` a queries, sitio, ano, permisos, filtros/seleccion y composicion de requisitos, avisos y workspace.
- [x] 5.2 Corregir el subtitulo y todo texto `month` que describa genericamente un periodo para que Monthly, Quarterly, Semiannual y Annual se lean sin contradicciones.
- [x] 5.3 Incluir errores de `sites`, reglas y periodos en los estados globales sin dibujar un sitio o calendario vacio mientras la seleccion inicial aun carga.
- [x] 5.4 Mantener el filtrado de sitios desactivados, el sitio unico como texto, nombres en vez de UUID y todas las invalidaciones de queries actuales.

## 6. Estilos responsive y accesibilidad

- [x] 6.1 Reemplazar los estilos de tarjetas repetidas por una superficie unica de planificacion con toolbar, resumenes, matrix, list y estados vacios usando exclusivamente tokens semanticos.
- [x] 6.2 Hacer que la matrix limite su overflow horizontal, mantenga identificable la columna de requisito y conserve celdas/controles de al menos 48px; convertir la list en filas apiladas en telefono.
- [x] 6.3 Representar cada estado con texto accesible ademas de color/forma, alinear el estado Open con `state-info` y eliminar iconos de calendario repetidos sin perder nombres accesibles.
- [x] 6.4 Verificar foco, Escape, cierre y retorno de foco de los nuevos dialogos y menus, y grupos `aria-pressed`/labels de vistas, filtros y celdas.

## 7. Verificacion

- [x] 7.1 Actualizar `SchedulingRoute/index.test.tsx` para afirmar entradas y operaciones accesibles en vez de cantidades de texto dependientes de las tarjetas anteriores.
- [x] 7.2 Agregar casos de matrix/list equivalentes, viewport pequeno, filtros/resumenes, errores de soporte, ano visible y reglas no mensuales, preservando permisos, sitios desactivados y ausencia de UUID.
- [x] 7.3 Ejecutar `pnpm --filter web exec vitest run src/routes/SchedulingRoute/presentation.test.ts src/routes/SchedulingRoute/index.test.tsx`.
- [x] 7.4 Ejecutar `pnpm -r build` y despues `pnpm typecheck`, seguidos de `pnpm lint` y `pnpm test`; confirmar que `check-service-worker.mjs` y `check-tokens.mjs` permanecen verdes. Bloqueada por `apps/api/test/audit-chain.int-spec.ts` (`inScopeAs` no exportado) y timeout preexistente en `packages/config/test/eslint-rules.test.ts`.
