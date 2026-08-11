-- Requisitos §3 R5, §1 y §7 etapa 7 — EL REPORTE DE CUMPLIMIENTO Y SU HASH.
--
-- R5, textual: «el coordinador consulta, por sitio, la lista de períodos con inspección
-- completada vs. omitida, y exporta a PDF con hash del contenido. Esa es la evidencia de
-- cobertura». La métrica número uno de §1 —«cobertura de períodos: 24 de 24»— sale de
-- este reporte y de ningún otro lado.
--
-- LO QUE ESTA MIGRACIÓN NO CREA, y es la mitad del change: **la cobertura no es una
-- tabla**. Los períodos y sus estados se calculan leyendo `inspection_schedule`,
-- `scheduled_inspection` e `inspection` en el momento en que alguien pregunta. No hay
-- vista materializada, no hay agregados y no hay job que los mantenga. Lo que SÍ se
-- guarda es el resultado congelado de esa consulta cuando alguien decide convertirlo en
-- evidencia — que es otra cosa, y es de lo que trata la tabla de §2.
--
-- LA DECISIÓN DE ADR-002 QUE ESTA MIGRACIÓN IMPLEMENTA: **se hashea el payload canónico
-- en JSON, no los bytes del PDF**. Chromium no produce el mismo archivo dos veces
-- —versión del navegador, fuentes del contenedor, subsetting, fecha de creación que el
-- propio PDF lleva adentro— así que un digest del archivo no verificaría a los seis
-- meses. Por eso `payload` es una columna y no un detalle del renderizador: sin el
-- payload guardado, el digest no se puede recomputar y no prueba nada.
--
-- LAS PROPIEDADES QUE ESTA MIGRACIÓN DEFIENDE, cada una con su barrera:
--
--   El digest es un SHA-256 y no cualquier cosa           CHECK de formato (§2)
--   Un reporte cubre meses enteros                        CHECK de borde de mes (§2)
--   El rango no puede estar invertido                     CHECK de orden (§2)
--   Un render es de la misma planta que su reporte        FK compuesta (§3)
--   `succeeded` trae archivo; `failed` trae error          CHECK de coherencia (§3)
--   Nadie modifica ni borra un reporte ni un render       hs_make_immutable (§4)
--   Nadie ve los reportes de la otra planta               hs_apply_site_isolation (§4)
--   Generar evidencia queda en la cadena de auditoría     trigger AFTER INSERT (§5)
--
-- NO ALTERA NINGUNA TABLA EXISTENTE. Ni una columna, ni una restricción, ni un GRANT
-- —a diferencia de 0013, que sí agregó un único sobre `finding`—. La aplicación anterior
-- a este despliegue simplemente ignora dos tablas nuevas, así que no hay orden que
-- respetar entre migrar y desplegar.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: regeneraría el
-- `.sql` a partir del espejo de TypeScript y se llevaría puesto el mecanismo (ADR-004).

-- ---------------------------------------------------------------------------
-- 2. `compliance_report` — el documento congelado.
--
-- `payload` ES UNA COLUMNA `jsonb` CON EL DOCUMENTO ENTERO, y es la decisión central
-- (design D1). La alternativa —guardar solo el digest y los parámetros, y reconstruir el
-- documento al leer— rompe lo único que este reporte tiene que garantizar: una inspección
-- de abril que se sube tarde cambiaría el `completed_count` de un reporte de mayo, y el
-- digest guardado dejaría de verificar contra el payload reconstruido. El síntoma sería
-- «el hash no coincide» sobre un documento correcto, que es el peor modo de fallo posible
-- en la superficie que existe para dar confianza.
--
-- La duplicación de datos es el costo, y con dos plantas y un puñado de reportes por año
-- se mide en kilobytes. Es exactamente el caso en que normalizar está mal.
CREATE TABLE compliance_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  site_id uuid NOT NULL REFERENCES site (id),

  -- El rango, como FECHAS CIVILES y no como instantes, por el mismo motivo que
  -- `scheduled_inspection.period_start`: un período es un mes del calendario, no una
  -- ventana de tiempo absoluto.
  range_start date NOT NULL,
  range_end date NOT NULL,

  -- El documento completo: cobertura, períodos, hallazgos, series de recurrencia y
  -- acciones abiertas, con `schema_version` adentro. Lo que se canonicaliza y se hashea
  -- es EXACTAMENTE esto.
  payload jsonb NOT NULL,

  -- SHA-256 del payload canonicalizado según RFC 8785, en hex minúscula.
  payload_hash text NOT NULL,

  -- NOT NULL: generar evidencia regulatoria es siempre un acto de alguien. Nada
  -- automático genera un reporte, a diferencia de la apertura de períodos de 0008.
  generated_by uuid NOT NULL REFERENCES app_user (id),

  generated_at timestamptz NOT NULL DEFAULT now(),

  -- El dominio del digest, en el motor y no solo en Zod. El contrato lo rechaza antes
  -- para devolver un error legible; esto lo rechaza igual por cualquier otro camino,
  -- incluido un INSERT directo. Minúscula y no mayúscula: dos formas de escribir el mismo
  -- número serían dos formas de que una comparación de cadenas falle sobre un documento
  -- correcto.
  CONSTRAINT compliance_report_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),

  -- MESES ENTEROS. Un reporte de cobertura cuenta períodos, y un rango que empieza el 15
  -- haría que «12 de 12» se refiriera a algo que no son doce meses.
  --
  -- `EXTRACT` y no `date_trunc`, por el mismo motivo que documenta 0008: la sobrecarga de
  -- `date_trunc` que resolvería acá es STABLE, y un CHECK con una función STABLE lo
  -- rechaza el motor. `EXTRACT(day FROM date)` es IMMUTABLE y dice lo mismo.
  CONSTRAINT compliance_report_range_start_check
    CHECK (EXTRACT(day FROM range_start) = 1),

  -- El último día del mes, expresado sin `date_trunc` por lo mismo: el día siguiente al
  -- fin de rango tiene que ser un día 1.
  CONSTRAINT compliance_report_range_end_check
    CHECK (EXTRACT(day FROM (range_end + 1)) = 1),

  CONSTRAINT compliance_report_range_order_check CHECK (range_end >= range_start),

  -- Destino de la FK compuesta de §3. Mismo patrón que `finding_id_site_uq`: es lo que
  -- impide que un render diga que es de una planta distinta de la de su reporte.
  CONSTRAINT compliance_report_id_site_uq UNIQUE (id, site_id)
);

