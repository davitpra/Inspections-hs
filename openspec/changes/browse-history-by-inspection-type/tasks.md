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
