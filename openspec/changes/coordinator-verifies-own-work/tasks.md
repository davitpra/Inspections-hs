## 1. Decisión y alcance vigente

- [x] 1.1 Crear `docs/adr/019-el-coordinador-verifica-lo-que-ejecuto.md`: qué se enmienda (el
  control de cuatro ojos de R3 deja de aplicar cuando la cuenta que verifica es
  `hs_coordinator`), qué se conserva entero (la regla para `supervisor` y `management`, la
  comparación contra el `actor_user_id` del evento de completado y no contra
  `assignee_person_id`, la guarda en el motor de ADR-002/ADR-004, el `reason` obligatorio al
  rechazar, los escalamientos de +3 y +7 días) y el costo aceptado. Referencias: §3 R3, §4
  tabla de roles, ADR-002, ADR-004, ADR-017. Sin `Supersede`. Añadir la fila al índice de
  `docs/adr/README.md` sin reescribir ningún ADR aceptado.
- [x] 1.2 Enmendar §3 R3 de `docs/Requisitos_V1.2.md`: la frase "**Una persona distinta del
  ejecutor** la verifica y la cierra" pasa a nombrar la excepción del coordinador y a citar
  ADR-019, igual que la frase de la evidencia cita ADR-016. No tocar el resto del párrafo.
  Comprobar §7 etapa 5 —declara "R3 completo"— y anotarla contra ADR-019.

## 2. Contratos

- [x] 2.1 En `packages/contracts/src/actions.ts`, reescribir el docblock de
  `TRANSITION_REQUIREMENTS` para `not_executor`: sigue siendo "el actor no puede ser quien
  declaró el trabajo hecho", con la excepción de `hs_coordinator` (ADR-019) y con la nota de
  dónde se resuelve —el servicio y la guarda del motor, igual que `ASSIGNEE` se resuelve contra
  `app_user.person_id`—. Las filas de `TRANSITIONS` no cambian: ni `roles` ni `requires`.
- [x] 2.2 Comprobar `packages/contracts/src/actions.test.ts:72` ("toda transición que exige
  `not_executor` sale de `awaiting_verification`"): sigue siendo cierto y no se toca. Si la
  redacción del test afirma algo sobre quién queda excluido, ajustarla al nuevo significado.

## 3. Persistencia

- [x] 3.1 Escribir `apps/api/drizzle/0042_coordinator_verifier_exception.sql` con la cabecera
  del repo: qué enmienda (la guarda `hs_action_verifier_guard` de `0011_corrective_actions.sql`,
  SQLSTATE `HS005`), por qué la excepción va en el motor y no en el endpoint (ADR-002, ADR-004),
  y la declaración explícita de que **NO altera ninguna tabla inmutable** — es
  `CREATE OR REPLACE FUNCTION` del rol dueño, sin `ALTER TABLE`, sin GRANT nuevo y sin política
  RLS. Escrita a mano; `drizzle-kit generate` sigue prohibido.
- [x] 3.2 En esa migración, reemplazar el cuerpo de `hs_action_verifier_guard()`: además del
  `actor_user_id` del último evento a `awaiting_verification`, leer
  `app_user.role` del `NEW.actor_user_id` y levantar `HS005` solo si coinciden **y** el rol no
  es `hs_coordinator`. No recrear el trigger `corrective_action_event_verifier_guard`, que
  sigue apuntando a la misma función. Sin `SECURITY DEFINER`: `app_user` no lleva RLS y `hs_app`
  ya tiene `SELECT` (`0005_identity.sql`). Conservar el mensaje, el `HINT` y el `ERRCODE`
  para los roles que siguen bajo la regla.

## 4. API

- [x] 4.1 En `ActionsService.transition` (`apps/api/src/actions/actions.service.ts:227`),
  incorporar el rol de la sesión al chequeo previo: se lanza `verifierIsExecutor()` solo si
  `executor === session.userId` y `session.role !== 'hs_coordinator'`. Sin consulta nueva —la
  sesión ya trae el rol—. Actualizar el comentario que explica que el motor lo comprueba otra
  vez con `HS005`, para que nombre la excepción.
- [x] 4.2 Actualizar el docblock de cabecera del servicio
  (`apps/api/src/actions/actions.service.ts:47`), que enumera lo que garantiza el motor y
  nombra `HS005`, y el comentario de `verifierIsExecutor` en
  `apps/api/src/actions/actions.errors.ts` si describe la regla como universal. El código de
  error `verifier_is_executor` no cambia de nombre ni de mapeo.

## 5. Web

- [x] 5.1 En `apps/web/src/routes/InspectionFindingsRoute/presentation.ts:234`, reescribir
  `REQUIREMENT_LABELS.not_executor` para que no prometa una regla que ya no aplica a quien lee:
  el texto bajo *Next step* pasa a decir que lo envía un verificador distinto de quien declaró
  el trabajo hecho, salvo el coordinador de H&S. Sigue siendo una sola frase.
- [x] 5.2 No tocar `apps/web/src/permissions/actions.ts`: `canAttempt` no evalúa `not_executor`
  a propósito (media regla copiada al cliente se separa de su otra mitad), y esa decisión sigue
  siendo correcta —el botón se ofrece y el servidor responde `verifier_is_executor` a quien
  todavía lo tiene prohibido—. Comprobar que el comentario que lo explica sigue diciendo la
  verdad y ajustarlo si nombra al coordinador como caso bloqueado.

## 6. Tests

- [x] 6.1 En `apps/api/test/corrective-actions.int-spec.ts`, releer los tres casos que esperan
  `verifier_is_executor` (líneas ~851, ~867, ~967) y el INSERT directo que espera `HS005`
  (~870): el que hoy usa al coordinador como ejecutor pasa a un `supervisor`, para que la regla
  que sigue vigente conserve su cobertura. Ninguno se borra.
- [x] 6.2 Agregar en el mismo archivo los casos positivos: el coordinador que declaró el trabajo
  hecho cierra la acción, el coordinador que lo declaró hecho lo rechaza con `reason` y la
  acción vuelve a `in_progress`, y un INSERT directo del coordinador ejecutor **no** falla en la
  guarda. Agregar el caso negativo de `management` si no está cubierto.
- [x] 6.3 En `apps/api/test/incidents.int-spec.ts:1357`, comprobar con qué rol se ejecuta el caso
  que espera `verifier_is_executor` y ajustarlo igual que 6.1.
