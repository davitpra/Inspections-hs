## 1. Presentación del historial

- [x] 1.1 Extraer y probar la agrupación por `template_id`, el nombre más reciente y el orden interno.
- [x] 1.2 Convertir `/historical` en secciones accesibles por tipo, cada una con su `CompletedInspectionsTable`.
- [x] 1.3 Resolver los nombres de sitio y los estados combinados de carga, error y vacío en la lectura única.

## 2. Navegación

- [x] 2.1 Retirar la ruta `/historical/$templateId` y cubrir su ausencia en el árbol de TanStack Router.
- [x] 2.2 Retirar el título móvil del detalle histórico sin alterar las rutas equivalentes de hallazgos.

## 3. Verificación

- [x] 3.1 Cubrir la lectura agrupada con pruebas de identidad, aislamiento por cuenta, orden, sitios, estados y enlaces a reportes.
- [ ] 3.2 Ejecutar pruebas específicas, lint, build y typecheck en el orden requerido por el repositorio.
- [x] 3.3 Validar estrictamente el change de OpenSpec.

## 4. Hallazgos por tipo

- [x] 4.1 Promover la agrupación por `template_id` y el filtro de inspecciones con hallazgos a presentación compartida, con pruebas unitarias.
- [x] 4.2 Reutilizar la estructura accesible de secciones y tablas completas en `/findings`.
- [x] 4.3 Agrupar en `/findings` solo las inspecciones completadas que registraron hallazgos.
- [x] 4.4 Enlazar cada fila directamente al `/findings/$id` existente y retirar `/findings/types/$templateId`.
- [x] 4.5 Retirar la ruta y el título móvil intermedios sin colisionar con el detalle individual.
- [x] 4.6 Cubrir agrupación, consultas, navegación y regresiones con pruebas específicas.
- [ ] 4.7 Ejecutar lint, pruebas, validación OpenSpec, build y typecheck.
