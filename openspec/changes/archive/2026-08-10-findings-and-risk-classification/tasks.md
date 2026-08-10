## 1. El motor compartido: qué es una respuesta negativa

- [x] 1.1 `packages/forms/src/document/negative.ts`: `negativeAnswers(document, answers):
      string[]` (D2). Devuelve las `item_key` **visibles** cuya respuesta es `yes_no` en
      `false` o `yes_no_na` en `'no'`. Reusa la resolución de visibilidad de `visibility.ts`;
      no la reimplementa. Sin dependencias de Node: corre dentro del service worker.
- [x] 1.2 `negative.test.ts` con tabla de casos: `yes_no` en `false` y en `true`; los tres
      valores de `yes_no_na`, con `na` **sin** derivar; un ítem oculto respondido; un ítem
      sin respuesta; y un caso por cada uno de los otros siete `response_type` afirmando que
      no derivan.
      **Además**: `EngineCase` gana `expected_negative` y `runEngineCase` lo verifica, con 7
      casos nuevos. La tabla compartida ya la corre `apps/api/test/forms-engine.int-spec.ts`,
      así que el acuerdo dispositivo/servidor de D2 queda probado por el mismo mecanismo que
      el de las violaciones y no por dos suites que se parecen.
- [x] 1.3 Exportar desde `packages/forms/src/index.ts`. **Sin re-export desde
      `packages/contracts`**: `template-document.ts` documenta que contracts re-exporta la
      *forma* del documento y no el motor —`validateAnswers` y `evaluateVisibility` se
      importan de `@hs/forms` directamente—, y `negativeAnswers` es motor. Las dos mitades lo
      importan del mismo paquete igual.

## 2. El contrato

- [x] 2.1 `packages/contracts/src/findings.ts`: `PROBABILITIES`, `SEVERITIES`,
      `RISK_LEVELS`, `CONTROL_LEVELS` como listas cerradas con su `z.enum`, y el comentario
      que diga que la migración `0010` escribe estas mismas listas en sus `CHECK` y que un
      test de integración las compara (precedente 0007).
- [x] 2.2 En el mismo archivo, `findingDetailsSchema` —`description` (10..2000),
      `location_id`, `photo_object_keys` (1..10)— y las formas del hallazgo manual
      (`manualFindingRequestSchema`, con `site_id`, `draft_finding_id`, `occurred_at` y una
      clasificación inicial) y de la clasificación (`riskAssessmentRequestSchema`:
      `probability`, `severity`, `control_level`, `reason` opcional).
      **`risk_level` no está en ningún request**: lo calcula el motor (D5).
- [x] 2.3 `findingSchema` de lectura: origen, descripción, ubicación, fotos y la
      clasificación vigente **o su ausencia** (D10). Sin campo `status`.
- [x] 2.4 Extender `inspectionSubmissionSchema` con `findings: z.record(itemKeySchema,
      findingDetailsSchema)` (D3), con el comentario de por qué no viaja dentro de `photos`
      —`mergePhotoAnswers` lo rechazaría por colisión— ni dentro del valor de la respuesta.
- [x] 2.5 Agregar el `presignUploadRequestSchema` del camino manual: `draft_finding_id` en
      lugar de `scheduled_inspection_id` (D9). Tests de contrato de las dos formas.

## 3. El esquema: migración `0010_findings.sql`

- [x] 3.1 Escribir `apps/api/drizzle/0010_findings.sql` **a mano** (`drizzle-kit generate`
      sigue prohibido, ADR-004), abriendo con el comentario de cabecera: crea tres tablas
      inmutables nuevas, **no altera ninguna tabla existente**, y por qué cada barrera está
      donde está.
- [x] 3.2 `CREATE TABLE finding` con `id`, `site_id`, `origin`, `inspection_id`,
      `template_version_item_id`, `item_key`, `location_id`, `description`, `reported_by`,
      `occurred_at`, `recorded_at DEFAULT now()`. Más `UNIQUE (id, site_id)`, destino de las
      FK compuestas de `finding_photo` y `finding_risk_assessment`.
- [x] 3.3 Las FK compuestas de `finding`: `(inspection_id, site_id)` → `inspection (id,
      site_id)`, `(template_version_item_id, item_key)` → `template_version_item (id,
      item_key)`, `(site_id, location_id)` → `location (site_id, id)`. Las tres tienen
      destino ya existente: **ningún `ALTER` sobre una tabla inmutable**.
