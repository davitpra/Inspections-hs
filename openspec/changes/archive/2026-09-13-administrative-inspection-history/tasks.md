## 1. Permiso Y Selección De Inspecciones

- [x] 1.1 Añadir un permiso puro para identificar cuentas administrativas que pueden revisar inspecciones de sus sitios.
- [x] 1.2 Hacer que la selección pura de inspecciones completadas incluya todas las filas en alcance para `hs_coordinator` y `management`, manteniendo el filtro por propietario para `jhsc_member`.

## 2. Pantallas Web

- [x] 2.1 Aplicar la selección sensible al rol en `HistoricalInspectionsRoute` y ajustar su copy para administradores.
- [x] 2.2 Aplicar la misma selección sensible al rol en `FindingsRoute` y ajustar su copy para administradores.

## 3. Especificaciones Y Pruebas

- [x] 3.1 Añadir pruebas del permiso y de la selección pura para los tres roles, estados completados y orden.
- [x] 3.2 Actualizar pruebas de integración de Historical para verificar visibilidad administrativa y exclusión de otros sitios.
- [x] 3.3 Actualizar pruebas de integración de Findings para verificar hallazgos ajenos en alcance y mantener la exclusión para miembros JHSC.
- [x] 3.4 Validar las especificaciones OpenSpec y ejecutar lint, build, typecheck y tests.

## 4. Inspector En Las Filas Administrativas

- [x] 4.1 Añadir la columna condicional `Inspector` a la tabla compartida usando `inspector_name` y el fallback existente.
- [x] 4.2 Activar la columna en Historical y Findings únicamente para `hs_coordinator` y `management`, incluyendo el `data-label` móvil.
- [x] 4.3 Añadir pruebas para la columna administrativa, la visibilidad del nombre y la ausencia de la columna para `jhsc_member`.
