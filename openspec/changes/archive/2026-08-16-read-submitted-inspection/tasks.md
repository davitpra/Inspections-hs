## 1. El contrato de lo que se lee

- [x] 1.1 `submittedInspectionSchema` en `packages/contracts/src/submissions.ts` —
      **no en `inspections.ts`**, como decía este plan: lo que se lee de vuelta ES un envío,
      y ese archivo ya tiene `itemKeySchema` y `answerValueSchema` en alcance, así que
      ponerlo en `inspections.ts` habría exigido una tercera copia de `itemKeySchema`. Campos:
      `scheduled_inspection_id`, `inspection_id`, `template_version_id`, `template_version`,
      `template_name`, `site_id`, `period_start`, `document` (el `TemplateDocument` congelado),
      `answers` (`z.record(itemKeySchema, answerValueSchema)`), `findings`
      (`z.array(findingSchema)`), `submitted_by`, `submitted_by_name` (nulable, mismo criterio
      que `inspector_name`), `signed_at`, `received_at`, `answer_count`.
- [x] 1.2 Reusar `answerValueSchema` de `submissions.ts` y `findingSchema` de `findings.ts` —
      **no** redefinir ninguna de las dos. Si hay import cruzado entre módulos de contracts,
      resolverlo importando, no copiando.
- [x] 1.3 Tests del esquema: acepta un envío con respuestas de los nueve `response_type`;
      rechaza una `item_key` que no cumple `itemKeySchema`; `submitted_by_name` nulo pasa.

## 2. La lectura de los hallazgos, en su módulo

- [x] 2.1 `findingsForInspection(client, inspectionId)` en `apps/api/src/findings/findings.service.ts`
      —y no en un archivo aparte: reusa `FINDING_SELECT` y `toFinding`, que son privados de ese
      archivo. Devuelve
      `Finding[]` con la MISMA forma que `FindingsService.list`, incluidas `assessment` y
      `recurrence`. Sin `WHERE site_id`: lo recorta RLS.
- [x] 2.2 Reusar la consulta que ya arma un `Finding` en `findings.service.ts` en vez de
      escribir un segundo `SELECT` que se desincronice cuando cambie la forma del hallazgo.

## 3. El endpoint

- [x] 3.1 `InspectionsService.submittedInspection(session, scheduledInspectionId)`:
      `findActiveInspection` para el alcance, después la fila de `inspection`, el `document`
      de `template_version` por el `template_version_id` **de la inspección** (no el de la
      plantilla hoy), las filas de `inspection_answer`, y `findingsForInspection`.
      Todo dentro de un `withSessionClient`.
- [x] 3.2 Las respuestas se arman como mapa `item_key → value` desde las filas. Un ítem sin
      fila no aparece en el mapa: es lo que distingue "no contestado" de "contestado vacío".
- [x] 3.3 `GET /scheduled-inspections/:id/submission` en `inspections.controller.ts`, cuarta
      hermana de las tres del paquete de campo. Sin comprobación de rol: sesión + RLS, igual
      que las otras tres.
- [x] 3.4 Sin envío, o fuera del alcance → `inspection_not_found`, indistinguibles entre sí,
      con el mismo criterio que documenta `active-inspection.ts`.
- [x] 3.5 **Sin migración.** Verificar que no se agrega ningún `GRANT`, ningún `WHERE site_id`
      y ninguna escritura: el change toca tablas inmutables solo con `SELECT`.

## 4. Integración contra Postgres real

- [x] 4.1 Un envío se lee de vuelta con sus respuestas, su firmante, `signed_at`,
      `received_at` y `answer_count`.
- [x] 4.2 Publicar una versión nueva de la plantilla NO cambia lo que devuelve un envío
      anterior: el `document` sigue siendo el de la versión con la que se firmó. Es la
      aserción que protege ADR-005.
- [x] 4.3 Un ítem escondido por condición y nunca contestado no aparece en `answers`.
- [x] 4.4 Los hallazgos derivados del envío viajan; uno manual del mismo sitio y mes, no.
- [x] 4.5 Un período sin envío responde no encontrado; uno de otro sitio responde IGUAL.
- [x] 4.6 Leer no escribe: contar filas de `inspection`, `inspection_answer` y `finding`
      antes y después.

## 5. La pantalla

- [x] 5.1 `getSubmittedInspection(id)` en `apps/web/src/api/inspections.ts` y su clave en
      `query-keys.ts`.
- [x] 5.2 `apps/web/src/routes/InspectionReportRoute/` con `index.tsx`, `presentation.ts` +
      `.test.ts` e `index.test.tsx`, como manda CLAUDE.md.
- [x] 5.3 `presentation.ts`: `answerText(item, value)` — la respuesta como frase, por
      `response_type`. `yes_no`/`yes_no_na` en palabras, `single_choice`/`multi_choice` con la
      etiqueta de la opción y no su valor crudo, `photo` y `signature` como el conteo de lo que
      llevan ("3 photos", "Signed"), y el caso sin respuesta. Todo puro, con test.
- [x] 5.4 `index.tsx`: encabezado con mes, sitio, firmante y las dos fechas; después
      `sectionsInDocumentOrder` filtrado por `evaluateVisibility(document, answers)` — la
      recorrida que el inspector VIO, no el documento entero.
- [x] 5.5 Cada ítem muestra su pregunta y su respuesta como texto, **no** con `ItemRow`: un
      control deshabilitado no es una forma de leer un valor registrado.
- [x] 5.6 El hallazgo que abrió una respuesta se muestra junto a su ítem, con descripción,
      ubicación y el conteo de fotos. Que las fotos no se puedan ver tiene que leerse en la
      pantalla, no deducirse de su ausencia.
- [x] 5.7 Online-only con `retry: false` y su aviso, como el resto de lo que es de servidor.
- [x] 5.8 Registrar `/inspections/$id/report` en `router.tsx`. No entra a `WIDE_ROUTES` ni a
      la barra de navegación.

## 6. El link que reemplaza al botón inerte

- [x] 6.1 En `apps/web/src/components/CompletedInspectionsTable.tsx`, cambiar el
      `<button disabled>` por un `<Link to="/inspections/$id/report">` con el
      `ExternalLinkIcon` que ya está.
- [x] 6.2 El link se dibuja solo cuando `inspection_id` no es nulo — que es exactamente "hay
      un envío que leer". Con `inspection_id` nulo no se ofrece nada.
- [x] 6.3 Actualizar el test de `PastInspectionsRoute` que hoy afirma que el control está
      deshabilitado: pasa a comprobar que es un link y a dónde va.

## 7. Verificación

- [x] 7.1 `pnpm -r build && pnpm typecheck && pnpm lint && pnpm test`, en verde. Estuvo rojo
      un rato por un refactor de `PendingRoute` ajeno a este change —`DeviceDrafts` quedó
      commiteado en `33fbdf2` con `submittedFromDevice` comentada y sin su segunda tabla—;
      se cerró aparte y la tanda entera vuelve a pasar.
- [x] 7.2 `pnpm --filter api test:int` por el endpoint nuevo.
- [ ] 7.3 A mano: completar una inspección con una respuesta negativa y foto, abrirla desde
      "View report", y comprobar que se lee la recorrida real —sin los ítems que la condición
      escondió—, que el hallazgo aparece con su ubicación, y que el conteo de fotos se ve
      aunque las fotos no.