--> statement-breakpoint

-- El listado de la vista: los reportes de una planta, del más reciente al más viejo.
CREATE INDEX compliance_report_site_generated_idx
  ON compliance_report (site_id, generated_at DESC);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. `compliance_report_render` — cada intento de producir el PDF.
--
-- UNA TABLA HERMANA Y NO UNA COLUMNA `object_key` EN EL REPORTE (design D3).
-- `compliance_report` es inmutable y no tiene un solo GRANT UPDATE: una columna con la
-- key del archivo tendría que escribirse DESPUÉS del insert, que es precisamente la
-- operación que el motor niega. Es el mismo razonamiento por el que 0013 no le puso
-- columnas de recurrencia a `finding`, y da algo más: el historial completo de intentos,
-- con sus errores, queda legible en la base en vez de perderse en un log.
--
-- NO EXISTE `queued`, Y LA AUSENCIA ES EL DISEÑO. Una fila se inserta cuando el intento
-- terminó. Un estado intermedio tendría que pasar después a `succeeded`, y esta tabla no
-- admite UPDATE. Que un reporte todavía no tenga PDF se lee de la ausencia de filas; en
-- qué anda el trabajo lo sabe pg-boss, que es de quien es.
--
-- REGENERAR ES LEGÍTIMO Y NO CAMBIA NADA DE LO QUE IMPORTA: el segundo render produce
-- otro archivo, con otra key, y el pie sigue imprimiendo EL MISMO digest, porque el
-- digest es del payload y el payload no se tocó.
CREATE TABLE compliance_report_render (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  report_id uuid NOT NULL REFERENCES compliance_report (id),

  -- Denormalizado: la política RLS necesita el sitio en la fila. La FK compuesta de abajo
  -- impide que diga algo distinto del sitio de su reporte.
  site_id uuid NOT NULL REFERENCES site (id),

  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),

  -- Dónde quedó el archivo. La key la deriva el servidor de sitio + reporte + intento, y
  -- nunca viene del request: dejar que el cliente la eligiera es dejar que escriba dentro
  -- del prefijo de otra planta.
  object_key text,

  -- Qué falló. Texto y no código: lo lee una persona que va a decidir si reintenta.
  error text,

  rendered_at timestamptz NOT NULL DEFAULT now(),

  -- El sitio del render es el de su reporte. Sin esto, la columna denormalizada que la
  -- política RLS lee podría decir una cosa mientras el reporte que describe dice otra.
  CONSTRAINT compliance_report_render_report_site_fk
    FOREIGN KEY (report_id, site_id) REFERENCES compliance_report (id, site_id),

  -- LAS DOS MITADES DE UN MISMO HECHO. «Salió bien pero no hay archivo» y «falló pero acá
  -- está el archivo» son las dos incoherentes, y las dos aparecerían el día que alguien
  -- escriba el insert del handler con las variables cruzadas.
  CONSTRAINT compliance_report_render_object_check
    CHECK ((outcome = 'succeeded') = (object_key IS NOT NULL)),

  CONSTRAINT compliance_report_render_error_check
    CHECK ((outcome = 'failed') = (error IS NOT NULL))
);

--> statement-breakpoint

-- El último render de un reporte: es la consulta que hace toda lectura de reporte.
CREATE INDEX compliance_report_render_report_idx
  ON compliance_report_render (report_id, rendered_at DESC);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Inmutabilidad y aislamiento.
