-- Stand-in del Hallazgo para el spike 3. NO es esquema de producción.
--
-- La tabla `finding` real es de la etapa 4 (requisitos §7): lleva origen,
-- descripción, foto obligatoria, ubicación, clasificación de riesgo y nivel de
-- jerarquía de controles. Nada de eso hace falta para probar la identidad del
-- ítem, y adelantarlo dejaría una tabla inmutable a la que después hay que
-- agregarle columnas NOT NULL.
--
-- Lo que sí es real acá son las dos claves foráneas: la identidad dual que §4 le
-- exige al hallazgo apunta a las tablas de producción, sin simular nada.
--
--   template_version_item_id  fidelidad legal: qué pregunta se hizo, con esa
--                             redacción, en esa sección, con ese tipo de
--                             respuesta, el día que se contestó.
--   item_key                  agrupación: la clave de la detección de recurrencia.
--
-- CUANDO LA ETAPA 4 CREE `finding`, ESTE ARCHIVO SE RETIRA y
-- `item-identity.int-spec.ts` se reapunta a la tabla real. La aserción del spike
-- no cambia: es la misma consulta.

CREATE TABLE finding_stub (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  template_version_item_id uuid NOT NULL REFERENCES template_version_item (id),

  -- Nullable a propósito: un hallazgo de entrada manual no tiene `item_key` y por
  -- lo tanto queda fuera de la detección de recurrencia. Es la consecuencia
  -- aceptada de §4, y el test la ejerce en lugar de ignorarla.
  item_key text REFERENCES template_item (item_key),

  occurred_at timestamptz NOT NULL DEFAULT now()
);
