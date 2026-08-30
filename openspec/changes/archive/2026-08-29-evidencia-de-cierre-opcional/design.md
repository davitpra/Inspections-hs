## Context

Ver `proposal.md` — Why. Lo que importa acá es dónde está escrita hoy la obligación, porque
son cuatro lugares y cada uno se retira distinto:

1. `TRANSITIONS` en `packages/contracts/src/actions.ts` — la máquina de estados como dato.
   La fila `in_progress → awaiting_verification` declara `requires: ['after_evidence']`, y de
   ese dato salen tanto el chequeo del servidor como el selector de evidencia de la web.
2. `transitionRequestSchema` — un `.refine` que rechaza el cuerpo antes de que salga del
   dispositivo.
3. `ActionsService.transition` — el chequeo que traduce el requisito a un error con código.
4. `hs_action_evidence_required()`, constraint trigger DEFERRABLE INITIALLY DEFERRED sobre
   `corrective_action_event`, que levanta `HS006` al commitear.

Las cuatro son la misma regla repetida a propósito: ADR-002 pone la garantía en el motor y
las capas de arriba la adelantan para dar un error legible. Retirarla exige retirar las
cuatro, y dejar una sola en pie sería peor que el estado actual —una compuerta que nadie
declara y que aparece como un error de base de datos.

**Este change toca una tabla inmutable.** `corrective_action_event` y
`corrective_action_evidence` son inmutables por `hs_make_immutable` y están aisladas por
`hs_apply_site_isolation` (ADR-002, ADR-004). La migración **no altera ninguna de las dos
propiedades y no escribe ni borra una sola fila**: elimina un constraint trigger y su
función, que son objetos de esquema, no datos.

## Goals / Non-Goals

**Goals:**

- Que una acción con el trabajo hecho pueda llegar a `awaiting_verification` sin evidencia,
  por el endpoint y por un insert directo, sin ningún camino que la frene.
- Que la evidencia siga siendo lo primero que la interfaz pide al declarar el trabajo hecho.
- Que el alcance vigente quede escrito: ADR-016 y §3 R3 enmendado, para que el documento de
  requisitos y el código no cuenten dos historias.

**Non-Goals:**

- Tocar la otra mitad de R3. El verificador distinto del ejecutor (`not_executor`, `HS005`,
  `verifier_is_executor`) queda entero: es el control de cuatro ojos y no depende de la foto.
- Tocar las reglas de la evidencia que no son la obligación: `object_key` sin bytes (ADR-001),
  prefijo por sitio y por acción (ADR-006), inmutabilidad y aislamiento (ADR-002, ADR-004).
- Reescribir `0011_corrective_actions.sql`. El historial de migraciones es append-only.
- Borrar evidencia ya cargada, o reescribir los eventos de `audit_log` que la registraron.

## Decisions

### Se retira `after_evidence` del vocabulario, no solo de la fila

`TRANSITION_REQUIREMENTS` queda en `['not_executor', 'reason']`. La alternativa —conservar el
miembro y sacarlo solo de la fila— deja un requisito que ninguna transición pide y que la web
puede seguir consultando: un `requires.includes('after_evidence')` que siempre da `false` es
código que parece vivo y no lo está. Si mañana vuelve la obligación, vuelve con su fila.

Consecuencia inmediata en la web, y es la razón por la que se toca `ActionProgressPanel`: el
selector de evidencia se dibuja hoy porque una transición lo **exige**. Sin el requisito
desaparecería justo donde más se lo quiere. Pasa a condicionarse en que exista una transición
hacia `awaiting_verification` — que es lo que la pantalla realmente quiere preguntar: «¿se
puede declarar el trabajo hecho desde acá?».

### La migración elimina el trigger, no lo reescribe como advertencia

Una función que registrara la ausencia de evidencia en vez de rechazarla suena a lo mejor de
los dos mundos y no lo es: la información ya está —el evento no tiene filas de evidencia, y
eso se consulta— y un trigger que escribe en cada completado agrega una escritura a la
transacción de ingesta de todas las acciones para no decir nada nuevo. `DROP TRIGGER` y `DROP
FUNCTION`, en ese orden, y nada más.

