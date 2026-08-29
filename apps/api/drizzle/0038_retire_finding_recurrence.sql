-- Retirada preproducción de la recurrencia de hallazgos (ADR-015).
--
-- PRECONDICIÓN: esta migración solo se puede aplicar antes de cualquier despliegue con
-- datos de producción. Si la base contiene evidencia regulatoria, detener el despliegue
-- y revisar la decisión. La marca se elimina de forma destructiva; no se borra ni se
-- reescribe ninguna fila de `audit_log`, aunque sus payloads históricos —incluidas las
-- lecturas registradas contra `finding_recurrence`— nombren una tabla ya retirada.
--
-- QUÉ NO SE RETIRA, y conviene que quede escrito: `finding.item_key` y las tres claves
-- gemelas de `template_item`, `template_version_item` e `inspection_answer`. La
-- recurrencia era su consumidor más visible, no el único: `item_key` es la identidad de
-- la pregunta a través de versiones publicadas (§4), y de ella dependen la publicación,
-- el avance de versión y la lectura de una inspección enviada. Lo único que se va acá es
-- el UNIQUE que 0013 agregó sobre `finding` para tener destino de FK compuesta.
--
-- `DROP TABLE` arrastra los GRANT, la política de aislamiento que dejó
-- `hs_apply_site_isolation`, los triggers de `hs_make_immutable`, los CHECK y el UNIQUE
-- de la propia tabla. No hay una función de auditoría propia que eliminar: la marca
-- nunca tuvo una, a diferencia de `compliance_report` en 0031.

DROP TABLE IF EXISTS finding_recurrence;

--> statement-breakpoint

-- El índice parcial que 0010 creó para el GROUP BY de la etapa 7, con su único lector
-- retirado. `finding_site_recorded_idx` y `finding_inspection_idx` se conservan: son los
-- del listado de hallazgos y los de la lectura que sigue a un envío.
DROP INDEX IF EXISTS finding_recurrence_idx;

--> statement-breakpoint

-- Solo era el destino de la FK compuesta de la marca (0013 §1). `finding.id` sigue
-- siendo la clave primaria y `finding_id_site_uq` sigue sosteniendo la FK compuesta de
-- `finding_photo`.
ALTER TABLE finding
  DROP CONSTRAINT IF EXISTS finding_id_item_key_uq;
