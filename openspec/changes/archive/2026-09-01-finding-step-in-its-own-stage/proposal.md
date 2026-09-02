## Why

El ciclo de un hallazgo lee el formulario del próximo paso en la etapa que ese formulario
**escribiría**, no en la etapa donde el hallazgo está. Con el hallazgo en `assigned`, la
lectura se para sola en un segmento `In progress` que todavía no ocurrió y el panel contesta
«Nothing has been recorded here yet», con `Start work` debajo. Lo mismo pasa en `in_progress`
y en `verification`: en las tres etapas con paso, **el registro de arriba está siempre vacío**.

El compromiso escrito, los eventos que iniciaron el trabajo y la declaración de trabajo hecho
quedan una pestaña atrás de donde se está mirando, en la pantalla que existe justamente para
leerlos. Anclar cada formulario a la etapa desde la que se ejecuta pone lo ya decidido y lo
que sigue en la misma pestaña, y devuelve la tira de etapas a lo que `aria-current` ya dice.

Este change no cierra una etapa de requisitos-v1.2 §7: corrige la lectura de una capacidad ya
entregada —el ciclo navegable de la etapa 4— sin cambiar qué datos se guardan ni quién puede
actuar.

## What Changes

- Presentar el próximo paso dentro del registro de la etapa en la que el hallazgo está, y
  abrir esa etapa por defecto.
- Retirar el segmento «borrador»: ninguna etapa no alcanzada se ofrece como pestaña, sin
  excepción, y una composición sin enviar deja de mover el indicador del ciclo.
- Retirar el registro vacío «Nothing has been recorded here yet. The step below is what
  writes it.», que solo existía porque el paso se leía en una etapa sin registro.
- Conservar sin cambios la lectura de solo lectura de cada etapa alcanzada, el aviso de
  registro ilegible, el bloqueo de la navegación mientras hay una enmienda abierta, quién
  puede crear y avanzar, y la invalidación de cachés tras cada acto.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `findings`: el próximo paso se lee dentro de la etapa vigente del ciclo, y el ciclo deja de
  anticipar la etapa que un formulario sin enviar escribiría.

## Impact

- Frontend web: `apps/web/src/routes/InspectionFindingsRoute/` (ciclo, tira de etapas,
  registro de etapa, presentación pura y sus pruebas) y los estilos del segmento borrador en
  `apps/web/src/index.css`.
- OpenSpec: el requisito del ciclo de cinco estados y su próximo paso.
- Sin cambios de API, contratos, base de datos, RLS, service worker ni dependencias.
