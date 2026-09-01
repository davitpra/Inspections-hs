## 1. Presentación del historial

- [x] 1.1 Extraer y probar la agrupación por `template_id`, el conteo, el nombre más reciente y el filtro de detalle.
- [x] 1.2 Convertir `/historical` en una tabla accesible de tipos completados con enlaces tipados.
- [x] 1.3 Crear el detalle `/historical/$templateId` reutilizando `CompletedInspectionsTable` y sus estados de carga, error y tipo no visible.

## 2. Navegación

- [x] 2.1 Registrar la ruta de detalle y cubrirla en el árbol de TanStack Router.
- [x] 2.2 Nombrar `/historical/*` en la navegación móvil y probar el título.

## 3. Verificación

- [x] 3.1 Cubrir el índice y el detalle con pruebas de ruta para identidad, conteo, aislamiento por cuenta, orden y enlaces a reportes.
- [ ] 3.2 Ejecutar pruebas específicas, lint, build y typecheck en el orden requerido por el repositorio.
- [x] 3.3 Validar estrictamente el change de OpenSpec.

## 4. Hallazgos por tipo

- [x] 4.1 Promover la agrupación por `template_id` y el filtro de inspecciones con hallazgos a presentación compartida, con pruebas unitarias.
- [x] 4.2 Extraer la tabla índice de tipos a un componente compartido y usarla en el historial.
- [x] 4.3 Convertir `/findings` en el índice de tipos con conteo de inspecciones que registraron hallazgos.
- [x] 4.4 Crear `/findings/types/$templateId` con la lista cronológica y enlaces al `/findings/$id` existente.
- [x] 4.5 Registrar la ruta, el título móvil y los estilos compartidos sin colisionar con el detalle individual.
- [x] 4.6 Cubrir presentación, rutas, navegación y regresiones con pruebas específicas.
- [ ] 4.7 Ejecutar lint, pruebas, validación OpenSpec, build y typecheck.