`corrective_action_evidence_key_uq`, el índice por `event_id`, el trigger de auditoría
`corrective_action_evidence_audit` y la política de sitio **no se tocan**.

### El código de error `evidence_required` desaparece del contrato de errores

La alternativa era conservarlo por compatibilidad. No hay con qué ser compatible: una acción
correctiva se ejecuta online (design D15), no hay outbox que reintente con un cuerpo viejo, y
ningún cliente lee ese código para decidir nada. Conservarlo dejaría un código que el servidor
no puede emitir. Se va con él el `case 'HS006'` del mapeo de `DatabaseError`; el SQLSTATE
queda libre y el comentario de cabecera de `0011` no se reescribe —es historia—, pero el
docblock de `actions.service.ts`, que enumera lo que el motor garantiza hoy, sí.

### La decisión se registra en un ADR

Precedente directo: ADR-013, ADR-014 y ADR-015 registraron retiradas de alcance —reportes de
cumplimiento, clasificación de riesgo, recurrencia—. Esta es del mismo tipo y con más razón,
porque lo que se retira es una garantía del motor sobre un registro que se defiende ante un
regulador. ADR-016 la escribe una vez y el resto la cita por número.

## Risks / Trade-offs

- **Acciones que se cierran sin ninguna prueba de que el trabajo se hizo.** → Es el costo
  aceptado y la razón por la que existe ADR-016. Lo que lo compensa no es una compuerta sino
  las dos cosas que quedan en pie: el verificador es una persona distinta del ejecutor, y
  cada transición es un evento append-only con su actor y su instante. Quien cierra sin mirar
  queda registrado cerrando sin mirar.
- **La interfaz deja de pedir la foto y la práctica se pierde.** → El selector de evidencia
  se sigue mostrando en el mismo lugar y primero; lo único que cambia es que el botón no
  espera por él. `EvidencePicker` deja de prometer «Required to complete the work», que a
  partir de este change sería falso.
- **Un despliegue a mitad de camino: contrato nuevo contra base vieja.** → El orden lo
  resuelve solo. La migración se aplica antes de que el código nuevo sirva tráfico, y en el
  intervalo inverso —base nueva, código viejo— el código viejo sigue exigiendo evidencia por
  su cuenta, que es el comportamiento anterior. Ninguna combinación produce un error opaco.
- **Un test de integración que pasaba por la razón equivocada.** → Los dos casos de la
  compuerta se retiran y se reemplazan por su contrario explícito —el completado sin
  evidencia commitea y llega a `awaiting_verification`—, para que la ausencia de la
  constraint quede bajo prueba en vez de quedar sin comprobar.

## Migration Plan

1. `apps/api/drizzle/0039_optional_completion_evidence.sql` con su entrada en el journal,
   posterior a `0038`: `DROP TRIGGER corrective_action_evidence_required ON
   corrective_action_event` y `DROP FUNCTION hs_action_evidence_required()`. Sin `GRANT`,
   sin `REVOKE` y sin política nueva — la cabecera del archivo lo dice explícitamente, porque
   una migración sobre una tabla inmutable que no declara por qué no toca permisos es una que
   nadie puede revisar.
2. Contratos, servicio y errores en el mismo commit que la migración: el contrato sin la
   compuerta contra una base que todavía la tiene devolvería `HS006` sin traducción.
3. Web y textos.
4. ADR-016, `docs/adr/README.md` y §3 R3 de `docs/Requisitos_V1.2.md`.

**Rollback**: recrear la función y el constraint trigger tal como están en `0011` mediante una
migración forward. No hay datos que revertir; las acciones que hayan llegado a
`awaiting_verification` sin evidencia quedan donde están —la constraint es `AFTER INSERT` y
no se evalúa sobre filas existentes— y seguirían su ciclo con normalidad.
