## Context

See proposal.md - Why. La ruta ya recibe todas las reglas y todos los periodos visibles para la
sesion y deriva el ano con `projectYear()` en el cliente. Esa proyeccion es correcta para
frecuencias de 1, 3, 6 y 12 meses, para ventanas de vigencia y para periodos existentes fuera de
una regla actual.

La presentacion actual convierte cada entrada en una tarjeta completa. Una regla mensual genera
doce selectores y doce botones aun cuando once periodos no se han abierto; varias reglas
multiplican ese costo visual y de consultas. `PeriodsSection` ofrece grid y lista, pero ambas
presentan el mismo contenido de tarjeta sin cambiar la tarea que resuelven.

La ruta es online-only y el servidor sigue siendo la autoridad para permisos, elegibilidad e
inmutabilidad. `SitePicker` y `RowMenu` ya resuelven patrones compartidos; los dialogos de la app
ya tienen estructura visual y objetivos de toque consistentes.

Este change **no modifica ninguna tabla inmutable**. `inspection_schedule` y
`scheduled_inspection` se leen y mutan solo mediante las operaciones existentes; no hay migracion,
GRANT, trigger ni politica RLS nueva. ADR-002/ADR-004 siguen delimitando que campos pueden cambiar,
y ADR-005 sigue delimitando la apertura y congelacion de version.

## Goals / Non-Goals

**Goals:**

- Hacer legible un ano completo con varias reglas sin repetir formularios por periodo.
- Dar funciones distintas a matrix y list sobre la misma proyeccion.
- Concentrar cada escritura en un dialogo que explique sus consecuencias antes de confirmar.
- Mantener visibles los periodos no abiertos, cancelados, omitidos y fuera de regla.
- Hacer que avisos, resumenes y filtros hablen solo del sitio y ano elegidos.
- Mantener la ruta utilizable con teclado, lector de pantalla y telefono.

**Non-Goals:**

- No cambiar la aritmetica de recurrencia, los estados derivados ni `projectYear()`.
- No abrir periodos en bloque ni adelantar el trabajo automatico.
- No agregar fechas, horas, recordatorios ni frecuencias fuera de 1, 3, 6 y 12 meses.
- No cambiar endpoints, contratos, permisos del servidor ni almacenamiento.
- No convertir la programacion online en una funcion offline o sincronizable.

## Decisions

### D1 - Matrix y list consumen el mismo `YearEntry[]`

`projectYear()` sigue siendo la unica fuente de entradas. La toolbar aplica filtros puros a su
resultado y entrega esa misma lista filtrada a `ScheduleMatrix` o `ScheduleList`. Los componentes
solo deciden como presentar una entrada; no vuelven a calcular si una regla debe un periodo.

La alternativa era construir doce columnas directamente desde las reglas y dejar que la lista
siguiera usando `projectYear()`. Se descarta porque crearia dos implementaciones para periodos
huerfanos, cancelados/reprogramados y ventanas de vigencia, precisamente los casos mas sensibles.

### D2 - La matrix es la vista anual y la list es la vista operativa

En pantallas amplias, la matrix usa una fila por requisito y doce posiciones de mes. Una posicion
no debida queda vacia; una debida es una celda interactiva con etiqueta accesible completa y estado
redundante en texto/forma, no solo color. La primera columna permanece reconocible durante el
desplazamiento horizontal.

La list usa una fila por periodo proyectado con periodo, requisito, estado e inspector. En viewport
pequeno es la vista inicial porque mantiene objetivos de 48px y no obliga a operar una tabla de
doce columnas. El estado elegido se conserva solo durante la vida de la ruta.

La alternativa era conservar tarjetas responsive. Se descarta porque cambia el numero de columnas
pero no reduce duplicacion ni permite comparar la cadencia de varias reglas.

### D3 - Una entrada abre un unico detalle de periodo

`PeriodDialog` recibe un `YearEntry`. Para una entrada `unopened` monta la operacion de apertura;
para una abierta muestra sus datos y, si corresponde, la asignacion confirmable. Cancelar y volver
a programar conservan dialogos separados porque tienen consecuencias distintas, pero se abren
desde el detalle y adoptan la estructura `modal__head`, `modal__text` y `modal__actions`.

Las consultas de candidatos y plantilla se habilitan solo cuando el dialogo necesita esos datos.
Esto reemplaza los formularios y consultas montados en cada tarjeta sin mover la validacion al
cliente. Las mutaciones siguen sin actualizacion optimista y mantienen sus invalidaciones actuales.

La alternativa era un panel lateral permanente. Se descarta porque agregaria un patron nuevo a la
app y en telefono terminaria comportandose como el dialogo que ya existe.

### D4 - Los requisitos se administran como filas compactas y dialogos

