## Context

Ver `proposal.md` — Why. Lo que hace falta acá es el estado actual del camino del dato:

- El bloque `finding` cuelga del ítem en el documento publicado y se congela con él.
  Publicar valida que la `corrective_action` no esté en blanco, así que un bloque que
  existe siempre trae texto: la UI no tiene que defenderse de una cadena vacía.
- El paquete de campo lleva el documento entero al dispositivo en la descarga previa. El
  texto ya está en Dexie antes de que el inspector salga a caminar; leerlo no agrega una
  petición ni un modo de fallo offline (ADR-001).
- La captura ya recibe el ítem completo por ítem. El componente que dibuja la fila y el
  que dibuja el bloque de hallazgo están a una prop de distancia del dato.
- El único lugar que hoy muestra la prescripción es la pantalla de lectura de la plantilla
  publicada, que el inspector no visita durante la recorrida.

**Tablas inmutables: ninguna.** El change no escribe en la base, no agrega migración y no
toca el esquema. `template_version` y `template_version_item` se leen tal como están
(ADR-002 no entra en juego).

## Goals / Non-Goals

**Goals:**

- Que el texto prescrito aparezca en el mismo lugar y en el mismo momento en que se piden
  la descripción y la foto.
- Que la separación entre lo prescrito y lo observado sea visible en pantalla, no solo
  cierta en los datos.

**Non-Goals:**

- Derivar, evaluar o interpretar la prescripción. `packages/forms` no se toca: la
  decisión de qué respuesta es negativa sigue siendo la misma función que corre el
  servidor (ADR-007), y este change no le agrega una segunda opinión al cliente.
- Llevar la prescripción hacia la acción correctiva. Prellenar la `description` de una
  `corrective_action` sigue fuera de alcance, como lo declaró el change que introdujo el
  bloque.

## Decisions

**El bloque va arriba de "What is wrong?", no abajo.** Es contexto para redactar la
observación, no un comentario sobre ella. Abajo se leería como una respuesta a lo que el
inspector acaba de escribir, y llegaría cuando ya escribió.

*Alternativa considerada:* un desplegable cerrado por default. Se descarta: un texto que
hay que ir a buscar es un texto que en la recorrida no se lee.

**`FindingFields` recibe la cadena, no el ítem.** La prop es
`correctiveAction: string | undefined` y no `item: TemplateItem`. El componente no
necesita el tipo de respuesta ni la config, y la prop angosta hace imposible que más
adelante alguien lea el prompt o el umbral desde adentro del bloque de hallazgo. La
decisión de qué parte del ítem es visible en la captura queda en un solo lugar.

*Alternativa considerada:* pasar `item` entero, que es más corto de escribir. Se descarta
por lo mismo que se descarta un `readOnly` que viaja hacia adentro: la restricción se
asegura no dándole el dato, no confiando en que nadie lo use.

**El texto no se copia a la descripción, ni siquiera como placeholder.** Un `placeholder`
con el texto del autor invita a escribir "lo mismo" o a dejarlo pasar como si estuviera
lleno. Es el error que corrigió el retiro del nivel de control prescrito: un valor que
nadie eligió termina leyéndose como evidencia. El `hint` del mínimo de caracteres se queda
como está.

**Ausencia = nada.** Una pregunta sin bloque `finding` no dibuja encabezado ni leyenda.
Un "No corrective action defined" convierte lo que el autor no decidió en una afirmación
de la plantilla, y aparecería en la mayoría de las preguntas de las plantillas existentes.

**El bloque necesita CSS propio.** Hoy `.finding`, `.finding__title` y `.finding__hint` no
tienen ninguna regla en `index.css`: el bloque de hallazgo está sin estilar. Este change
estila lo que agrega, con tokens semánticos — `scripts/check-tokens.mjs` falla el build
ante un color literal — y no se mete a estilar el resto, que es otro trabajo.

## Risks / Trade-offs

**El inspector confunde la prescripción con lo que tiene que escribir** → El bloque se
titula por lo que es y va visualmente separado del campo; el campo conserva su propia
etiqueta ("What is wrong?") y su hint del mínimo. Un escenario de la spec fija que la
descripción sigue vacía después de responder negativo.

**Una prescripción larga empuja el campo fuera de la pantalla del teléfono** → El texto lo
escribe un autor en un textarea sin tope declarado, así que puede ser largo. Se acepta en
este change: el bloque es texto que fluye, no se recorta, y recortarlo con un "ver más"
esconde justo lo que se vino a mostrar. Si aparece en la práctica, la respuesta es un tope
en el builder, no una truncadura en la captura.

**La spec vecina de `offline-capture` está desactualizada** — el requisito de los detalles
del hallazgo todavía pide "a location" y una lista de ubicaciones que la UI ya no muestra,
porque la sección declara la ubicación conceptual y la resuelve el servidor. Es anterior a
este change y no se arregla acá: el delta agrega un requisito y no toca ese. Queda anotado
para un change propio.
