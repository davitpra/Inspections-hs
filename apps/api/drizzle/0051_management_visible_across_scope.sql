-- ADR-002, ADR-004 y capability identity: una cuenta de management puede ser visible
-- en cada sitio de su alcance aunque su persona pertenezca a otro sitio.
--
-- Esta política es SELECT-only a propósito. `person_site_isolation` sigue siendo la única
-- política que permite UPDATE y, como consecuencia de FORCE RLS, también los locks sobre
-- una persona. La excepción de lectura no abre una vía para editarla desde otro sitio.
-- No se toca ninguna tabla inmutable, ningún GRANT/REVOKE ni la política existente.

CREATE POLICY person_management_scope_read ON person
  FOR SELECT
  USING (EXISTS (
    SELECT 1
      FROM app_user u
      JOIN user_site_scope s ON s.user_id = u.id
     WHERE u.person_id = person.id
       AND u.role = 'management'
       AND hs_account_is_active(u)
       AND s.revoked_at IS NULL
       AND s.site_id = ANY (
         string_to_array(current_setting('app.site_ids', true), ',')::uuid[]
       )
  ));
