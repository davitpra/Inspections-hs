## 1. La canonicalización y el digest

- [x] 1.1 `packages/contracts/src/canonical-json.ts`: `canonicalize(value): string` según RFC
      8785 —claves ordenadas por unidad de código UTF-16, sin espacios insignificantes, números
      en forma canónica, rechazo explícito de `undefined`, `NaN` e `Infinity`—. Sin dependencias
      de Node. El comentario de cabecera dice por qué es un estándar y no `JSON.stringify` con
      claves ordenadas (D2), y que cambiar la forma del payload cambia todos los digests
      posteriores.
- [x] 1.2 `canonical-json.test.ts` con los vectores del propio RFC 8785 más los del proyecto:
      dos objetos con las mismas entradas en distinto orden de inserción serializan idéntico;
      anidamiento profundo; arrays que **no** se reordenan; strings con pares subrogados y con
      escapes; un número no finito lanza y no serializa.
- [x] 1.3 `apps/api/src/reporting/payload-digest.ts`: `digestPayload(payload)` = SHA-256 hex
      minúscula de `canonicalize(payload)` en UTF-8, con `node:crypto`. Test de que dos procesos
      del mismo payload dan el mismo digest y de que el largo es 64.

## 2. El contrato

- [x] 2.1 `packages/contracts/src/compliance.ts`: `PERIOD_STATUSES = ['completed', 'missed',
      'cancelled', 'open']` con su `z.enum`, y `compliancePeriodSchema` —`period_start`,
      `period_end`, `status`, `scheduled_inspection_id` (nullable), `template_id` (nullable),
      `template_version_id` (nullable), `inspection_id` (nullable), `submitted_by` (nullable),
      `occurred_at` (nullable), `cancellation_reason` (nullable)—. El comentario deja escrito
      que los nulos de un `missed` significan "el sitio lo debía y nunca se abrió" (D6).
- [x] 2.2 En el mismo archivo, `complianceCoverageSchema` (`required_count`, `completed_count`,
      `missed_count`, `cancelled_count`, `open_count`) y `complianceQuerySchema` (`site_id`,
      `range_start`, `range_end`) con la validación de que `range_start` es día 1 de un mes y
      `range_end` no lo precede.
- [x] 2.3 `compliancePayloadSchema`: `schema_version` (literal numérico, arranca en `1`), `site`,
      `range`, `generated_at`, `coverage`, `periods[]`, `findings[]`, `recurrence_series[]`,
      `excluded_manual_count`, `open_actions[]`. **El comentario declara que esta forma es un
      contrato de digest**: cambiarla obliga a subir `schema_version` (D2).
- [x] 2.4 `complianceReportSchema` (`id`, `site_id`, `range_start`, `range_end`, `payload`,
      `payload_hash`, `generated_by`, `generated_at`, `latest_render`) y
      `complianceRenderSchema` (`id`, `report_id`, `outcome`, `object_key` nullable, `error`
      nullable, `rendered_at`).
- [x] 2.5 `compliance.test.ts`: rechazo de `range_start` que no cae día 1; rechazo de rango
      invertido; rechazo de `payload_hash` que no es 64 hex; aceptación de un período `missed`
      con todos los identificadores en null. Exportar todo desde
      `packages/contracts/src/index.ts`.

## 3. El esquema: migración `0014_compliance_reports.sql`

- [x] 3.1 Escribir `apps/api/drizzle/0014_compliance_reports.sql` **a mano** (`drizzle-kit
      generate` sigue prohibido, ADR-004), abriendo con el comentario de cabecera en el formato
      de 0013: la tabla de propiedades con su barrera al lado y el párrafo que declara que esta
      migración **no altera ninguna tabla existente**.
- [x] 3.2 `CREATE TABLE compliance_report`: `id`, `site_id NOT NULL` con FK a `site`,
      `range_start date NOT NULL`, `range_end date NOT NULL`, `payload jsonb NOT NULL`,
      `payload_hash text NOT NULL`, `generated_by NOT NULL` con FK a la cuenta, `generated_at
      timestamptz NOT NULL DEFAULT now()`. `CHECK` de `payload_hash ~ '^[0-9a-f]{64}$'`, `CHECK`
      de `range_start` día 1 del mes, `CHECK` de `range_end >= range_start`. Único sobre `(id,
      site_id)` como destino de la FK compuesta de 3.3.
