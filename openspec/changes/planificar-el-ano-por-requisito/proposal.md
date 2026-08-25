## Why

La tabla de requisitos de inspección dice qué debe una planta y cada cuánto, pero no deja
planificarlo. Para repartir el año de un solo requisito —quién hace cada uno de sus
períodos— hoy hay que bajar al calendario anual, que mezcla todos los requisitos de la
planta en una grilla de doce columnas, y abrir un diálogo por casilla. Una regla mensual
son doce aperturas de modal repartidas por una grilla que no está ordenada por el
requisito que se está planificando, y en ningún momento se ve el año de ese requisito
como una sola cosa.

El nombre de cada requisito pasa a llevar a su propia pantalla, y esa pantalla es la
lista de los períodos que ese requisito debe en el año elegido, con el inspector de cada
uno al lado. Los meses que la regla no debe no aparecen: una regla trimestral tiene
cuatro filas, no doce casillas de las que ocho dicen «no corresponde».

Este change no cierra una etapa nueva de `docs/requisitos-v1.2.md` §7: completa la
**etapa 7** —recurrencia y consulta operativa de períodos— agregando la superficie que
faltaba para operar los períodos de un requisito, sin cambiar el modelo de recurrencia
que esa etapa fijó.

## What Changes

- Convertir el nombre de cada requisito de la tabla de programación en un enlace a la
  pantalla de ese requisito.
- Agregar una pantalla por requisito, direccionada por el identificador de
  `inspection_schedule`, con una fila por período que ese requisito debe en el año
  elegido y ninguna fila para los meses que no debe.
- Ofrecer en cada fila la operación que corresponde a ese período: abrir el que todavía
  no existe, o elegir y confirmar el inspector del que ya existe.
- Mantener separados abrir y asignar: abrir congela la versión publicada de la plantilla,
  así que sigue siendo un acto propio y nombrado, y el inspector se elige después.
- Dejar de solo lectura los períodos completados y los cancelados, y mantener asignable
  el período vencido sin enviar, que sigue pudiendo enviarse.
- Resolver cada fila por separado: su propia confirmación, su propio estado de pendiente
  y su propio error, sin un guardado global de la tabla.
- Navegar de año en los dos sentidos con el mismo tope hacia atrás que ya usa el
  calendario anual.
- Mantener la pantalla legible, sin ningún control, para cuentas sin permiso de
  administración de programación.

Fuera de alcance: cambiar `frequency_months` o `anchor_month`, que siguen siendo
inmutables y se siguen cambiando desactivando la regla y creando otra; cancelar o volver
a programar un período, que siguen viviendo en el calendario anual; y cualquier cambio de
esquema, de API o del trabajo automático de apertura.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections` — plan anual por requisito y operación de sus períodos fila por fila.

## Impact

- Ninguna migración: no se toca el esquema ni ninguna tabla inmutable.
- Ningún endpoint ni contrato nuevo: la pantalla se sirve de las lecturas y operaciones
  de programación que ya existen.
- Nueva ruta web y su carpeta, más un enlace en la tabla de requisitos.
- El navegador de año pasa a ser un componente compartido entre las dos pantallas.
- Pruebas de presentación y de ruta en `apps/web`.
