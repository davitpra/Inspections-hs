## 1. El esquema del documento

- [x] 1.1 En `packages/forms/src/document/controls.ts`, sacar `control_level` de `findingSchema`.
      El bloque queda `{ corrective_action, fails_when? }`. `CONTROL_LEVELS`, `controlLevelSchema`
      y `ControlLevel` **se quedan y se siguen exportando**: los consume la clasificación de
      riesgo. Ajustar el comentario del archivo para que diga de quién es la jerarquía ahora.
- [x] 1.2 Verificar que `draft.ts` no necesita cambios: `checkFinding` nunca miró el nivel. Si el
      comentario de `draftItemBase` («un bloque mantiene junta la acción y su nivel») lo menciona,
      corregirlo.
- [x] 1.3 `packages/forms/src/document/schema.test.ts`: quitar el nivel de la fixture del test que
      acepta un `finding`, y **reemplazar** el test «rechaza una jerarquía de controles
      desconocida» por uno que verifique que un `finding` con `control_level` —con un valor
      válido— ya es rechazado como clave desconocida.
- [x] 1.4 `packages/forms/src/document/draft.test.ts`: quitar `control_level` de las fixtures.

## 2. El editor de plantillas

- [x] 2.1 `apps/web/.../TemplateDraftRoute/FindingSheet.tsx`: borrar el bloque del `<select>` de
      Control level y el import de `CONTROL_LEVEL_OPTIONS`.
- [x] 2.2 `apps/web/.../TemplateDraftRoute/presentation.ts`: borrar `CONTROL_LEVEL_OPTIONS`, los
      imports `CONTROL_LEVELS`/`ControlLevel`, y el `control_level` de `defaultFinding`.
- [x] 2.3 `apps/web/.../TemplateDraftRoute/edits.ts`: en `changeResponseType`, la prescripción
      reconstruida sin umbral queda `{ corrective_action: item.finding.corrective_action }`.
- [x] 2.4 Tests del editor: borrar el bloque de `presentation.test.ts` que afirma las cinco
      opciones, y quitar `control_level` de las fixtures de `edits.test.ts`. `index.test.tsx` no
      toca el select y no debería necesitar cambios — confirmarlo, no asumirlo.

## 3. La migración

- [x] 3.1 Escribir a mano `apps/api/drizzle/0024_retire_prescribed_control_level.sql` con el
      encabezado de contexto que llevan todas (`drizzle-kit generate` está prohibido). **No
      concede ni revoca ningún permiso y no toca ninguna política RLS**: reescribe el contenido de
      una columna ya mutable (`template_draft.document`, en el `GRANT UPDATE` de `0021`) y no crea
      tablas ni columnas. Decir eso explícitamente en el encabezado.
- [x] 3.2 §1 de la migración — preflight sobre lo publicado: `DO $$ ... RAISE EXCEPTION` si
      `EXISTS (SELECT 1 FROM template_version WHERE jsonb_path_exists(document,
      '$.sections[*].items[*].finding.control_level'))`. El mensaje debe decir qué hacer, no solo
      qué pasó: `template_version.document` es inmutable (ADR-002) y la salida es una decisión.
- [x] 3.3 §2 de la migración — limpiar los borradores: UPDATE de `template_draft` que reconstruye
      `sections`/`items` con `jsonb_array_elements(...) WITH ORDINALITY` y
      `jsonb_agg(... ORDER BY ord)` —el orden ES la `position`, perderlo reordenaría la lista de
      alguien— aplicando `#- '{finding,control_level}'` a cada ítem, con
      `WHERE jsonb_path_exists(document, '$.sections[*].items[*].finding.control_level')`.
      **No tocar `updated_at`**: una reparación de esquema no es una edición del autor.
- [x] 3.4 `apps/api/test/template-drafts.int-spec.ts`: quitar `control_level` de la fixture del
      documento, y agregar el caso de que un `finding` con `control_level` es rechazado en
      `saveDraft`.

## 4. La spec

- [x] 4.1 Correr `/opsx:sync` (o `openspec sync`) para llevar el delta de
      `specs/templates/spec.md` al spec principal, y comprobar que `openspec/specs/findings/spec.md`
      y `openspec/specs/audit/spec.md` quedaron intactos: el `control_level` de la clasificación
      de riesgo no se toca.

## 5. Verificación

- [x] 5.1 `pnpm -r build && pnpm typecheck` — el build va ANTES; `edits.ts` es el error de
      compilación que guía el resto.
- [x] 5.2 `pnpm lint` y `pnpm test`.
- [x] 5.3 `pnpm --filter api exec vitest run --config vitest.integration.config.mts test/template-drafts.int-spec.ts`
      y `test/findings.int-spec.ts` — el segundo es el que demuestra que la clasificación de
      riesgo sigue pidiendo su `control_level`.
- [ ] 5.4 A mano en `pnpm dev`: abrir un borrador, «Add finding» en una pregunta `yes_no` y en una
      `number`; el sheet ya no ofrece Control level; guardar, recargar, la prescripción vuelve.
      Después clasificar un hallazgo real y confirmar que el nivel de control **sigue pidiéndose
      ahí**.
- [x] 5.5 Migración: correr el preflight de 3.2 contra la base local ANTES de `pnpm db:migrate`;
      después migrar con un borrador viejo que lleve el campo y comprobar que ese borrador se
      puede volver a guardar desde el editor sin haberse reordenado.

      **Resultado.** El preflight de §1 da 0 versiones publicadas con el campo, así que `0024` ya
      corrió limpia contra la base local (su hash está en `drizzle.__drizzle_migrations`). Ningún
      borrador guardado llevaba `control_level`, de modo que el UPDATE de §2 no se ejerció con
      datos reales: se lo ejercitó con un borrador sintético de la forma vieja dentro de una
      transacción revertida (`ROLLBACK`, la base local no cambió). Quedó demostrado que la clave
      desaparece, que el orden de secciones e ítems se conserva, que la acción correctiva, el
      umbral y la configuración del ítem quedan intactos, que un ítem sin `finding` no se toca,
      que `updated_at` no se mueve y que el `WHERE` deja fuera al borrador que no lleva el campo.
      El §1 se verificó igual: con una versión publicada sintética que sí lo lleva, aborta con su
      mensaje —también revertido—.

      **Lo que apareció de paso y NO es de este change**: el borrador vivo `new-inspection` tiene
      un ítem con `finding.severity`, una clave que `findingSchema` nunca tuvo en ninguna versión
      del código commiteado. Ese borrador no lo acepta el esquema actual —y tampoco lo aceptaba el
      anterior—, así que no se puede guardar hasta que esa clave se saque. Es dato local previo,
      no una consecuencia de retirar `control_level`.