`RequirementsSection` muestra una fila actual por plantilla con nombre, cadencia, inspector por
defecto y estado. La accion primaria `Add requirement` abre `RequirementDialog`; el menu de fila
abre la edicion del inspector por defecto o la confirmacion de desactivacion. Reactivar usa tono
neutral, no peligro.

El alta carga plantillas y candidatos una sola vez, envia el `default_inspector_id` opcional que el
contrato ya acepta y deriva una vista previa legible de los meses de inicio. Para frecuencia mensual
no presenta ancla. La inmutabilidad de frecuencia y ancla se explica una vez junto a la
confirmacion, no repetida en cada fila.

La alternativa era editar todos los campos inline. Se descarta porque mezcla lectura con cambios
inmediatos, deja poco espacio para explicar la inmutabilidad y repite el problema actual en una
seccion mas pequena.

### D5 - Resumenes y avisos son vistas del ano proyectado

Las funciones puras calculan `total`, `completed`, `missed`, `unassigned` y `unopened` sobre las
entradas del ano seleccionado. Los subconjuntos pueden solaparse solo donde la semantica lo exige;
por ejemplo, `missed` y `unassigned` describen dos problemas distintos del mismo periodo. Un
cancelado forma parte de `total`, pero no de ninguno de los subconjuntos accionables.

Cada resumen aplica un filtro de estado. El aviso superior deja de buscar en todos los periodos
del sitio: usa las entradas del ano y activa `unassigned`, por lo que nunca enlaza a un nodo que no
esta montado.

La alternativa era mantener una barra de numeros no interactiva. Se descarta porque ocupa espacio
sin ayudar a encontrar el trabajo que cuenta.

### D6 - Error y vacio son estados distintos en cada operacion

La ruta mantiene el error global de reglas/periodos. Los dialogos muestran por separado los fallos
de plantillas y candidatos y deshabilitan solo la operacion que depende de ellos. Una respuesta
exitosa vacia conserva su mensaje de dominio (`Every published template...` o ausencia real de
candidatos); un rechazo de red no se representa con una lista vacia.

No se crea una capa global nueva de errores: cada consulta de apoyo pertenece al dialogo que la
necesita y el error se presenta alli.

### D7 - La composicion sigue las fronteras de la ruta

`SchedulingRoute` conserva queries, sitio, ano, permiso y seleccion de vista/filtros. La
composicion se reparte en `RequirementsSection`, `RequirementRow`, `RequirementDialog`,
`ScheduleSection`, `ScheduleToolbar`, `ScheduleMatrix`, `ScheduleList` y `PeriodDialog`.

Los subcomponentes permanecen dentro de `SchedulingRoute/` porque no cruzan rutas. `SitePicker` y
`RowMenu` siguen en `components/`. La logica de etiquetas, resumenes, filtros y orden permanece en
`presentation.ts` con tests al lado, segun ADR-008.

### D8 - El lenguaje visual es una superficie de planificacion, no una grilla de tarjetas

El calendario vive dentro de una sola superficie delimitada. Las lineas separan filas y meses; el
color semantico refuerza estados pero nunca sustituye su nombre accesible. Los iconos repetidos de
calendario desaparecen de cada periodo. Todos los colores y medidas usan tokens existentes o
nuevos tokens declarados en las capas permitidas por `check-tokens.mjs`.

La matrix puede desplazarse horizontalmente sin ampliar el documento; la list se adapta a filas
apiladas. Controles, celdas interactivas y acciones conservan el minimo de 48px de ADR-010.

## Risks / Trade-offs

- **La matrix comprime demasiada informacion en doce columnas** -> la celda muestra solo estado y
  una senal breve; el detalle completo vive en el dialogo, y la list ofrece la lectura textual.
- **Matrix y list divergen con el tiempo** -> ambas reciben el mismo arreglo filtrado y las pruebas
  verifican igualdad de entradas y estados.
- **Mover acciones a un dialogo agrega un clic** -> elimina decenas de controles competidores y
  reserva la interaccion adicional para una escritura que ya requiere contexto o confirmacion.
- **Los filtros pueden ocultar que el ano contiene mas trabajo** -> la toolbar conserva los conteos
  completos, nombra el filtro activo y ofrece `Clear filters`.
- **Cambiar muchas expectativas del test de ruta puede perder cobertura** -> se reemplazan
  aserciones de repeticion del DOM por aserciones de entradas accesibles y llamadas de mutacion;
  los casos de permisos, error, cancelacion y reprogramacion se conservan.
- **El contenido ancho puede ser dificil en tablet** -> la matrix limita su overflow a la
  superficie y mantiene identificable la primera columna; la list siempre queda disponible.

## Migration Plan

No hay migracion de datos ni despliegue coordinado. El cambio se entrega en el bundle web y usa
los contratos y endpoints existentes. El rollback consiste en restaurar la composicion y estilos
anteriores; no hay datos nuevos que convertir o eliminar.
