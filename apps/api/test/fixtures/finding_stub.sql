-- Stand-in del Hallazgo para el spike 3. NO es esquema de producción.
--
-- La tabla `finding` real es de la etapa 4 (requisitos §7): lleva origen,
-- descripción, foto obligatoria, ubicación, clasificación de riesgo y nivel de
-- jerarquía de controles. Nada de eso hace falta para probar la identidad del
-- ítem, y adelantarlo dejaría una tabla inmutable a la que después hay que
-- agregarle columnas NOT NULL.
--
-- Lo que sí es real acá son las claves foráneas: la identidad dual que §4 le
-- exige al hallazgo, y la ubicación que le exige §6 pregunta cerrada 1, apuntan a
-- las tablas de producción, sin simular nada.
--
--   template_version_item_id  fidelidad legal: qué pregunta se hizo, con esa
--                             redacción, en esa sección, con ese tipo de
--                             respuesta, el día que se contestó.
--   item_key                  agrupación: la clave de la detección de recurrencia.
--   (site_id, location_id)    dónde pasó, y la garantía de que el "dónde" es del
--                             mismo sitio que el hallazgo.
--
-- CUANDO LA ETAPA 4 CREE `finding`, ESTE ARCHIVO SE RETIRA y
-- `item-identity.int-spec.ts` y `catalog.int-spec.ts` se reapuntan a la tabla
-- real. Las aserciones no cambian: son las mismas consultas.

CREATE TABLE finding_stub (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  template_version_item_id uuid NOT NULL REFERENCES template_version_item (id),

  -- Nullable a propósito: un hallazgo de entrada manual no tiene `item_key` y por
  -- lo tanto queda fuera de la detección de recurrencia. Es la consecuencia
  -- aceptada de §4, y el test la ejerce en lugar de ignorarla.
  item_key text REFERENCES template_item (item_key),

  -- La FK COMPUESTA, que es la parte real de esto: con las dos columnas juntas
  -- apuntando a `location (site_id, id)`, un hallazgo de St. Thomas con una
  -- ubicación de Glencoe es un error de FK y no un bug de validación.
  --
  -- El RLS no alcanza para atraparlo: el coordinador tiene las dos plantas en su
  -- alcance, así que para él las dos filas son visibles y la política no dice
  -- nada. Por eso la garantía vive en la clave y no en la política.
  --
  -- Los chequeos de integridad referencial de Postgres corren con RLS
  -- deshabilitado, así que la FK resuelve una ubicación de otro sitio aunque la
  -- transacción no la pueda ver: rechaza por sitio equivocado, no por invisible.
  site_id uuid NOT NULL REFERENCES site (id),
  location_id uuid NOT NULL,

  occurred_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (site_id, location_id) REFERENCES location (site_id, id)
);
