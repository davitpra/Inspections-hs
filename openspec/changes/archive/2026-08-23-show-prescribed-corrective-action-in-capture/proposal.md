## Why

A template question can already prescribe what to do when it fails — the author writes a
`corrective_action` in the builder, it is frozen into the published document, and the
field package carries it onto the device. The one person who needs it never sees it. The
inspector answers `no`, is asked what is wrong and for a photo, and is told nothing about
the work the organization already decided on for that exact failure.

The change that introduced the block said so itself, in its design risks: *"La
prescripción no llega a la acción correctiva. Hasta que un change la conecte, el
coordinador sigue escribiendo la descripción a mano y el dato queda solo escrito."* This
is the first half of that debt, and the cheap half — the text is already on the device,
offline, with no request to make.

**Etapa de §7:** ninguna. Este change no cierra una etapa: refina la captura de la etapa 3
con un dato que solo existe desde que la etapa 8 le dio al coordinador dónde escribirlo.
Existe porque el hueco es de un solo lado — el dato viaja completo hasta el dispositivo y
se detiene a un componente de distancia del inspector.

## What Changes

- Al responder negativo, junto al bloque de hallazgo aparece la `corrective_action`
  prescrita de esa pregunta, de solo lectura, sin ninguna petición de red.
- Una pregunta sin bloque `finding` no muestra nada: no hay texto de relleno ni un
  "sin acción correctiva definida".
- La descripción que escribe el inspector **no** se prellena ni se altera. El texto del
  autor y la observación del inspector son dos cosas distintas y se leen distinto.
- El umbral `fails_when` **no** se muestra. El motor no lo evalúa (`findings` — *"the
  engine does not read it"*); mostrarlo en la recorrida sugeriría que el sistema lo aplica.
- Sin cambios de API, de esquema, de migraciones ni de `packages/forms`. Es presentación.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `offline-capture`: el bloque de hallazgo que se abre ante una respuesta negativa suma
  un requisito nuevo — mostrar la prescripción congelada de la pregunta, sin red, sin
  prellenar la descripción, y sin mostrar nada cuando la pregunta no prescribe.

## Impact

- `apps/web/src/components/FindingFields.tsx` — recibe el texto prescrito y lo muestra.
- `apps/web/src/routes/CaptureRoute/ItemRow.tsx` — se lo pasa desde el ítem que ya tiene.
- `apps/web/src/index.css` — estilo del bloque informativo, con tokens semánticos.
- `apps/web/src/routes/CaptureRoute/index.test.tsx` — cobertura de los dos casos.
- Nada en `apps/api`, `packages/contracts` ni `packages/forms`.