--
-- Un reporte de cumplimiento es el documento que se le entrega al MLITSD. Un payload o un
-- digest editables después son un documento que no prueba nada, y un render borrable es
-- un archivo que se puede hacer que nunca haya existido. Las dos barreras del mecanismo,
-- como en todas las tablas del sistema: el privilegio revocado para `hs_app` y el trigger
-- guardia para cualquier rol, incluidos el dueño y `hs_migrator`.
SELECT hs_make_immutable('compliance_report');

--> statement-breakpoint

SELECT hs_make_immutable('compliance_report_render');

--> statement-breakpoint

-- `hs_apply_site_isolation` incluye `FORCE ROW LEVEL SECURITY` (ver 0001): sin FORCE, el
-- dueño de la tabla evadiría su propia política.
SELECT hs_apply_site_isolation('compliance_report');

--> statement-breakpoint

SELECT hs_apply_site_isolation('compliance_report_render');

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. La auditoría, por trigger y no por código de aplicación.
--
-- POR QUÉ EL `payload_hash` VIAJA DENTRO DE LA ENTRADA DE AUDITORÍA, duplicando lo que la
-- tabla de reportes ya dice (design D9): hace que la CADENA, por sí sola, pruebe que un
-- documento con ese contenido existió en esa fecha. La cadena está encadenada por hash y
-- es verificable con `hs_audit_verify_chain`; si mañana alguien discutiera la tabla de
-- reportes entera, la cadena sigue diciendo el digest. Es duplicación deliberada, y es la
-- que convierte dos mecanismos separados en una sola prueba.
--
-- Los conteos de cobertura se leen del propio `payload` y no se recalculan: la entrada
-- tiene que decir lo que el documento dice, no lo que la base diría hoy.
CREATE OR REPLACE FUNCTION hs_compliance_report_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  coverage jsonb := NEW.payload -> 'coverage';
BEGIN
  PERFORM hs_identity_audit_entry(
    NEW.site_id, 'compliance_report.generated',
    jsonb_build_object(
      'report_id', NEW.id,
      'site_id', NEW.site_id,
      'range_start', NEW.range_start,
      'range_end', NEW.range_end,
      'payload_hash', NEW.payload_hash,
      'schema_version', NEW.payload -> 'schema_version',
      'required_count', coverage -> 'required_count',
      'completed_count', coverage -> 'completed_count',
      'missed_count', coverage -> 'missed_count',
      'cancelled_count', coverage -> 'cancelled_count'));

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER compliance_report_audit
  AFTER INSERT ON compliance_report
  FOR EACH ROW EXECUTE FUNCTION hs_compliance_report_audit();

--> statement-breakpoint

-- UN RENDER FALLIDO NO APPENDEA NADA, y no es un olvido: un documento que nunca se
-- produjo no salió del sistema de ninguna forma, así que no hay hecho regulatorio que
-- registrar. El intento fallido sigue siendo legible como su propia fila, que es donde
-- corresponde que esté.
CREATE OR REPLACE FUNCTION hs_compliance_render_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  report_hash text;
BEGIN
  IF NEW.outcome <> 'succeeded' THEN
    RETURN NULL;
  END IF;

  SELECT payload_hash INTO report_hash
    FROM compliance_report
   WHERE id = NEW.report_id;

  PERFORM hs_identity_audit_entry(
    NEW.site_id, 'compliance_report.rendered',
    jsonb_build_object(
      'report_id', NEW.report_id,
      'site_id', NEW.site_id,
      'render_id', NEW.id,
      'object_key', NEW.object_key,
      -- El mismo digest que el reporte y que el pie de página del PDF. Dos renders del
      -- mismo reporte appendean dos entradas con este número idéntico: es lo que dice,
      -- dentro de la cadena, que los dos archivos son el mismo documento.
      'payload_hash', report_hash));

  RETURN NULL;
END;
$fn$;

--> statement-breakpoint

CREATE TRIGGER compliance_report_render_audit
  AFTER INSERT ON compliance_report_render
  FOR EACH ROW EXECUTE FUNCTION hs_compliance_render_audit();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Los privilegios de hs_app.
--
-- SELECT e INSERT, y se acaba la lista. NO HAY UN SOLO `GRANT UPDATE` EN ESTA MIGRACIÓN,
-- Y ESA AUSENCIA ES EL REQUISITO — igual que en 0009, 0010, 0011, 0012 y 0013.
--
-- Acá la tentación tiene dos formas y conviene nombrarlas. La primera: «poner el
-- `object_key` en el reporte cuando el render termine». No: para eso está la tabla
-- hermana. La segunda: «corregir un reporte que salió con un dato mal». Tampoco: un
-- reporte equivocado no se edita, se genera otro, y los dos quedan — que es lo que un
-- inspector esperaría poder ver.
GRANT SELECT, INSERT ON compliance_report TO hs_app;

--> statement-breakpoint

GRANT SELECT, INSERT ON compliance_report_render TO hs_app;
