## 1. Navegación y ruta

- [x] 1.1 Declarar `/scheduling/$scheduleId` después de `/scheduling` en el árbol de rutas,
      fuera de `/inspections/` para no entrar al precache del service worker.
- [x] 1.2 Convertir el nombre del requisito de la tabla de programación en un enlace a esa
      ruta, disponible también para cuentas lectoras y para requisitos desactivados y
      archivados.

## 2. Plan anual del requisito

- [x] 2.1 Armar la ruta resolviendo la regla por identificador dentro de la lectura de
      reglas ya cacheada, con estados de carga, de error de conexión y de requisito no
      encontrado con vuelta a la programación.
- [x] 2.2 Proyectar las filas del año con la proyección anual existente aplicada a esa
      única regla y a los períodos de su plantilla, sin escribir aritmética de períodos
      nueva.
- [x] 2.3 Encabezar la pantalla con el requisito, su planta, su cadencia y la advertencia
      de que la cadencia no se cambia ahí.
- [x] 2.4 Extraer el navegador de año a un componente compartido y usarlo en las dos
      pantallas, conservando el mismo tope hacia atrás.

## 3. Operación fila por fila

- [x] 3.1 Ofrecer en un período no abierto una sola acción que lo abre nombrando la versión
      publicada que congela, sin selector de inspector.
- [x] 3.2 Ofrecer en un período abierto y vigente o vencido el selector de inspectores
      elegibles con confirmación explícita, reutilizando el control de asignación
      existente.
- [x] 3.3 Dejar de solo lectura el período completado y el cancelado, mostrando su
      inspector y su motivo de cancelación.
- [x] 3.4 Mantener el estado de pendiente y el error del servidor dentro de la fila que los
      produjo, sin actualización optimista y sin guardado global.
- [x] 3.5 Retirar todos los controles para cuentas sin permiso de administración de
      programación, conservando estado e inspector legibles.

## 4. Presentación y estilos

- [x] 4.1 Aislar en la lógica pura de la ruta la etiqueta de cada fila y qué control
      corresponde a cada estado, con sus pruebas.
- [x] 4.2 Agregar los estilos de la tabla usando la capa semántica de tokens, sin colores
      literales.

## 5. Pruebas

- [x] 5.1 Cubrir en la lógica pura las cuatro frecuencias, el ancla que no es enero, la
      ventana de la regla y el período que ninguna regla vigente reclama.
- [x] 5.2 Cubrir en la ruta abrir sin asignar, asignar con confirmación, el error acotado a
      una fila, el período completado y el cancelado de solo lectura, la navegación de año,
      el requisito no encontrado y la vista sin permisos.
- [x] 5.3 Cubrir el enlace nuevo en las pruebas de la pantalla de programación.

## 6. Verificación

- [x] 6.1 Validar el change con `openspec validate planificar-el-ano-por-requisito --strict`.
- [x] 6.2 Ejecutar build antes de typecheck, lint y pruebas unitarias.
