## 1. Contrato y API

- [x] 1.1 Añadir y exportar `deactivateOrganizationLocationSchema` con `{ deactivated: true }` en `packages/contracts` y cubrirlo en sus pruebas.
- [x] 1.2 Añadir `PATCH /organization-locations/:id` al controller, validando el contrato y delegando al servicio.
- [x] 1.3 Implementar `deactivateOrganizationLocation` con `requireCoordinator`, la actualización atómica de `organization_location` y la cascada RLS sobre `location`, documentando la asimetría de alcance.
- [x] 1.4 Añadir pruebas de integración para la cascada en dos plantas, las listas activas, el 403 de `supervisor` y el 404 de una ubicación ya retirada.

## 2. Consola de ubicaciones

- [x] 2.1 Añadir `deactivateOrganizationLocation` al cliente de catálogo.
- [x] 2.2 Crear `RetireLocationDialog` con `dialog`, apertura mediante `showModal`, confirmación explícita, mensaje de consecuencias, invalidación de ambas queries y error persistente.
- [x] 2.3 Añadir la celda de acciones y el encabezado accesible en `LocationRow` e `index.tsx`, manteniendo el diálogo fuera de la fila y sin acción para huérfanas.
- [x] 2.4 Añadir estilos para la cuarta columna, su divisoria y su disponibilidad en móvil.
- [x] 2.5 Añadir pruebas de ruta para abrir, confirmar, mantener el error en el diálogo y cerrar con `Keep it` sin llamar al endpoint.

## 3. Verificación

- [x] 3.1 Ejecutar `pnpm -r build`.
- [x] 3.2 Ejecutar `pnpm typecheck && pnpm lint`.
- [x] 3.3 Ejecutar las pruebas de contracts, web y API indicadas en la propuesta.
- [x] 3.4 Ejecutar `pnpm --filter web build` y validar manualmente la acción en 375px si el entorno está disponible.