- [x] 3.3 `CREATE TABLE compliance_report_render`: `id`, `report_id NOT NULL`, `site_id NOT
      NULL`, `outcome text NOT NULL CHECK (outcome IN ('succeeded','failed'))`, `object_key`
      nullable, `error` nullable, `rendered_at timestamptz NOT NULL DEFAULT now()`. FK compuesta
      contra `compliance_report (id, site_id)`. `CHECK` de que `object_key IS NOT NULL`
      exactamente cuando `outcome = 'succeeded'`, y de que `error IS NOT NULL` exactamente
      cuando `outcome = 'failed'`.
- [x] 3.4 `hs_make_immutable` sobre las dos tablas y `REVOKE UPDATE, DELETE` de `hs_app`, con
      `GRANT SELECT, INSERT` y nada más. Verificar en la propia migración que no queda ningún
      `GRANT UPDATE` sobre ninguna de las dos.
- [x] 3.5 `hs_apply_site_isolation` sobre las dos tablas, con `FORCE ROW LEVEL SECURITY` para
      que la política alcance también al dueño.
- [x] 3.6 Trigger `AFTER INSERT ON compliance_report` que appendea `compliance_report.generated`
      a la cadena del sitio con `report_id`, `site_id`, `range_start`, `range_end`,
      `payload_hash` y los cuatro conteos de cobertura leídos del `payload` (D9).
- [x] 3.7 Trigger `AFTER INSERT ON compliance_report_render` que appendea
      `compliance_report.rendered` **solo cuando `outcome = 'succeeded'`**, con `report_id`,
      `site_id`, `object_key` y el `payload_hash` del reporte.
- [x] 3.8 Espejo Drizzle en `apps/api/src/db/schema/compliance.ts` — solo lectura del esquema,
      sin `drizzle-kit`—, exportado desde el índice del esquema.

## 4. La consulta de cobertura

- [x] 4.1 `apps/api/src/reporting/compliance.sql.ts`: SQL crudo que genera los meses del rango
      con `generate_series`, los cruza con las ventanas activas de `schedule_rule` para saber
      cuáles el sitio debía, y hace `LEFT JOIN` contra `scheduled_inspection` e `inspection`
      (D6). Sin `WHERE site_id`: el recorte es de la política.
- [x] 4.2 En la misma consulta, la clasificación de estado: `cancelled` si hay `cancelled_at`,
      `completed` si existe `inspection`, `open` si `period_end >= (now() AT TIME ZONE
      'America/Toronto')::date`, `missed` en el resto (D7). El comentario dice por qué el
      calendario es el de Ontario y no UTC.
- [x] 4.3 Los cinco conteos derivados de las mismas filas y no de consultas aparte, para que
      `required_count` no pueda divergir de la cantidad de entradas devueltas.
- [x] 4.4 `compliance.sql.spec.ts` de integración: un año con 11 de 12; un mes debido sin fila de
      `scheduled_inspection` que aparece `missed` con identificadores en null y `required_count`
      `12`; un mes cancelado que no cuenta ni como cumplido ni como omitido; el mes corriente
      `open` y fuera de `missed_count`; una regla activada en mayo que no hace deber enero; una
      regla desactivada en septiembre que no hace deber noviembre.
- [x] 4.5 Test del borde horario: `period_end` `2026-08-31` con el reloj en
      `2026-09-01T01:00:00Z` sigue dando `open`.

## 5. El congelamiento del reporte

- [x] 5.1 `apps/api/src/reporting/compliance.service.ts`: `coverage(session, query)` que devuelve
      la vista calculada al vuelo, sin escribir nada.
