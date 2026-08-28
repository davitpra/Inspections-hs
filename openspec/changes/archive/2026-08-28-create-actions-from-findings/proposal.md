## Why

La página `Corrective actions` solo muestra acciones que ya existen, de modo que una inspección
con hallazgos pero sin acciones queda invisible y el coordinador no tiene ningún camino en la PWA
para convertir esos hallazgos en obligaciones. La API ya permite hacerlo, pero su único cliente web
no llama esa operación.

## What Changes

- Mostrar en `Corrective actions` los hallazgos del alcance, incluidos los que todavía no tienen
  ninguna acción.
- Permitir que el coordinador abra desde cada hallazgo un formulario para elegir una persona activa
  del mismo sitio, escribir la descripción de la acción y declarar una fecha límite futura.
- Crear la acción mediante el endpoint existente y refrescar tanto la lista de acciones como el
  conteo asociado al hallazgo, sin navegación intermedia ni estado offline.
- Mantener el formulario oculto para el resto de roles; la autorización real continúa en el
  servidor.
- Mantener disponibles los hallazgos que ya tienen acciones, porque un hallazgo puede originar más
  de una obligación.

Este change completa la entrada operativa de la etapa 5 de requisitos-v1.2 §7 en la PWA. No vuelve
a implementar el ciclo de vida de la acción: expone el camino de creación que esa etapa ya tiene en
contratos, API y base de datos.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `actions`: la interfaz del coordinador muestra hallazgos accionables y permite crear para cada uno
  una acción con responsable, descripción y fecha límite declarada.

## Impact

- `apps/web/src/routes/ActionsRoute/`: nueva composición de hallazgos, conteos y formulario de
  creación.
- `apps/web/src/api/`: cliente de lectura de hallazgos y reutilización de roster y acciones.
- `apps/web/src/permissions/actions.ts`: predicado puro para ofrecer la creación solo al coordinador.
- Tests de presentación, permisos e integración de `ActionsRoute`.
- Sin migraciones, endpoints, contratos ni dependencias nuevas.
