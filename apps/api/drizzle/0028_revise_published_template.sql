-- Requisitos §7 etapa 8 (tercera mitad) — Revisar una plantilla publicada.
--
-- Corregir una plantilla es publicar una versión más, y el modelo publicado ya
-- sabe hacerlo: `template_version.version` es un entero con UNIQUE por plantilla y
-- `hs_template_version_next()` (0003 §5) ya exige que la siguiente sea exactamente
-- `max + 1`. Lo único que faltaba era de dónde sale el documento de esa versión.
--
-- Esta migración NO concede ni un permiso nuevo sobre el modelo publicado. El
-- INSERT de 0025 §1 alcanza, porque una revisión escribe filas nuevas y no toca
-- ninguna vieja: ni UPDATE ni DELETE sobre `template`, `template_item`,
-- `template_version` ni `template_version_item`.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido: ver el
-- comentario de `apps/api/drizzle.config.ts`.

-- ---------------------------------------------------------------------------
-- 1. Qué plantilla revisa este borrador.
--
-- NULA significa «este borrador va a crear una plantilla»; no nula, «este
-- borrador va a agregarle una versión a esta». Es la única diferencia entre las
-- dos cosas, y por eso no hay una tabla aparte: un borrador de revisión se
-- escribe con el mismo editor, se guarda con el mismo PUT y se descarta con el
-- mismo POST.
--
-- WRITE-ONCE, y por omisión: no entra en el GRANT UPDATE de §4, igual que `key` y
-- `created_by`. Un borrador no cambia de plantilla a mitad de camino, y que eso
-- sea imposible en el motor y no en un `if` es la línea de ADR-002.
ALTER TABLE template_draft
  ADD COLUMN template_id uuid REFERENCES template (id);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Una sola revisión viva por plantilla.
--
-- Dos serían dos correcciones que no se ven entre sí: la segunda en publicarse
-- saldría como la versión siguiente sin contener nada de la primera, y no hay
-- forma honesta de fusionarlas. El servicio no crea la segunda —devuelve la que
-- ya está viva—, pero la garantía es esta.
--
-- Descartada o publicada deja de contar, así que una plantilla se puede volver a
-- revisar cuando la revisión anterior terminó de cualquiera de las dos maneras.
CREATE UNIQUE INDEX template_draft_revision_live_idx
  ON template_draft (template_id)
  WHERE template_id IS NOT NULL AND discarded_at IS NULL AND published_at IS NULL;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Un borrador de revisión NO reserva su clave ni su nombre.
--
-- Los lleva a propósito: son los de la plantilla que corrige. Contarlo como
-- segundo dueño de esa clave sería negarle al coordinador la corrección de su
-- propia plantilla, que es justo lo que este change viene a hacer posible.
--
-- La unicidad que estos dos índices protegían no se pierde. El dueño autoritativo
-- de una clave publicada es la fila `template`, y lo garantiza `template.key
-- UNIQUE` (0003 §1). Lo que queda acá es la unicidad ENTRE BORRADORES DE
-- PLANTILLAS NUEVAS, que es la población para la que se escribieron (0016 §2,
-- 0017 §1, 0025 §4).
DROP INDEX template_draft_key_live_idx;

--> statement-breakpoint

CREATE UNIQUE INDEX template_draft_key_live_idx
  ON template_draft (key)
  WHERE template_id IS NULL AND discarded_at IS NULL AND published_at IS NULL;

--> statement-breakpoint

DROP INDEX template_draft_name_live_idx;

--> statement-breakpoint

CREATE UNIQUE INDEX template_draft_name_live_idx
  ON template_draft (lower(btrim(name)))
  WHERE template_id IS NULL AND discarded_at IS NULL AND published_at IS NULL;