- [x] 3.4 El `CHECK` de origen exactamente-uno (D7) y el de `char_length(description) >= 10`,
      cada uno con el comentario de qué requisito sostiene.
- [x] 3.5 `CREATE TABLE finding_photo` con `id`, `finding_id`, `site_id`, `object_key`,
      `created_at`; FK compuesta `(finding_id, site_id)`; `UNIQUE (finding_id, object_key)`.
- [x] 3.6 `hs_risk_level(probability, severity)` como función `IMMUTABLE` con la matriz de
      D5, y `CREATE TABLE finding_risk_assessment` con `risk_level` como columna
      `GENERATED ALWAYS AS (...) STORED`. El caller no puede escribirla por ningún camino.
- [x] 3.7 Las tres barreras de la clasificación (D4): `supersedes_id uuid UNIQUE REFERENCES
      finding_risk_assessment(id)`, `CHECK ((supersedes_id IS NULL) = (reason IS NULL))` y
      `CREATE UNIQUE INDEX ... ON finding_risk_assessment (finding_id) WHERE supersedes_id IS
      NULL`. Ese índice parcial sirve además al `LEFT JOIN LATERAL` del listado (D10).
- [x] 3.8 `CONSTRAINT TRIGGER` `DEFERRABLE INITIALLY DEFERRED` sobre `finding` (D6): al
      commit, un hallazgo sin ninguna fila en `finding_photo` falla con SQLSTATE dedicado.
- [x] 3.9 Índices: `finding (site_id, item_key)` —el `GROUP BY` de recurrencia de la etapa
      7—, `finding (inspection_id)`, `finding (site_id, recorded_at)` y
      `finding_risk_assessment (finding_id)`. Cada uno con el comentario de qué consulta
      sirve.
- [x] 3.10 Triggers de auditoría `AFTER INSERT`: `finding.derived` y `finding.reported` según
      `origin`, con `occurred_at := NEW.occurred_at` vía `hs_audit_entry_at`; y
      `finding.classified` sobre `finding_risk_assessment` con su `risk_level` calculado,
      `supersedes_id` y `reason`. Ninguna entrada por foto.
- [x] 3.11 `hs_make_immutable` y `hs_apply_site_isolation` sobre las tres tablas;
      `GRANT SELECT, INSERT` para `hs_app` y **ningún** `GRANT UPDATE` sobre ninguna columna,
      con el comentario que diga que la ausencia es el requisito.
- [x] 3.12 Espejo Drizzle a mano en `apps/api/src/db/schema/findings.ts`, con el comentario de
      ADR-004 que ya usan los otros y sin ningún tipo `*Update`; exportar desde
      `schema/index.ts`.

## 4. Funciones puras del módulo `findings`

- [x] 4.1 `apps/api/src/findings/risk.ts`: `riskLevel(probability, severity)` — la matriz de
      D5 en TypeScript, sin base y sin red.
- [x] 4.2 `risk.spec.ts` con las **25** celdas escritas una por una, no generadas por el
      mismo producto que implementa la función.
- [x] 4.3 `apps/api/src/findings/derive.ts`: `deriveFindings(document, answers, findings)` —
      compara el conjunto de `negativeAnswers` con las claves del bloque `findings` y
      devuelve las violaciones `finding_missing` y `unexpected_finding`, o las filas a
      insertar. Pura: recibe el documento y el payload, no toca base.
- [x] 4.4 `derive.spec.ts`: negativo sin detalles; detalles para una respuesta afirmativa;
      detalles para una `item_key` que no está en el documento; el caso completo; y el caso
      vacío —ninguna respuesta negativa— que no debe producir nada ni fallar.
- [x] 4.5 Extender `apps/api/src/inspections/submission.ts`: `objectKeysOf` recorre también
      las `photo_object_keys` del bloque `findings` (D3), y un caso nuevo en
      `submission.spec.ts` con una key de hallazgo apuntando a otra inspección.

## 5. La derivación dentro de la ingesta

- [x] 5.1 En `submissions.service.ts`, reemplazar el comentario de enganche por la llamada a
      `deriveFindings` (D1): corre **antes** del insert de la inspección para poder devolver
      `validation_failed` con las violaciones del bloque junto con las de `validateAnswers`,
      en una sola respuesta.
- [x] 5.2 Después de `insertAnswers`, y dentro de la misma transacción, insertar los
      `finding` y sus `finding_photo` en dos sentencias (`INSERT ... SELECT` sobre arrays),
      no una por hallazgo. `occurred_at` del hallazgo es el `signed_at` del envío.
