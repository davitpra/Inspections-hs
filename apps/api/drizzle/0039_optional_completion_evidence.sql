-- Evidencia de cierre opcional (ADR-016).
--
-- Esta migración retira únicamente la compuerta que impedía commitear un evento
-- `awaiting_verification` sin evidencia `after`. `corrective_action_event` y
-- `corrective_action_evidence` conservan los triggers de `hs_make_immutable` y las
-- políticas creadas por `hs_apply_site_isolation`; no se agrega ni se retira ningún
-- GRANT, REVOKE o política.
--
-- No se escribe ni se borra ninguna fila. La evidencia y la auditoría existentes se
-- conservan intactas.

DROP TRIGGER corrective_action_evidence_required ON corrective_action_event;

--> statement-breakpoint

DROP FUNCTION hs_action_evidence_required();
