-- Retirada preproducción de R5. La base solo contiene datos de desarrollo.
-- No borrar ni reescribir `audit_log`: sus eventos históricos conservan la cadena hash.

DROP TABLE IF EXISTS compliance_report_render;
DROP TABLE IF EXISTS compliance_report;

DROP FUNCTION IF EXISTS hs_compliance_render_audit();
DROP FUNCTION IF EXISTS hs_compliance_report_audit();