- [x] 5.2 `generate(session, query)`: chequeo de rol `hs_coordinator` (D10), construcción del
      payload —cobertura, períodos, hallazgos del rango con su clasificación vigente o
      `unclassified`, series de recurrencia **llamando al servicio de recurrencia ya existente**,
      `excluded_manual_count`, acciones abiertas con las vencidas marcadas—, ordenamiento
      determinista de cada array, `digestPayload`, e `INSERT` de `compliance_report` dentro de
      `withSessionScope`. Encolar `reporting.render-compliance-pdf` **después** del commit.
- [x] 5.3 `getReport(session, id)`: devuelve el payload guardado tal cual, con su último render
      exitoso si existe. **No recalcula ninguna cifra** (D1); un test lo fija: someter una
      inspección tardía no cambia el `completed_count` del reporte ya generado ni su
      `payload_hash`.
- [x] 5.4 `compliance.service.spec.ts`: el payload de los mismos datos construido dos veces
      serializa idéntico; un supervisor no puede generar y sí leer; un coordinador con alcance a
      Glencoe no puede generar para St. Thomas; el reporte se puede leer sin ningún render.

## 6. El render

- [x] 6.1 Agregar `playwright` a `apps/api` y `playwright install --with-deps chromium` al job de
      integración del pipeline. **No hay `Dockerfile` que tocar**: el repositorio todavía no
      containeriza la API, así que el requisito de Chromium quedó documentado en `.env.example`
      junto a `PDF_RENDER_TIMEOUT_MS`, listo para la imagen que se escriba.
- [x] 6.2 `apps/api/src/reporting/report-document.ts`: el HTML completo del documento con CSS de
      impresión (`@page`, `size: letter`), encabezado, secciones de cobertura, períodos,
      hallazgos, series y acciones abiertas, y el párrafo que declara que el digest cubre el
      payload y no el archivo. **Escapar todo texto de usuario** (Risks).
- [x] 6.3 El `footerTemplate` con `payload_hash`, sitio, rango, `generated_at`, id del reporte y
      los tokens de página de Chromium, para que el pie salga en **todas** las páginas (D5).
- [x] 6.4 `apps/api/src/reporting/pdf-renderer.ts`: un browser por proceso, lanzado perezosamente
      y cerrado en `OnModuleDestroy`; una `page` por render con timeout; `setContent` y
      `page.pdf({ printBackground: true, displayHeaderFooter: true })`.
- [x] 6.5 `reporting.render-compliance-pdf` en `JobPayloads` con `{ report_id: string }` —sin
      `now`, porque no hay nada que resolver contra el reloj (D4)— y su `work` registrado con
      tope de reintentos.
- [x] 6.6 El handler: lee el reporte, renderiza, sube con `putComplianceReport`, e inserta la
      fila `succeeded`. En error, inserta la fila `failed` con el mensaje y deja que pg-boss
      reintente hasta el tope.
- [x] 6.7 Test de integración del render (job con navegador): un reporte de cuatro páginas
      imprime el `payload_hash` en las cuatro; dos renders del mismo reporte imprimen el mismo
      digest y escriben `object_key` distintos; un fallo del navegador deja fila `failed` y el
      reporte sigue legible con su digest.

## 7. El almacenamiento y los endpoints

- [x] 7.1 `apps/api/src/uploads/object-storage.ts`: `putComplianceReport` (`PutObject`,
      `application/pdf`) y `presignComplianceGet` (`GetObject` firmado, TTL corto), con la key
      derivada por el servidor de sitio + reporte + intento (D3, D8). **Sin método de borrado**,
      y el comentario del archivo lo dice otra vez.
- [x] 7.2 Documentar en el README de despliegue que la credencial necesita `s3:PutObject` y
      `s3:GetObject` sobre el prefijo de reportes, y que `s3:DeleteObject` sigue explícitamente
      fuera.
- [x] 7.3 `reporting.controller.ts`: `GET /reports/compliance` (la vista),
      `POST /reports/compliance` (congelar y encolar), `GET /reports/compliance/:id` y
      `GET /reports/compliance/:id/pdf` (redirección a la URL firmada). Cuidar el orden de rutas
      frente a los literales existentes, con el test que ya cubre ese riesgo en el módulo.
