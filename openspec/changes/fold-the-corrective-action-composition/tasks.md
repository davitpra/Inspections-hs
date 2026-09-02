## 1. La decisión, sin renderizar

- [x] 1.1 Devolver a `openableStages` su segundo parámetro `draft: FindingStage | null` y
      reescribir su doc-comment: hay una excepción, y es la etapa que una composición
      desplegada escribiría.
- [x] 1.2 Cubrirlo con pruebas unitarias: sin borrador solo las etapas alcanzadas; con borrador
      `assigned`, un hallazgo `raised` ofrece `Raised` y `Assigned` y nada más.

## 2. El ciclo plegado

- [x] 2.1 Agregar a `FindingLifecycle` el estado `opened` y derivar `draft` de `creating &&
      opened`; al desplegar, elegir la etapa `assigned`.
- [x] 2.2 Dibujar el control que pliega —`Create a corrective action` / `Hide`— con
      `aria-expanded` y `aria-controls`, y envolver tira y panel en un cuerpo con `hidden`, que
      se oculta sin desmontarse.
- [x] 2.3 Colgar la consulta del roster de `creating && opened`.
- [x] 2.4 Devolver la condición del paso a `selected === (draft ?? finding.state)`.

## 3. El segmento y su registro

- [x] 3.1 Devolver la prop `draft` a `FindingStepper`, pasarla a `openableStages` y marcar ese
      segmento con `finding__stage--draft`.
- [x] 3.2 Devolver la prop `pending` a `FindingStageRecord` y su rama de etapa sin registrar,
      conservando el aviso de registro ilegible como rama distinta.
- [x] 3.3 Restaurar en `index.css` los estilos del control, del cuerpo plegado y del segmento
      borrador, con tokens ya existentes.

## 4. Lo que los doc-comments afirman

- [x] 4.1 Reescribir los bloques de `FindingLifecycle`, `FindingStepper`, `FindingStageRecord` y
      `openableStages` que hoy afirman que el ciclo está siempre a la vista y que no hay ninguna
      etapa no alcanzada que se ofrezca.

## 5. Verificación

- [x] 5.1 Adaptar las pruebas de ruta: el helper que busca el formulario pulsa primero el
      control, y los casos que parten de un hallazgo levantado despliegan antes de leer el ciclo.
- [x] 5.2 Agregar los casos nuevos: plegado no hay tira ni roster; desplegado el formulario está
      en `Assigned` con el aviso de no registrado y `aria-current` en `Raised`; ir a `Raised` y
      volver conserva lo escrito; un lector que no puede crear ve el ciclo sin plegar.
- [x] 5.3 Ejecutar las pruebas específicas, lint, build y typecheck en el orden del repositorio.
- [x] 5.4 Validar estrictamente el change de OpenSpec.
