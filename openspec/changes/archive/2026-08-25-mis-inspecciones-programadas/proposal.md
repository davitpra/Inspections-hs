## Why

Una cuenta puede tener varias inspecciones pendientes, pero la pantalla principal elegía
una automáticamente y escondía el resto. La primera decisión del inspector debe ser cuál
asignación atender, no aceptar sin contexto la que eligió la interfaz.

Este change completa la **etapa 7** de `docs/requisitos-v1.2.md` §7 del lado del inspector:
la consulta operativa de períodos pasa a ser la entrada a su trabajo y cada período abre su
propia preparación antes de entrar a captura.

## What Changes

- Convertir la pantalla principal del inspector en la lista completa de inspecciones
  asignadas y todavía sin enviar.
- Hacer que seleccionar una fila abra un detalle propio en `/inspections/$id`, desde el que
  se empieza, retoma o abre la captura de esa inspección.
- Conservar en la lista la descarga individual de paquetes de campo para preparar varias
  salidas antes de perder conexión.
- Mover a la entrada principal el acuse posterior al envío, el acceso al historial y los
  borradores locales, sin mostrarlos dentro del detalle seleccionado.
- Dejar de elegir automáticamente una inspección destacada o una próxima inspección.

Fuera de alcance: cambiar endpoints o contratos, listar asignaciones de otra cuenta,
filtrar u ordenar por columna, y sincronizar un borrador entre dispositivos.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections` — la lista de asignaciones pendientes es la entrada principal y cada
  asignación abre una preparación identificada por su id antes de captura.

## Impact

- Ninguna migración, endpoint ni contrato nuevo.
- Reorganización de rutas y componentes en `apps/web`.
- `/` pasa a servir la lista; `/inspections/$id` sirve el detalle; se retira
  `/inspections/scheduled` antes de publicación.
- Pruebas de rutas, presentación y navegación web.