- [x] 7.4 Tests de endpoint: descarga de un reporte sin render exitoso → `not_found`; descarga
      desde otro sitio → refusada; `POST` de un supervisor → refusado; `POST` del coordinador
      responde el reporte y su digest **antes** de que exista ningún render.

## 8. La inmutabilidad, la RLS y la auditoría

- [x] 8.1 Integración de inmutabilidad: `UPDATE` de `payload` o `payload_hash` por `hs_app`
      rechazado por privilegio; `UPDATE` por el dueño rechazado por trigger; `DELETE` y
      `TRUNCATE` rechazados en las dos tablas; `UPDATE` de `outcome`, `object_key` o `error` de
      un render rechazado.
- [x] 8.2 Integración de RLS: una transacción de St. Thomas no ve los reportes de Glencoe; un
      `INSERT` de reporte fuera del alcance declarado es rechazado; un render cuyo `site_id` no
      es el de su reporte falla en la FK compuesta.
- [x] 8.3 Integración de auditoría: generar appendea una entrada `compliance_report.generated`
      con el `payload_hash` y los conteos; un `INSERT` directo por fuera del endpoint la appendea
      igual; dos reportes del mismo rango appendean dos entradas y la cadena verifica intacta.
- [x] 8.4 Integración de auditoría del render: un render exitoso appendea
      `compliance_report.rendered` con su `object_key`; uno fallido **no** appendea nada y la
      cadena sigue intacta; dos renders exitosos appendean dos entradas con el mismo
      `payload_hash`.
- [x] 8.5 Los `CHECK` del render: `succeeded` con `object_key` null rechazado; `failed` con
      `object_key` no nulo rechazado.

## 9. La vista

- [x] 9.1 `apps/web/src/api/compliance.ts`: el cliente de los cuatro endpoints con TanStack
      Query, tipado desde `@hs/contracts`. **Fuera del service worker y fuera de Dexie**.
- [x] 9.2 `apps/web/src/routes/ComplianceRoute.tsx`: la grilla de meses del rango con su estado,
      la cobertura como fracción `completed/required`, y el selector de rango. **Sin porcentaje,
      sin gráfico y sin línea de tendencia.**
- [x] 9.3 La celda de un `missed` nunca abierto se distingue en el texto de la de un `missed`
      planificado, sin agregar un quinto estado (Risks).
- [x] 9.4 La lista de reportes generados con `generated_at`, `generated_by`, el `payload_hash`
      **completo y copiable** —sin truncar—, y la descarga cuando hay render exitoso; el último
      intento fallido visible con su error y un botón de reintentar.
- [x] 9.5 El botón de generar visible solo para el coordinador; la ruta y su entrada de menú
      registradas para coordinador, gerencia, JHSC, supervisor y auditor externo.
- [x] 9.6 `ComplianceRoute.test.tsx`: se renderiza la grilla de doce meses con `11/12`; un
      reporte sin render muestra el digest y ninguna descarga; el supervisor no ve el botón de
      generar; el digest se muestra en sus 64 caracteres.

## 10. Cierre

- [x] 10.1 Correr la prueba de la métrica de §1 de punta a punta con datos sembrados: un año
      completo por sitio, generar el reporte, verificar «12 de 12» y «11 de 12» según el sembrado,
      descargar el PDF y recomputar el digest desde el payload devuelto por la API con un script
      suelto que **no** use nuestro código de serialización más que `canonicalize`.
- [x] 10.2 Actualizar la fila «Changes que la consumen» de `docs/adr/002-engine-enforced-
      immutability.md` y `docs/adr/006-object-storage-and-pdf.md` con `compliance-period-export`.
- [x] 10.3 Dejar anotado en el change que la etapa 7 de §7 queda cerrada y **R5 completo**; lo
      único pendiente de §7 es la etapa 8, el builder visual.
- [x] 10.4 `pnpm lint`, `pnpm typecheck` y las suites de `apps/api`, `apps/web`,
      `packages/contracts` en verde, con el job del render incluido.
