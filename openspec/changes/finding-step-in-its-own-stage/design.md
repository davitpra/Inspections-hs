## Contexto

El ciclo dibuja las cinco etapas de `finding.state` (ADR-008: el estado se deriva de eventos y
no es columna; lo agrega el servidor y el cliente no lo recalcula) y, debajo, un único panel
que contesta por la etapa abierta. La lectura de cada etapa alcanzada es ADR-018.

Este change **no toca ninguna tabla inmutable**, ni el esquema, ni las migraciones: se
verificó que el estado que llega a la pantalla ya es el correcto —lo agrega
`hs_finding_aggregate_state` y lo leen por igual `GET /findings` y el endpoint del envío—, y
que las invalidaciones de caché tras crear o avanzar sí alcanzan la consulta de la que sale el
hallazgo. Lo único equivocado es dónde se dibuja el formulario.

## Decisión: el formulario se lee en la etapa DESDE la que se ejecuta

Hoy `nextStep` devuelve `writes`, la etapa **destino** de la transición ofrecida, y el ciclo
abre esa etapa aunque no haya ocurrido. El argumento era que un paso ofrecido desde la etapa
anterior obliga a leer el ciclo al revés. En la práctica el precio fue peor: el registro que
acompaña al paso está vacío en las tres etapas donde hay algo que decidir, y lo que sí se
decidió —el compromiso, los eventos del trabajo— hay que ir a buscarlo una pestaña atrás.

Se invierte: el paso vive dentro del registro de la etapa vigente.

| etapa vigente  | registro                                  | paso                            |
| -------------- | ----------------------------------------- | ------------------------------- |
| `raised`       | hechos observados del hallazgo            | Create corrective action        |
| `assigned`     | compromiso original y sus enmiendas       | Start work · Edit assignment    |
| `in_progress`  | las decisiones que iniciaron o reanudaron | Declare the work done           |
| `verification` | las declaraciones de trabajo hecho        | Verify and close · Send it back |
| `closed`       | las decisiones de verificación            | ninguno                         |

Con esto, `writes` deja de tener a quién servir y se retira del tipo: el único campo que
decide si hay formulario es `control`.

## Consecuencia: la etapa vigente nunca tiene registro vacío

La rama «Nothing has been recorded here yet» existía porque el paso se leía en una etapa sin
registro. Por construcción no hace falta más: `raised` trae los hechos del hallazgo,
`assigned` tiene al menos el compromiso original, y `in_progress`, `verification` y `closed`
tienen el evento que las escribió —es el mismo evento del que el servidor deriva el estado—.

Se **conserva** en cambio la distinción que el requisito exige y que no sale de acá: una etapa
cuyo registro no se pudo leer dice que necesita conexión, y no que no se registró nada.

## Lo que no cambia

- La lectura sigue moviéndose sola cuando el hallazgo avanza (seguimiento de `finding.state`
  durante el render, no una `key`: la mutación de creación se envía desde el mismo componente
  y remontarlo sería desmontar el formulario a mitad de su envío).
- Las pestañas se deshabilitan mientras hay una enmienda abierta, por la misma razón de antes:
  cambiar de panel se llevaría el borrador escrito.
- `aria-current` (dónde está el hallazgo) y `aria-selected` (qué se está leyendo) siguen siendo
  dos cosas distintas en el mismo botón; lo que cambia es que ahora coinciden por defecto.