- [x] 5.3 Un reenvío idempotente sale antes de esto y no escribe nada: verificar que el
      camino de `created: false` sigue devolviendo sin tocar `finding`.
- [x] 5.4 Agregar `finding_missing` y `unexpected_finding` a los códigos de violación que
      `validation_failed` puede llevar. **El código de error de la respuesta no cambia**: el
      outbox ya lo clasifica como no reintentable y no hay que tocar `apps/web/src/offline/
      outbox.ts`.

## 6. El módulo `findings` de la API

- [x] 6.1 `findings.module.ts`, `findings.errors.ts` (`invalid_finding`, `forbidden`,
      `finding_not_found`), `findings.repository.ts`. `inspections` importa la función de
      derivación, no el módulo entero: la dependencia va en una sola dirección (ADR-008).
- [x] 6.2 `POST /findings` — hallazgo manual: rol `supervisor`, `operations_manager` o
      `hs_coordinator`; `site_id` dentro del alcance de la sesión; ubicación **activa** (D8);
      prefijo `{site_id}/manual/{draft_finding_id}/` verificado con `foreignObjectKeys` (D9);
      hallazgo, fotos y clasificación inicial en una transacción.
- [x] 6.3 `POST /findings/:id/risk-assessments` — clasificar y reclasificar: solo
      `hs_coordinator`; `assessed_by` de la sesión y nunca del payload; `supersedes_id`
      resuelto leyendo la vigente; una violación del único de `supersedes_id` se traduce a un
      conflicto explícito y no a un `HS002`.
- [x] 6.4 `GET /findings` y `GET /findings/:id`: sin `WHERE site_id` —la RLS decide—, con la
      clasificación vigente resuelta por el `LEFT JOIN LATERAL` de D10 y la ausencia
      reportada como ausencia. Fuera de alcance ⇒ `finding_not_found`, con un cuerpo que no
      dice nada del hallazgo.
- [x] 6.5 Extender `uploads` con el presign del camino manual (D9), derivando la object key
      en el servidor y sin dejar que el cliente la elija.

## 7. La captura offline

- [x] 7.1 `apps/web/src/offline/db.ts`: la tabla de borradores gana los detalles del hallazgo
      por `item_key` y la tabla de fotos gana el vínculo con el hallazgo. Migración de Dexie
      con el número de versión que corresponda.
- [x] 7.2 `drafts.ts`: escribir descripción, ubicación y foto en el acto; **descartar** los
      detalles cuando la respuesta deja de ser negativa o el ítem queda oculto, con el mismo
      criterio que ya usa para las respuestas ocultas.
- [x] 7.3 `CaptureRoute.tsx`: el sub-formulario que aparece al responder negativo, con la
      lista de ubicaciones que `prefetch.ts` ya dejó guardada y **sin** entrada de texto
      libre para la ubicación.
- [x] 7.4 La comprobación previa a firmar: `negativeAnswers` del borrador contra sus
      detalles; si falta alguno, no se firma y se **nombran** los ítems incompletos.
- [x] 7.5 `photos.ts` y `outbox.ts`: las fotos del hallazgo se suben igual que las demás y el
      envío no sale mientras alguna esté sin subir; `toAnswerSet` sigue sin incluirlas y el
      payload gana el bloque `findings` con object keys.
- [x] 7.6 Tests de `apps/web` con la base falsa de Dexie: restauración tras cierre, descarte
      al corregir la respuesta, descarte al ocultarse el ítem, firma rechazada con el ítem
      nombrado, y payload armado con el bloque completo.

## 8. Tests de integración: derivación y todo-o-nada

- [x] 8.1 `apps/api/test/findings.int-spec.ts` sobre Testcontainers, reusando los helpers de
      `test/helpers/scheduling.ts`.
- [x] 8.2 Un envío con 3 negativos crea 3 hallazgos con su `item_key`, su
      `template_version_item_id`, su ubicación y sus fotos; uno sin negativos no crea
      ninguno; uno con `na` no crea ninguno.
- [x] 8.3 Todo o nada: un negativo sin detalles ⇒ `validation_failed` con `finding_missing`,
      cero `inspection`, cero `inspection_answer`, cero `finding` y cero entradas de
      auditoría. Detalles para una respuesta afirmativa ⇒ `unexpected_finding`. Un payload
      con dos faltantes y un `required` ausente lista **tres** violaciones.
