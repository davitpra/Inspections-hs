# Tasks — Avanzar la versión de plantilla de un período abierto

## 1. Migración

- [x] 1.1 `apps/api/drizzle/0030_advance_template_version.sql` — encabezado que explique la
      decisión: la columna pasa de inmutable a MONÓTONA, qué protege cada una de las tres
      reglas nuevas, y por qué `inspection.template_version_id` (el envío firmado) no se
      toca. Declarar que se toca una tabla del §5 de 0008.
- [x] 1.2 En la misma migración: `GRANT UPDATE (template_version_id) ON scheduled_inspection
      TO hs_app;`. Una sola columna; el resto de la lista de 0008 §8 no se extiende.
- [x] 1.3 En la misma migración: `CREATE OR REPLACE FUNCTION hs_scheduling_guard()`
      PARTIENDO de la definición vigente en `0029_inspection_frequency.sql` §3 (no de la de
      0008). Sacar `'template_version_id'` del array `frozen` de `scheduled_inspection` y
      dejar el resto igual: `id`, `site_id`, `period_start`, `period_months`, `template_id`,
      `scheduled_at`, `scheduled_by`.
- [x] 1.4 En la misma función, un bloque `IF TG_TABLE_NAME = 'scheduled_inspection' AND
      new_row ->> 'template_version_id' IS DISTINCT FROM old_row ->> 'template_version_id'`
      con las tres reglas, cada una con `RAISE EXCEPTION … USING ERRCODE = 'HS001'` y un
      `HINT` que diga qué hacer en su lugar:
      1. la `version` de la nueva tiene que ser estrictamente mayor que la de la vieja
         (subconsulta a `template_version`; la FK compuesta ya garantiza la plantilla, y el
         comentario tiene que decirlo para que nadie agregue la comprobación de más);
      2. `NOT EXISTS (SELECT 1 FROM inspection WHERE scheduled_inspection_id = OLD.id)`;
      3. `old_row ->> 'cancelled_at' IS NULL`.
      Leer por `jsonb` como el resto de la función, por el motivo que 0029 documenta.
- [x] 1.5 En la misma migración: `CREATE OR REPLACE FUNCTION hs_scheduled_inspection_audit()`
      partiendo de `0008_inspection_scheduling.sql` §6, con una rama nueva
      `IF NEW.template_version_id IS DISTINCT FROM OLD.template_version_id` →
      `hs_identity_audit_entry(NEW.site_id, 'inspection.version_advanced', body ||
      jsonb_build_object('previous_template_version_id', OLD.template_version_id))`. `body`
      ya lleva `template_version_id`, así que la entrada nombra las dos.
- [x] 1.6 `apps/api/drizzle/meta/_journal.json` — la entrada de 0030.
- [x] 1.7 `apps/api/src/db/schema/inspections.ts` — espejo a mano: actualizar el comentario
      de `template_version_id` para que diga "monótona" y no "congelada"
      (`drizzle-kit generate` está prohibido).

## 2. Contratos

- [x] 2.1 `packages/contracts/src/inspections.ts` — `pendingInspectionSchema` gana
      `template_version: z.int().positive()` (la congelada, para poder nombrarla sin red),
      `latest_template_version: z.int().positive()` y `latest_template_version_id: z.uuid()`,
      con el comentario de que los dos últimos son una LECTURA de lo publicado hoy y no una
      promesa: la inspección no está atada a ellos hasta que alguien avanza.
- [x] 2.2 `packages/contracts/src/inspections.test.ts` — el esquema acepta la fila con los
      tres campos y rechaza la que declara `latest_template_version: 0`.

## 3. API

- [x] 3.1 `apps/api/src/inspections/inspections.errors.ts` — `versionNotAdvanceable(reason)`
      (409), con los tres motivos que el trigger puede dar traducidos a un mensaje en
      inglés: ya enviada, cancelada, y no hay una versión más alta.
- [x] 3.2 `apps/api/src/inspections/inspections.service.ts` — `advanceTemplateVersion(session,
      id): Promise<TemplateVersionPackage>` dentro de `withSessionClient`: `requireActive`,
      actor = inspector asignado O coordinador (mismo criterio de actor que
      `submissions.service.ts:57`, y `requireCoordinator` para el otro caso), `UPDATE
      scheduled_inspection SET template_version_id = <latest> WHERE id = $1 AND
      template_version_id IS DISTINCT FROM <latest>` con `LATEST_PUBLISHED_VERSION_CTE` de
      `src/templates/published-version.sql.ts`, y devolver `templateVersionPackage(session,
      id)`. Traducir `HS001` a `versionNotAdvanceable`; no reimplementar las comprobaciones
      del trigger (comentario que lo diga, en el idioma del encabezado del archivo).
- [x] 3.3 `apps/api/src/inspections/inspections.service.ts` — `pendingFor()` (línea 338)
      unida por `LEFT JOIN` a `LATEST_PUBLISHED_VERSION_CTE` y a `template_version` para
      devolver `template_version`, `latest_template_version` y `latest_template_version_id`.
      El `ORDER BY si.period_end` no cambia.
