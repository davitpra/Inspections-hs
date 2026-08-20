-- Requisitos §7 etapa 8 — El borrador declara en qué plantas se va a usar.
--
-- ESTA MIGRACIÓN NO TOCA NINGUNA TABLA INMUTABLE. Se dice primero porque es lo
-- primero que hay que poder verificar: no hay un solo ALTER, GRANT ni REVOKE
-- sobre `template`, `template_item`, `template_version` o `template_version_item`.
-- El `GRANT INSERT` que anuncia la sección 9 de 0003 sigue sin escribirse.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.

-- ---------------------------------------------------------------------------
-- 1. `site_ids` — DÓNDE SE USA LA PLANTILLA, QUE NO ES DE QUIÉN ES.
--
-- ESTO NO ES `site_id` Y NO REINTRODUCE LO QUE 0003 §1 Y 0016 §1 RECHAZAN.
-- Aquella decisión —una plantilla es contenido de referencia de la organización,
-- no un dato de sitio— sigue en pie palabra por palabra: si el borrador
-- perteneciera a una planta, la misma inspección mensual se escribiría dos veces
-- con dos juegos de `item_key` y "la misma guarda falta en los dos sitios"
-- dejaría de ser consultable. Nada de eso cambia acá.
--
-- Lo que esta columna agrega es otra cosa: la LISTA DE PLANTAS DONDE LA
-- PLANTILLA ESTÁ PENSADA PARA CORRER. Sigue siendo UNA plantilla, con UN juego de
-- `item_key`, y las dos plantas siguen compartiendo la serie. La lista existe
-- porque el catálogo de ubicaciones se mapea POR PLANTA (0018): una sección solo
-- puede nombrar una ubicación compartida que la planta donde la inspección corre
-- tenga tickeada, y sin saber para qué plantas se escribe no hay forma de
-- recortar esa oferta. Hoy se ofrecen todas, la sección se guarda igual, y el
-- hueco aparece recién en el ingest con un hallazgo sin ubicación
-- (`0019_nullable_finding_locations.sql`), meses después y lejos del autor.
--
-- POR ESO SIGUE SIN HABER POLÍTICA RLS, y la sección 3 lo repite: el aislamiento
-- por sitio de ADR-004 responde "¿de qué planta es esta fila?", y de esta fila la
-- respuesta sigue siendo "de ninguna".
--
-- ARREGLO Y NO TABLA PUENTE, porque el alcance tiene que viajar dentro del MISMO
-- UPDATE con lock de revisión que el documento (0016 §1). Una tabla puente
-- obligaría a borrar filas para achicar el alcance, y ADR-002 prohíbe el DELETE
-- sin excepción.
--
-- EL PRECIO, DICHO ACÁ PARA QUE NO HAYA QUE DEDUCIRLO: PostgreSQL no admite FK
-- sobre el elemento de un arreglo, así que el motor NO garantiza que estos uuid
-- sean sitios. Lo garantiza `templates.service.ts`, comprobando que estén en el
-- alcance de la sesión —que sale de `user_site_scope` en cada request, nunca del
-- token—. Es la única integridad de este change que no vive en la base.
ALTER TABLE template_draft
  ADD COLUMN site_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Los borradores que ya existían valen para todas las plantas.
--
-- Es el alcance que tenían DE HECHO: hasta esta migración ninguna pantalla
-- recortaba nada, así que un borrador escrito ayer se pensó para las dos plantas.
-- Va antes del CHECK de la sección 3 porque el DEFAULT es el arreglo vacío y ese
-- CHECK lo rechaza.
UPDATE template_draft
   SET site_ids = coalesce(
         (SELECT array_agg(id ORDER BY code) FROM site WHERE deactivated_at IS NULL),
         '{}'::uuid[]
       );

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Al menos una planta.
--
-- Lo único de esta columna que el motor SÍ puede sostener, y por eso se escribe.
-- Un alcance vacío no es "todas": es una plantilla que no se puede usar en ningún
-- lado, y una pantalla que lo permitiera dejaría al autor escribiendo algo que no
-- va a correr nunca.
ALTER TABLE template_draft
  ADD CONSTRAINT template_draft_site_ids_not_empty
  CHECK (cardinality(site_ids) >= 1);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. `site_ids` se suma a lo mutable.
--
-- LA LISTA COMPLETA pasa a ser esta. Se reescribe entera y no se agrega un GRANT
-- suelto, porque el punto de 0016 §4 es que leer una sola sentencia alcance para
-- saber qué puede escribir la aplicación.
--
-- `key` y `created_by` siguen sin estar, por las razones de 0016 §4.
GRANT UPDATE (name, document, revision, updated_at, discarded_at, site_ids)
  ON template_draft TO hs_app;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Sigue sin aislamiento por sitio, y ahora hay que decirlo más fuerte.
--
-- 0016 §5 explicaba la ausencia de `hs_apply_site_isolation('template_draft')`
-- con que la tabla no tenía nada que aislar. Ahora tiene una columna con uuid de
-- sitio adentro, así que la ausencia deja de ser evidente y pasa a necesitar
-- argumento: `site_ids` es CONTENIDO —dónde se piensa usar la plantilla—, no
-- TENENCIA. Una política que recortara los borradores por él escondería del
-- coordinador de las dos plantas la plantilla que él mismo acotó a una, que es
-- exactamente al revés de lo que el alcance quiere decir.
--
-- La autorización de esta tabla sigue siendo por ROL, comprobada en
-- `templates.service.ts`. Lo que el servicio SÍ hace con `site_ids` es negarse a
-- escribir una planta fuera del alcance de la sesión: eso es selección, con el
-- mismo criterio que `sites.service.ts`, y no el borde de seguridad.
--
-- Este bloque no ejecuta nada; existe para que la ausencia siga siendo legible.
SELECT 1;
