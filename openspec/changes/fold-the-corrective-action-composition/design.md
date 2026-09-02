## Context

Ver `proposal.md — Why`. Lo que hace falta acá es de dónde salen las tres piezas que se
mueven.

El ciclo dibuja `finding.state`, que el servidor deriva de eventos y el cliente nunca escribe
(ADR-008). Dos nociones distintas conviven en el mismo botón del stepper: `aria-current`, dónde
está el hallazgo, y `aria-selected`, qué etapa se está leyendo (ADR-018). La lectura por etapa
alcanzada también es ADR-018; quién puede crear la acción es ADR-017.

**Este change no toca ninguna tabla inmutable**, ni el esquema, ni las migraciones, ni un
endpoint: es enteramente `apps/web`. El control que pliega la composición no escribe nada, y el
hallazgo pasa a `assigned` cuando el compromiso se envía, igual que hoy.

Las dos piezas que vuelven existieron y se retiraron hoy mismo: el ciclo plegado en `b5ef79a`
(`expanded`, `.finding__lifecycle-toggle`, el gate `enabled: creating && expanded` del roster) y
el segmento borrador en `98fe803` (el segundo parámetro de `openableStages`, la prop `draft` del
stepper, `.finding__stage--draft`, la rama `pending` de `FindingStageRecord`). El change que las
retiró está archivado en `2026-09-01-finding-step-in-its-own-stage`.

## Goals / Non-Goals

**Goals**

- Que un hallazgo sin nada escrito cueste una línea de pantalla, no un ciclo completo.
- Que la composición del alta se lea donde escribe, sin que el indicador del ciclo mienta sobre
  dónde está el hallazgo.

**Non-Goals**

- Reabrir la decisión archivada para los otros tres pasos: `Start work`, `Declare the work done`
  y `Verify and close` se siguen leyendo en la etapa desde la que se ejecutan, junto a lo que esa
  etapa registró.
- Cualquier forma de que el cliente escriba `finding.state`, o de que exista una acción
  correctiva sin compromiso.

## Decisions

### El borrador se ata al despliegue, no al paso

El diseño anterior llevaba el campo `writes` en `FindingNextStep`: cada paso declaraba la etapa
destino y el ciclo la abría. Eso es lo que produjo el registro vacío en las tres etapas con paso,
y por eso se retiró.

Acá la excepción NO vuelve al tipo. `FindingNextStep` queda como está —`control` es el único
campo que decide si hay formulario— y la etapa borrador la calcula el ciclo a partir de su propio
estado de pantalla: hay borrador cuando la composición está desplegada, y solo entonces.

La alternativa era una función pura `stepStage(current)` que devolviera `assigned` para `raised`
y la etapa vigente para el resto. Se descartó: sin mirar el despliegue, ofrecería `Assigned` a un
`jhsc_member` que no puede componer nada, y le escondería a un clic los hechos del hallazgo, que
es lo único que ese lector tiene para leer.

### La tira NO se bloquea mientras se compone el alta

El requisito anterior retiraba la navegación mientras se componía cualquier compromiso. La razón
escrita del bloqueo es que el borrador se perdería al cambiar de panel, y para el alta es falsa:
los tres campos viven en el estado de `FindingLifecycle`, sobreviven a que el `<form>` se
desmonte y vuelven escritos al reabrir `Assigned`. El requisito se acota a la enmienda, que sí
guarda sus valores adentro de `EditAssignmentForm` y los perdería.

Consecuencia buscada: con la composición abierta se puede ir a leer `Raised` —lo observado, las
fotos, cuándo se registró— y volver. Que esos hechos estén al lado de la decisión es el argumento
por el que el compromiso dejó de ser un diálogo; el pliegue no lo puede deshacer.

### `Assigned` sin registro lo dice con palabras

Vuelve la rama `pending` de `FindingStageRecord`. Sin ella el panel abre con el encabezado
`Assigned`, nada debajo, y «Next step» a continuación: quien compone no tiene qué lo ubique en la
etapa. Y la rama que hoy atiende una etapa sin acciones anuncia que el registro «needs a
connection», que sobre un hallazgo levantado es falso. La distinción entre no haber registrado
nada y no poder leer lo registrado es un requisito, y las dos ramas tienen que existir.

### El pliegue vale solo donde el ciclo está en blanco

El ciclo se dejó a la vista porque plegarlo cobraba una pulsación por hallazgo para ver en qué
anda cada uno. Ese precio existe cuando hay algo escrito. Un hallazgo `raised` no tiene
compromiso, ni eventos, ni plazo: sus cinco segmentos están vacíos y la única lectura posible es
la que el control ya nombra. Por eso el pliegue se ata a `creating` —el control de alta, que
`nextStep` solo devuelve sobre un hallazgo levantado que quien lee puede asignar— y no al estado
del hallazgo a secas.

Se oculta con `hidden`, no se desmonta: plegar y volver a abrir tiene que devolver la etapa
elegida y lo escrito donde estaban, o el control sería un `Cancel` disfrazado.

## Risks / Trade-offs

- **Una pulsación más para asignar.** → Es la que decide leer ESE hallazgo, sobre una ficha que
  no tenía nada que leer. A cambio, una inspección con seis hallazgos levantados deja de apilar
  seis formularios y seis tiras vacías.
- **`aria-selected` sobre una etapa no alcanzada.** Un lector de pantalla oye `Assigned`
  seleccionada mientras `aria-current` sigue en `Raised`. → Es la distinción que el stepper ya
  hace, y el panel lo dice además con palabras: «Nothing has been recorded here yet».
- **El texto del control es una copia.** `Create a corrective action` no sale de `step.label`
  («Create corrective action»), así que hay dos textos para el mismo acto y pueden divergir. →
  Es el texto pedido; queda anotado en el componente.
- **Churn de specs.** El requisito se reescribe dos veces en un día, en direcciones opuestas para
  el caso del alta. → El change archivado queda como el registro de por qué los otros tres pasos
  no se mueven; este acota, no revierte.

## Migration Plan

No aplica: sin migración, sin despliegue de servidor, sin dato que convertir. Volver atrás es
revertir el commit.
