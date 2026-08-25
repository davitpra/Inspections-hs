## Context

El calendario anual ya proyecta, para una planta y un año, todos los períodos que sus
reglas deben, y ya distingue el mes que ninguna regla empieza del período que se debe pero
todavía no se abrió. Lo que no existe es la vista de un requisito solo: la proyección
existe, pero solo se presenta como una grilla de todos contra los doce meses, y las
operaciones de un período solo se alcanzan desde una casilla de esa grilla.

El change es enteramente de `apps/web`. **No toca ninguna tabla inmutable y no lleva
migración**: no agrega columnas, no agrega endpoints y no cambia el trabajo automático de
apertura. Aplican ADR-002 y ADR-004 solo para dejar constancia de que el alcance por sitio
lo sigue resolviendo RLS sobre las mismas lecturas, y ADR-008 porque la decisión se queda
dentro de `inspections` y la lógica pura de la pantalla vive en su propio archivo, aparte
del componente.

## Goals / Non-Goals

**Goals:**

- Poder planificar el año de un requisito sin recorrer el calendario de todos.
- Mostrar exactamente los períodos que la regla debe, y ninguno más.
- Resolver cada período sin arrastrar el estado de los demás.
- No agregar una quinta copia de la aritmética de períodos.

**Non-Goals:**

- Cambiar la frecuencia o el ancla de una regla, ni por esta pantalla ni por otra.
- Reemplazar el calendario anual ni la vista enfocada de un período.
- Cancelar o volver a programar un período desde esta pantalla.
- Planificar más de un requisito a la vez, o más de un año a la vez.

## Decisions

### La pantalla se direcciona por la regla y no monta una lectura propia

La ruta lleva el identificador de `inspection_schedule` y resuelve la regla buscándola en
la misma lectura de reglas que ya alimenta la pantalla de programación. No se agrega un
`GET` por identificador: duplicaría la proyección de lectura del servicio y una segunda
clave de caché para devolver exactamente la misma fila. El alcance lo sigue resolviendo
RLS sobre esa lectura, así que una regla de otra planta simplemente no está y la pantalla
responde que no se encontró, sin decidir nada por su cuenta.

Como el identificador es el de la regla y una regla desactivada y recreada es otra fila,
un enlace viejo puede quedar sin destino. Es preferible a direccionar por planta y
plantilla: la pantalla habla de UNA regla —su frecuencia, su ancla, su ventana— y unificar
dos reglas distintas bajo una dirección haría que el encabezado mintiera sobre la mitad de
las filas.

### Las filas son la proyección que ya existe, aplicada a una sola regla

Las filas se obtienen proyectando el año con esa única regla y los períodos de su
plantilla. Es la misma función que arma el calendario anual: ya filtra los meses por el
ancla y la frecuencia, ya respeta la ventana entre creación y desactivación, ya elige
entre el período cancelado y el que lo reemplaza, y ya agrega el período que existe aunque
ninguna regla vigente lo reclame.

Esto es deliberado y es la decisión más importante del change. La aritmética del período
está duplicada a propósito en cuatro lugares —el navegador, el servidor, el SQL del
trabajo de apertura y la lectura del reporte— porque corren en motores distintos, y la
defensa acordada es que sus tests fijen los mismos casos. Una quinta copia escrita para
esta pantalla no tendría con qué contrastarse.

### Dos columnas, y el estado en la primera

La primera columna nombra el período y su estado; la segunda es el inspector. No hay una
tercera columna de estado: el estado califica al período, no es un dato independiente, y
la tabla tiene que poder leerse en un teléfono. El nombre del período se recorta el año
cuando termina en el año que se está mirando, igual que en el calendario anual, porque el
navegador de año ya lo dice arriba; un período que cruza al año siguiente conserva el año,
que es lo único que deja ver que se va.

### Abrir y asignar son dos gestos, en ese orden

Un período que no existe ofrece una sola acción, que lo abre y nombra la versión publicada
que va a congelar. Recién cuando la fila existe aparece el selector de inspector. Congelar
la versión de una plantilla para siempre no puede ser el efecto colateral de elegir un
nombre en una lista, y menos en una tabla donde el gesto se repite doce veces seguidas.

Elegir en el selector tampoco manda nada: hace falta confirmar. Es la misma regla que ya
rige la asignación en la vista enfocada de un período, y por el mismo motivo —recorrer un
selector con el teclado dispara un cambio por opción—, así que la pantalla reutiliza ese
control en lugar de escribir otro con la misma advertencia.

### Cada fila se resuelve sola

No hay un guardado de la tabla entera. Cada fila manda su operación, muestra su estado de
pendiente y muestra el motivo del servidor si falla, sin tocar a las demás. Un guardado
global obligaría a inventar qué significa que once meses se guarden y uno no, y dejaría
estado sin guardar que se pierde al navegar. Como no hay actualización optimista, una
asignación rechazada deja a la vista el inspector que sigue estando persistido.

### Completado y cancelado se leen; vencido se sigue asignando

Un período completado ya tiene su inspección firmada y un cancelado no tiene dueño que
asignar: los dos se leen, con su inspector y su motivo. El vencido sin enviar NO se
bloquea. Su estado se deriva de la fecha y no de una decisión: la fila sigue viva, la
ingesta rechaza la cancelada y la ajena pero nunca la vencida, así que asignarle un
inspector sigue siendo la forma de que alguien pueda enviarla.

### El navegador de año pasa a ser compartido

El mismo navegador con el mismo tope hacia atrás lo usan ahora dos pantallas, así que sube
a los componentes compartidos en vez de copiarse. El tope se calcula igual: el año en
curso, o uno más viejo si la regla o alguno de sus períodos ya existe ahí.

## Risks / Trade-offs

- [La tabla ofrece abrir períodos futuros de a uno y cada apertura congela una versión de
  plantilla para siempre] → la acción nombra la versión que va a congelar en su propio
  texto, y el pie de la pantalla dice qué significa; abrir sigue siendo un gesto por
  período, nunca en lote.
- [Un enlace a una regla desactivada y recreada queda sin destino porque el identificador
  cambió] → la pantalla de no encontrado lo dice y devuelve a la programación de la
  planta, donde está el requisito vigente.
- [Una fila por período multiplica los estados de error de una misma pantalla] → cada uno
  se muestra en la fila que lo produjo, como ya hace la tabla de requisitos, y ninguna
  operación depende de otra.
- [La pantalla depende de una lectura de todas las reglas visibles para resolver una] → es
  la misma consulta ya cacheada que usa la programación, así que llegar desde ahí no
  agrega una ida al servidor; entrar por enlace directo la trae una vez.

## Migration Plan

No hay migración: el change no toca el esquema, ni los privilegios, ni los triggers, ni
ninguna tabla inmutable.

Rollback: revertir el commit. La ruta desaparece y la tabla de requisitos vuelve a mostrar
el nombre como texto; no queda ningún dato escrito por esta pantalla que no pudiera
haberse escrito desde el calendario anual.