- [x] 3.4 `apps/api/src/inspections/inspections.controller.ts` — `POST
      scheduled-inspections/:id/template-version/advance`, al lado del `GET` existente, que
      NO se toca.

## 4. Web

- [x] 4.1 `apps/web/src/offline/prefetch.ts` — `prefetchInspection(id, options)` acepta
      `advance?: boolean`: con `true`, la pieza `template_version` se pide por `POST
      …/template-version/advance`; sin él, el `GET` de hoy. El resto (escritura pieza por
      pieza con `put`, `stored`, `missing`, `errors`) no cambia. Comentario que diga por qué
      la decisión no se toma acá adentro (design.md D2).
- [x] 4.2 `apps/web/src/offline/prefetch.ts` — `packageDrift` gana `'newer-version'` y un
      parámetro `latestVersionId`. Precedencia: `draft-orphaned` → `stale-package` →
      `newer-version` → `none`. Falta de información sigue siendo `'none'`.
- [x] 4.3 `apps/web/src/offline/prefetch.test.ts` — la tabla de casos de `packageDrift` con
      el estado nuevo, incluido "hay versión más alta Y hay borrador".
- [x] 4.4 `apps/web/src/components/FieldPackage.tsx` — prop `advance?: boolean` pasada a la
      mutación. La invalidación de las cuatro claves no se toca.
- [x] 4.5 `apps/web/src/routes/InspectorHomeRoute/presentation.ts` — `driftMessage` cubre
      `'newer-version'` con DOS textos: sin borrador, que refrescar el paquete la va a
      tomar; con borrador, que hay que descartarlo primero (y con el borrador firmado, el
      texto que ya existe: no se puede descartar).
- [x] 4.6 `apps/web/src/routes/InspectorHomeRoute/AssignmentHero.tsx` — pasar
      `advance={draftStatus === null}` a `DownloadForField`, pasar
      `latestVersionId={inspection.latest_template_version_id}` a `packageDrift`, y decir en
      el bloque "Template version N" que hay una más alta publicada.
- [x] 4.7 `apps/web/src/routes/SchedulingRoute/PeriodRow.tsx` y `presentation.ts` — mostrar
      `inspection.template_version` y, comparando contra `latest_version` de la consulta
      `queryKeys.templates()` (mismo patrón que `OpenPeriodForm.tsx:63`), una nota cuando
      hay una más alta. La decisión de qué texto va es una función pura en
      `presentation.ts`, con su test.

## 5. Pruebas

- [x] 5.1 `apps/api/test/inspection-scheduling.int-spec.ts` — **reescribir** los dos casos de
      las líneas 133-165: hoy afirman que la columna no se puede mover ni como `hs_app` ni
      como dueño. Pasan a afirmar el avance permitido y los tres rechazos.
- [x] 5.2 En el mismo archivo: `hs_app` avanza a una versión más alta y la fila la refleja;
      el intento hacia una versión MENOR falla con `HS001`; el intento sobre una fila con
      `inspection` ya insertada falla con `HS001`; el intento sobre una fila cancelada falla
      con `HS001`; el intento hacia una versión de OTRA plantilla sigue fallando por FK.
- [x] 5.3 `apps/api/test/audit-chain.int-spec.ts` — el avance escribe exactamente una entrada
      `inspection.version_advanced` con `previous_template_version_id` y
      `template_version_id`, y el `UPDATE` que no cambia nada no escribe ninguna.
- [x] 5.4 `apps/api/test/field-package.int-spec.ts` — el `POST` de avance devuelve el
      documento de la versión nueva; llamarlo dos veces devuelve lo mismo y no escribe dos
      veces; una cuenta que no es la asignada ni coordinadora lo recibe rechazado; el `GET`
      sigue devolviendo la versión a la que la fila está atada.
- [x] 5.5 `apps/web/src/routes/InspectorHomeRoute/index.test.tsx` — con una versión más alta
      publicada y sin borrador, la asignación lo dice y refrescar pide el avance; con
      borrador en curso, refrescar NO pide el avance y el texto nombra el descarte.
- [x] 5.6 `apps/web/src/routes/SchedulingRoute/index.test.tsx` y `presentation.test.ts` — la
      fila del período dice su versión y avisa cuando hay una más alta.

## 6. Cierre

- [x] 6.1 `pnpm lint`, `pnpm -r build`, `pnpm typecheck`, `pnpm test`,
      `pnpm --filter api test:int`.
- [ ] 6.2 A mano: publicar una revisión con un período abierto y sin borrador → *Refresh
      field package* → el héroe pasa a la versión nueva y *Start inspection* la usa. Repetir
      con un borrador en curso → no avanza y aparece el aviso de descartar.
- [ ] 6.3 `/opsx:archive` con la fecha del día.
