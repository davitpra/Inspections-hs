-- Requisitos §3 R3, §4 roles y §7 etapa 5 — EL COORDINADOR VERIFICA LO QUE EJECUTÓ (ADR-019).
--
-- 0011 escribió el control de cuatro ojos de R3 como una regla sin excepción: quien insertó
-- el evento que movió la acción a `awaiting_verification` no puede insertar el que la saca de
-- ahí. La comparación es contra el `actor_user_id` de ESE evento y no contra
-- `assignee_person_id`, y eso no cambia — sigue siendo el dato correcto, porque el ejecutor
-- real es quien declaró el trabajo hecho.
--
-- LO QUE CAMBIA ES A QUIÉN ATRAPA. Justo el caso que 0011 nombraba para justificar la
-- comparación —el coordinador actuando en nombre de una persona del roster sin cuenta— es el
-- que deja el sistema trabado: hay UN `hs_coordinator` sobre dos sitios, así que la acción
-- queda retenida en `awaiting_verification` esperando a un supervisor o a gerencia que no
-- participó del trabajo. Eso no es un segundo par de ojos; es trabajo terminado que el
-- registro muestra como pendiente.
--
-- LA EXCEPCIÓN VA EN EL MOTOR Y NO EN EL ENDPOINT (ADR-002, ADR-004). Quitar el trigger y
-- dejar la regla en NestJS convertiría una barrera del esquema en una comprobación de
-- aplicación, que es exactamente lo que esas dos ADR prohíben: el escenario del INSERT
-- directo dejaría de valer y el registro pasaría a defenderse auditando código.
--
-- EL ROL SE LEE DE `app_user`, NUNCA DEL EVENTO. Un rol que viajara con la fila sería un dato
-- que el llamador puede mentir, y una guarda que confía en lo que le pasan no es una guarda.
-- Se lee el rol VIGENTE al momento del INSERT y no el que tenía al declarar el trabajo hecho:
-- la autorización siempre es sobre quien actúa ahora, igual que `requireActor`.
--
-- Sin `SECURITY DEFINER`, como las otras guardas de 0011: `app_user` no lleva RLS (0005 §2) y
-- `hs_app` ya tiene `SELECT` sobre ella (0005), así que la función corre como el invocador.
--
-- ESTA MIGRACIÓN NO ALTERA NINGUNA TABLA, INMUTABLE NI MUTABLE. Reemplaza el cuerpo de una
-- función y nada más: ni `ALTER TABLE`, ni GRANT nuevo, ni política RLS. El trigger
-- `corrective_action_event_verifier_guard` sigue apuntando a la misma función y no se recrea.
-- `0011_corrective_actions.sql` no se edita: una migración aplicada no se reescribe.
--
-- Escrita a mano, como todas. `drizzle-kit generate` está prohibido.
--
-- SQLSTATEs: ninguno nuevo. `HS005` conserva su código, su mensaje y su `HINT` para los roles
-- que siguen bajo la regla — `supervisor` y `management`.

-- ---------------------------------------------------------------------------
-- §3 R3, enmendado por ADR-019: "Una persona distinta del ejecutor la verifica y la cierra,
-- salvo el coordinador de H&S."
CREATE OR REPLACE FUNCTION hs_action_verifier_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  executor uuid;
  actor_role text;
BEGIN
  IF NEW.from_state IS DISTINCT FROM 'awaiting_verification' THEN
    RETURN NEW;
  END IF;

  SELECT e.actor_user_id INTO executor
    FROM corrective_action_event e
   WHERE e.action_id = NEW.action_id
     AND e.to_state = 'awaiting_verification'
   ORDER BY e.position DESC
   LIMIT 1;

  IF executor IS DISTINCT FROM NEW.actor_user_id THEN
    RETURN NEW;
  END IF;

  -- Solo se pregunta el rol cuando el actor YA coincide con el ejecutor: es el único caso en
  -- que la respuesta cambia algo, y así la guarda no agrega una lectura a cada verificación.
  SELECT u.role INTO actor_role
    FROM app_user u
   WHERE u.id = NEW.actor_user_id;

  IF actor_role = 'hs_coordinator' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'user % declared action % done and cannot verify it', NEW.actor_user_id, NEW.action_id
    USING ERRCODE = 'HS005',
          HINT = 'A corrective action is verified by someone other than whoever did the work, unless they are the HS coordinator.';

  RETURN NEW;
END;
$fn$;
