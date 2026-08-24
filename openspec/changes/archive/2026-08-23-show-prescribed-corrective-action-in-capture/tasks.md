## 1. El bloque informativo

- [x] 1.1 En `apps/web/src/components/FindingFields.tsx`, agregar la prop
      `correctiveAction: string | undefined` (la cadena, no el ítem — ver design.md,
      Decisions).
- [x] 1.2 Renderizar el bloque de solo lectura **antes** de la etiqueta "What is wrong?",
      solo cuando hay texto: un título corto y el texto prescrito. Sin encabezado ni
      leyenda cuando no hay prescripción.
- [x] 1.3 Confirmar que el `<textarea>` no cambia: sin `placeholder` con el texto
      prescrito, sin valor inicial derivado de él, y con su `hint` del mínimo intacto.
- [x] 1.4 Ampliar el comentario de cabecera del archivo con la razón: lo prescrito se
      muestra, lo observado se escribe, y no se mezclan.

## 2. Conectarlo a la captura

- [x] 2.1 En `apps/web/src/routes/CaptureRoute/ItemRow.tsx`, pasar
      `correctiveAction={item.finding?.corrective_action}` a `FindingFields`. El ítem ya
      está en scope; no se agrega ningún dato nuevo a la fila.
- [x] 2.2 Verificar que `Preview.tsx` no requiere cambios (monta `ItemRow` con
      `negative={false}` y nunca llega al bloque de hallazgo).

## 3. Estilo

- [x] 3.1 Agregar la regla del bloque informativo en `apps/web/src/index.css`, usando
      solo tokens semánticos (`scripts/check-tokens.mjs` falla el build ante un color
      literal). No estilar el resto del bloque `.finding`, que hoy está sin reglas y es
      otro trabajo.

## 4. Tests

- [x] 4.1 Si el fixture de plantilla de `packages/forms/src/testing` no tiene un ítem con
      bloque `finding`, extenderlo con uno — sin romper los tests que ya lo usan.
      *Resultado: no hizo falta. `index.test.tsx` construye sus documentos inline y no usa
      ese fixture.*
- [x] 4.2 En `apps/web/src/routes/CaptureRoute/index.test.tsx`: responder `no` en un ítem
      con prescripción muestra el texto y deja la descripción vacía.
- [x] 4.3 En el mismo test: responder `no` en un ítem sin bloque `finding` no muestra
      ningún texto de acción correctiva.

## 5. Verificación

- [x] 5.1 `pnpm -r build` y después `pnpm typecheck`, en ese orden.
- [x] 5.2 `pnpm --filter web exec vitest run src/routes/CaptureRoute/index.test.tsx` y
      `pnpm lint`.
- [x] 5.3 Manual con la red cortada en DevTools: abrir una inspección preparada para
      campo con una pregunta que prescriba, responder `no`, y confirmar que el texto
      aparece sin ninguna petición de red y que "What is wrong?" sigue vacío.
