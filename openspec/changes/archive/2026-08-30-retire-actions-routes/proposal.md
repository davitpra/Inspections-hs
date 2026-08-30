## Why

El workspace y el detalle independiente de acciones correctivas llevaron la interfaz hacia un
flujo paralelo que ya no coincide con el trabajo centrado en el hallazgo. El ciclo operativo y su
registro ya viven en la lectura de `findings/$id`, por lo que mantener tres rutas adicionales
duplica navegación, presentación y decisiones de producto.

Este change no cierra una etapa nueva de `Requisitos_V1.2.md` §7: corrige el rumbo de la interfaz
de las etapas 2 y 3 sin retirar el dominio, la máquina de estados ni sus garantías regulatorias.

## What Changes

- **BREAKING** Retirar `/actions`, `/actions/inspection/$inspectionId` y `/actions/$id`; las URLs
  antiguas dejan de resolver y no tienen redirección.
- Retirar la entrada de navegación global, los listados, filtros y el detalle independiente de
  acciones correctivas.
- Mantener en `findings/$id` la creación, el próximo paso, las transiciones y la lectura de las
  decisiones tomadas en cada etapa alcanzada, con los valores enviados desde ese mismo próximo
  paso y sin exponer el stream técnico de eventos.
- Aceptar que las acciones ligadas a investigaciones o hallazgos manuales no tengan una superficie
  de lectura en la UI v1.
- Mantener sin cambios los endpoints, contratos, eventos, evidencia, escalamiento, auditoría,
  aislamiento por sitio y estado derivado de acciones y hallazgos.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `actions`: retira el workspace y la pantalla independiente de una acción como superficies de UI.
- `findings`: establece la lectura por etapas del hallazgo como la superficie de las decisiones
  tomadas sobre sus acciones, además de creación y transición, sin convertirla en un timeline de
  eventos técnicos.

## Impact

- Frontend: árbol de rutas, navegación, tres carpetas de ruta, componentes, proyección de decisiones
  por etapa, presentación, pruebas y estilos exclusivos de esas pantallas.
- Especificaciones: deltas en `actions` y `findings` para eliminar los requisitos de workspace y
  detalle independiente y conservar el ciclo inline.
- API y datos: sin cambios. `GET /actions` y `GET /actions/:id` continúan alimentando
  `findings/$id`; no hay cambios de esquema ni migraciones.
