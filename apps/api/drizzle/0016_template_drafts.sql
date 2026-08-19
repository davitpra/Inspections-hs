-- Requisitos §7 etapa 8 (primera mitad) — El borrador de una plantilla.
--
-- ESTA MIGRACIÓN NO TOCA NINGUNA TABLA INMUTABLE. Se dice primero porque es lo
-- primero que hay que poder verificar: no hay un solo ALTER, GRANT ni REVOKE
-- sobre `template`, `template_item`, `template_version` o `template_version_item`.
-- El `GRANT INSERT` que anuncia la sección 9 de 0003 sigue sin escribirse; llega
-- con la publicación, que es la segunda mitad de la etapa 8 y otro change.
--
-- Lo que crea es una tabla que es lo contrario de una versión publicada: se
-- reescribe cien veces, puede estar incompleta y no la referencia nadie. Guardar
-- un borrador dentro de `template_version` habría convertido en mutable la única
-- tabla que el modelo entero existe para congelar, y habría obligado al trigger
-- de numeración y al de proyección a aprender un estado que fueron escritos para
-- hacer imposible.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.

-- ---------------------------------------------------------------------------
-- 1. `template_draft` — el documento mientras se escribe.
--
-- MUTABLE Y DECLARADO. ADR-002 no prohíbe la mutabilidad: prohíbe que sea el
-- default. Acá se concede columna por columna en la sección 4, igual que 0008
-- hace con `inspection_schedule`, y lo que queda afuera de esa lista queda
-- afuera de verdad. Lo que ADR-002 sí prohíbe sin excepción es el DELETE, y la
-- sección 3 lo prohíbe.
--
-- AUTÓNOMO: sin FK a `template`. Un borrador lleva su propia `key` y su propio
-- `name` propuestos, y no escribe una sola fila en el modelo publicado. Es lo que
-- permite que esta migración no abra ni un permiso allá: si crear un borrador
-- creara la cabecera, "crear un borrador" ya necesitaría INSERT sobre `template`.
--
-- SIN `site_id` Y POR LO TANTO SIN POLÍTICA RLS, por la misma razón que
-- `template` no lo lleva y con las mismas palabras de 0003 §1: una plantilla es
-- contenido de referencia de la organización, no un dato de sitio. Si el borrador
-- llevara `site_id`, la misma inspección mensual se escribiría dos veces con dos
-- juegos de `item_key` y "la misma guarda falta en los dos sitios" dejaría de ser
-- consultable. La autorización de esta tabla es por ROL —`hs_coordinator`,
-- comprobado en el servicio— y no por alcance de sitio. Ver la sección 5.
CREATE TABLE template_draft (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- La `key` que la plantilla va a heredar al publicarse. Write-once: no está en
  -- el GRANT UPDATE de la sección 4. El patrón es el mismo que `@hs/contracts`
  -- exige y el mismo espacio de `item_key` en 0003; SQL no puede importar
  -- TypeScript y la duplicación es deliberada, igual que allá.
  key text NOT NULL CONSTRAINT template_draft_key_check
    CHECK (key ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'),

  name text NOT NULL CONSTRAINT template_draft_name_check CHECK (length(btrim(name)) > 0),

  -- El documento en su forma laxa (`templateDraftDocumentSchema` de
  -- `@hs/forms`): sin `position` —el orden lo lleva el arreglo— y admitiendo
  -- secciones sin ítems y textos vacíos. NO se valida acá contra la forma
  -- publicable, a propósito: un documento que se está escribiendo pasa la mayor
  -- parte de su vida sin poder publicarse, y un CHECK que lo rechazara obligaría
  -- a terminar una sección antes de poder dejarla a medias.
  document jsonb NOT NULL,

  -- El lock optimista. Cada guardado lo incrementa; un guardado que declare otra
  -- revisión se rechaza. Dos ventanas del mismo autor sobre el mismo borrador es
  -- el caso normal, no el raro, y sin esto la segunda pisa a la primera en
  -- silencio.
  revision integer NOT NULL DEFAULT 1
    CONSTRAINT template_draft_revision_check CHECK (revision > 0),

  -- Quién lo empezó. Sin FK a `app_user` a propósito, igual que
  -- `template_version.published_by` en 0003: es una anotación de autoría, no una
  -- relación que alguien navegue, y una cuenta desactivada no debe poder impedir
  -- que el borrador siga existiendo.
  created_by uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Nunca DELETE. Descartar un borrador es esto y nada más.
  discarded_at timestamptz
);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Una `key` viva a la vez.
--
-- Parcial y no `UNIQUE` a secas: un borrador descartado libera su `key`, que es
-- lo que hace que equivocarse al crear uno no sea permanente.
--
-- Esto cubre borrador-contra-borrador. La colisión contra una plantilla YA
-- PUBLICADA no la puede cubrir un índice —son dos tablas— y la comprueba el
-- servicio antes de insertar. Esa comprobación es una cortesía, no una garantía:
-- la refutación autoritativa es el `UNIQUE` de `template.key` en el momento de
-- publicar. Se chequea temprano para que el autor se entere al elegir el nombre y
-- no al terminar la plantilla.
CREATE UNIQUE INDEX template_draft_key_live_idx
  ON template_draft (key)
  WHERE discarded_at IS NULL;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Borrar sigue estando prohibido.
--
-- `hs_forbid_mutation()` es la función de 0001. No se llama a
-- `hs_make_immutable()`: esa revoca también UPDATE, que acá es justamente lo que
-- la tabla necesita. Se toma la mitad que corresponde —el DELETE— y se deja la
-- otra a la lista explícita de la sección 4.
CREATE TRIGGER template_draft_forbid_deletion
  BEFORE DELETE ON template_draft
  FOR EACH ROW EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

CREATE TRIGGER template_draft_forbid_truncate
  BEFORE TRUNCATE ON template_draft
  FOR EACH STATEMENT EXECUTE FUNCTION hs_forbid_mutation();

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Los privilegios de hs_app.
--
-- Los default privileges de `db/init/01-roles.sql` ya conceden SELECT e INSERT
-- sobre todo lo que cree hs_migrator. Se repite explícito, como en 0005 y 0008:
-- leer esta sección tiene que alcanzar para saber qué puede hacer la aplicación,
-- sin ir a buscar otro archivo.
GRANT SELECT, INSERT ON template_draft TO hs_app;

--> statement-breakpoint

-- LA LISTA COMPLETA DE LO MUTABLE. Todo lo que no está acá es inmutable para
-- hs_app por privilegio.
--
-- `key` NO está: la identidad de un borrador se elige una vez. Reescribirla
-- después convertiría el índice parcial de la sección 2 en una comprobación que
-- se puede evadir, y dejaría al autor creyendo que reservó un nombre que ya no
-- tiene.
--
-- `created_by` NO está: es un hecho, no un campo.
--
-- Y no hace falta decir que `id` y `created_at` tampoco: no están.
GRANT UPDATE (name, document, revision, updated_at, discarded_at)
  ON template_draft TO hs_app;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Sin aislamiento por sitio, y no es un olvido.
--
-- No se llama a `hs_apply_site_isolation('template_draft')` porque la tabla no
-- tiene `site_id` que aislar (sección 1). El invariante de ADR-004 —"el
-- aislamiento por sitio es RLS, nunca un WHERE en el endpoint"— se cumple
-- vacuamente: no hay nada que recortar por sitio, porque un borrador de plantilla
-- no pertenece a una planta.
--
-- Lo que sí lo protege es el rol, comprobado en `templates.service.ts` como lo
-- hace `roster.service.ts`: solo `hs_coordinator` lo lee y lo escribe. Queda
-- escrito acá y no solo en el design porque quien audite los GRANT de esta
-- migración tiene que poder ver que la ausencia de política fue una decisión.
--
-- Este bloque no ejecuta nada; existe para que la ausencia sea legible.
SELECT 1;
