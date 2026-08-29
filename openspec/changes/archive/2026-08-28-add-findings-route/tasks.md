## 1. La ruta dedicada de hallazgos

- [x] 1.1 Añadir `/findings` con el listado de inspecciones del alcance que registraron hallazgos, y `/findings/$id` con el recorte de un envío leído solo por lo que salió mal.
- [x] 1.2 Ofrecer el destino Findings en la navegación y darle título propio en la barra del teléfono.
- [x] 1.3 Subir a `src/components/FindingReadout.tsx` el bloque del hallazgo que comparten el reporte completo y el recorte, con la acción correctiva que la plantilla prescribió, leída del documento congelado.

## 2. El compromiso se abre desde el hallazgo

- [x] 2.1 Mudar `CreateActionForm` a `routes/InspectionFindingsRoute/`, y con él `futureDueAt` a la `presentation.ts` de esa ruta.
- [x] 2.2 Añadir `actionsByFinding` para agrupar las acciones por el hallazgo que señalan, con sus pruebas puras.
- [x] 2.3 Dibujar bajo cada hallazgo las acciones que ya tiene —descripción, estado y enlace a `/actions/$id`— para todos los roles, sin afirmar cero cuando la lista no se pudo leer.
- [x] 2.4 Ofrecer el control de creación solo a `hs_coordinator` (`canCreateAction`) y montar el diálogo una sola vez, fuera del bucle de secciones.
- [x] 2.5 Cubrir con pruebas de ruta el rol, la lectura de acciones existentes, el fallo de la lista, la creación completa, el plazo pasado, el doble envío y el borrador conservado ante un rechazo.

## 3. `/actions` queda dedicada a las acciones

- [x] 3.1 Retirar `FindingsTable`, la consulta de hallazgos y `findingsWithActionCounts` de la ruta y de su `presentation.ts`.
- [x] 3.2 Ajustar los textos de la pantalla y podar las reglas de `index.css` que quedaron sin uso.
- [x] 3.3 Reducir las pruebas de la ruta a lo que sigue siendo suyo, y comprobar la ausencia del control de creación.

## 4. Verificación

- [x] 4.1 Ejecutar las pruebas web de las rutas tocadas y corregir regresiones.
- [x] 4.2 Ejecutar `pnpm -r build`, `pnpm typecheck` y `pnpm lint`.
- [x] 4.3 Validar estrictamente el change de OpenSpec.
