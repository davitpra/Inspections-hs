## Why

Un hallazgo levantado dibuja el ciclo entero —la tira de cinco etapas, el registro de `Raised`
y el formulario de alta de tres campos— antes de que nadie decida mirarlo. Una inspección
recién enviada con seis hallazgos apila seis tiras sin nada escrito y seis formularios, sobre
la pantalla que existe para leer QUÉ SALIÓ MAL, y pide seis rosters por hallazgo
(`/findings/:id/roster`, uno por planta, ADR-017) antes de que nadie abra ninguno.

El ciclo se muestra a la vista porque leer en qué anda cada hallazgo no debe costar una
pulsación. Un hallazgo levantado, en cambio, no anda en nada todavía: sus cinco segmentos
están vacíos y lo único que hay para hacer es abrir la primera acción. Ahí el pliegue no
esconde ninguna lectura, y el control que lo abre es el próximo paso escrito con todas las
letras.

Este change no cierra una etapa de requisitos-v1.2 §7: ajusta la presentación de una
capacidad ya entregada —el ciclo navegable de la etapa 4— sin cambiar qué se guarda, quién
puede actuar ni qué devuelve ningún endpoint.

## What Changes

- Presentar un hallazgo `raised` que quien lee puede asignar detrás de un solo control con el
  nombre del acto, sin la tira de etapas ni el formulario, hasta que ese control se pulse.
- Devolver la composición del alta a la etapa que ESCRIBIRÍA —`Assigned`—, marcada en
  palabras como todavía no registrada y sin plazo, mientras el indicador del ciclo se queda
  donde el hallazgo está: `Raised`.
- Acotar la excepción a esa sola composición: los pasos de `assigned`, `in_progress` y
  `verification` siguen leyéndose en la etapa desde la que se ejecutan, junto a lo que esa
  etapa registró, y ninguna otra etapa no alcanzada se ofrece.
- Acotar el bloqueo de la navegación entre etapas a la enmienda de un compromiso, que es la
  única composición cuyo borrador no sobrevive a cambiar de panel.
- Pedir el roster de un hallazgo recién cuando alguien despliega su composición, y no al
  dibujar la pantalla.

Ninguno de estos puntos cambia el estado persistido: el control que abre la composición no
escribe nada, y el hallazgo pasa a `assigned` cuando el compromiso se envía, como hoy.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `findings`: el requisito «A recorded finding presents its persisted five-state lifecycle and
  one next step» cambia en tres puntos: el control que pliega la composición, la etapa en la
  que esa composición se lee y se marca como no registrada, y el alcance del bloqueo de la
  navegación.

## Impact

Solo `apps/web`, y dentro de él solo la ruta de hallazgos de una inspección enviada:
`FindingLifecycle.tsx`, `FindingStepper.tsx`, `FindingStageRecord.tsx`, `presentation.ts` y
sus dos archivos de prueba, más los estilos del control y del segmento en `index.css`.

Sin esquema, sin migración, sin cambios en `packages/contracts` ni en `apps/api`: el estado
del hallazgo lo sigue derivando el servidor de los eventos y el cliente sigue sin escribirlo.
Baja el número de peticiones a `GET /findings/:id/roster` en la primera lectura de una
inspección con varios hallazgos levantados.