- [x] 8.4 Reenvío: el mismo payload cinco veces ⇒ `created: false` y exactamente 3 hallazgos.
- [x] 8.5 Fotos: una `photo_object_keys` con el prefijo de otra inspección ⇒
      `invalid_submission` y ninguna fila; un hallazgo insertado sin foto ⇒ el commit falla
      con el SQLSTATE del constraint diferido (3.8); una foto de hallazgo **no** termina como
      valor de la respuesta del ítem.
- [x] 8.6 Ubicación: una desactivada después de preparar el paquete de campo se acepta al
      derivar; la misma se rechaza en el hallazgo manual con `invalid_finding`; una de la
      otra planta ⇒ violación de la FK compuesta (D8).
- [x] 8.7 Origen: un `INSERT` directo con `inspection_id` y sin `item_key` ⇒ falla el `CHECK`;
      un hallazgo manual queda fuera del `GROUP BY item_key` mientras dos derivados del mismo
      ítem caen en un solo grupo.

## 9. Tests de integración: clasificación, inmutabilidad y auditoría

- [x] 9.1 Clasificación: un hallazgo derivado nace sin ninguna fila de assessment y se lee
      como sin clasificar; clasificar deja una; reclasificar deja dos y la vigente es la que
      nadie supersede.
- [x] 9.2 Las tres barreras de D4: reclasificar sin `reason` ⇒ falla el `CHECK`; clasificar
      por primera vez **con** `reason` ⇒ falla el mismo `CHECK`; dos reclasificaciones
      concurrentes de la misma vigente ⇒ una comete y la otra viola el único, y queda una
      sola vigente.
- [x] 9.3 La matriz: `risk_level` es el de la matriz aunque el payload afirme otro; un
      `INSERT` directo obtiene el mismo nivel; y **las 25 celdas evaluadas por Postgres
      coinciden con las 25 de `risk.ts`** (D5). Mismo test compara las cuatro listas cerradas
      de `@hs/contracts` con los `CHECK` de la migración.
- [x] 9.4 Permisos: un miembro del JHSC clasificando ⇒ `forbidden`; un auditor externo
      reportando un hallazgo manual ⇒ `forbidden`; `assessed_by` siempre el de la sesión.
- [x] 9.5 Extender `apps/api/test/immutability.int-spec.ts`: `UPDATE` de
      `finding.description` y de `finding_risk_assessment.severity` con el rol de la
      aplicación ⇒ `42501`; con el rol de migración ⇒ el SQLSTATE del trigger; `DELETE` y
      `TRUNCATE` sobre las tres tablas ⇒ fallan; aislamiento por sitio en las tres, con y sin
      alcance declarado; `site_id` que no coincide con el de su hallazgo o con el de su
      inspección ⇒ FK compuesta.
- [x] 9.6 Extender `apps/api/test/audit-chain.int-spec.ts`: un envío con 3 negativos agrega
      1 eslabón de `inspection.submitted` y 3 de `finding.derived`, todos con `occurred_at`
      igual al `signed_at` del dispositivo; un hallazgo de 4 fotos agrega **un** eslabón; el
      reenvío no agrega ninguno; clasificar y reclasificar agregan uno cada uno, el segundo
      nombrando el motivo; una clasificación rechazada no agrega ninguno; la cadena verifica
      intacta al final.

## 10. Cierre de la etapa 4

- [ ] 10.1 Verificar R2 de punta a punta contra el entorno local: una inspección con
      negativos capturada sin red, enviada, con sus hallazgos visibles y clasificados por el
      coordinador.
      **PENDIENTE — requiere levantar el entorno (Postgres + bucket S3-compatible).** Todo lo
      que se puede verificar sin él está verde: la derivación contra Postgres real
      (`findings.int-spec.ts`, 40 casos), la captura y el payload en `apps/web`, y las dos
      matrices comparadas celda a celda.
- [x] 10.2 `pnpm lint`, `pnpm test`, `pnpm test:int` y `pnpm build` en verde.
- [x] 10.3 Actualizar `docs/adr/008`. **Se actualizó**, y por algo que el texto sí
      contradecía: el ADR decía que `inspections` no conoce `findings` y a la vez pedía la
      derivación adentro de la transacción de la ingesta. Queda escrita la excepción
      declarada de la costura crítica 1, con la regla que sigue en pie —`findings` no llama a
      `inspections`—. También se corrigió D1 del `design.md`, que afirmaba lo contrario de lo
      que el código hace.
