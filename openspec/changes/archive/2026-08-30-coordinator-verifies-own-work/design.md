## Context

Ver `proposal.md` — Why. Lo que condiciona el diseño es dónde está escrita hoy la regla de R3,
que son tres lugares y no uno:

1. `TRANSITIONS` en `packages/contracts/src/actions.ts` — las dos transiciones desde
   `awaiting_verification` llevan `requires: ['not_executor']`. Es la tabla que la web consulta
   para dibujar botones y que el servicio consulta para autorizar.
2. `ActionsService.transition` — resuelve `lastExecutor(client, actionId)` y compara contra
   `session.userId` antes de insertar, para no depender de traducir un error de trigger en el
   camino normal.
3. `hs_action_verifier_guard`, migración `0011_corrective_actions.sql`, SQLSTATE `HS005` — la
   guarda del motor, que es la que hace que la regla valga también para un INSERT directo.

La comparación es contra el `actor_user_id` del evento que movió la acción a
`awaiting_verification`, **no** contra `assignee_person_id`, y el comentario de 0011 explica por
qué: el ejecutor real es quien declaró el trabajo hecho, que puede ser el coordinador actuando
en nombre de una persona del roster sin cuenta. Esa decisión no se toca; lo único que cambia es
que ese mismo caso —el coordinador— deja de ser el que la regla quería atrapar.

ADR-002 y ADR-004 fijan que la inmutabilidad y las reglas duras las fuerza el motor. Una
excepción implementada solo en NestJS dejaría la guarda del motor contradiciendo al endpoint:
el servicio aceptaría y el trigger rechazaría con `HS005`, y el coordinador seguiría sin poder
cerrar. La excepción tiene que estar en los tres lugares o en ninguno.

## Goals / Non-Goals

**Goals:**

- Que la excepción viva en el motor, leída del rol real de la cuenta, y que el servicio la
  duplique solo para dar un error legible en el camino normal — la misma relación que ya existe
  hoy entre el chequeo previo y `HS005`.
- Que `supervisor` y `management` sigan bloqueados por el mismo camino y con el mismo código.
- Que la regla siga siendo una sola verdad consultable: la tabla `TRANSITIONS` sigue siendo el
  único lugar donde se lee "esta transición exige no ser el ejecutor".

**Non-Goals:**

- No se toca `assignee`, ni quién puede pedir cada transición (los `roles` de `TRANSITIONS`
  quedan idénticos), ni la evidencia, ni los escalamientos a +3 y +7 días.
- No se agrega una segunda firma ni un registro de "verificación auto-servida": está fuera de
  alcance en v1 (`openspec/config.yaml`), y el evento ya nombra al actor, que es el registro.
- No se toca la creación de la acción (ADR-017) ni la enmienda del compromiso (ADR-018).

## Decisions

### D1 — La excepción se resuelve por rol de la cuenta, en el trigger, leyendo `app_user`

`hs_action_verifier_guard` pasa a hacer dos lecturas: el `actor_user_id` del último evento a
`awaiting_verification` (como hoy) y el `role` de `app_user` del actor entrante. Solo levanta
`HS005` si coinciden **y** el rol no es `hs_coordinator`.

Se puede: `app_user` no lleva RLS (comentario de `0005_identity.sql`, línea 502) y `hs_app`
tiene `SELECT` sobre ella, así que la función no necesita `SECURITY DEFINER` — sigue corriendo
como el invocador, igual que las otras guardas de 0011.

Alternativa descartada: **pasar el rol en el evento**, como columna o como parámetro de sesión.
Sería un dato que el llamador puede mentir, y una guarda del motor que confía en lo que le
pasan no es una guarda. Otra alternativa descartada: **quitar el trigger y dejar la regla en el
servicio**. Rompe el escenario "The rule holds for a direct insert too", que no es decorativo:
es lo que hace que el registro se pueda defender sin auditar el código de la aplicación.

### D2 — `not_executor` conserva el nombre y cambia de significado documentado

No se agrega un requisito nuevo (`not_executor_unless_coordinator`) ni se parte en dos filas la
tabla. La condición sigue siendo una sola —"el actor no puede ser quien declaró el trabajo
hecho"— y la excepción es sobre quién la sufre, que es exactamente la clase de detalle que
`TRANSITIONS` ya delega en el servicio para `ASSIGNEE` (la fila dice `assignee`; quién es se
resuelve contra `app_user.person_id`). Un requisito nuevo obligaría a que la web decidiera cuál
de los dos aplica, y la web no evalúa `not_executor` en absoluto: `canAttempt` solo mira roles y
`assignee`, y el comentario de `apps/web/src/permissions/actions.ts` dice por qué —media regla
copiada al cliente es una que puede separarse de su otra mitad—. Esa decisión se conserva tal
cual: el botón se sigue ofreciendo y el servidor sigue respondiendo `verifier_is_executor` a
quien todavía lo tiene prohibido.

Lo que sí cambia en la web es el texto de `REQUIREMENT_LABELS.not_executor` en
`InspectionFindingsRoute/presentation.ts`, que hoy afirma sin condición "A verifier other than
the person who declared the work done must submit it" bajo *Next step*. Pasa a nombrar la
excepción, porque es la frase que el coordinador lee justo antes de pulsar.

### D3 — El chequeo del servicio se adelanta al trigger, sin volverse la única verdad

`ActionsService.transition` ya tiene la sesión, y la sesión ya trae `role`: la condición pasa de
`executor === session.userId` a `executor === session.userId && session.role !== 'hs_coordinator'`.
No hace falta ninguna consulta nueva. Sigue siendo un adelanto del error para no traducir
`HS005`, no la autorización.

### D4 — Migración nueva con `CREATE OR REPLACE FUNCTION`, sin tocar tablas

**Este change NO altera ninguna tabla inmutable.** Reemplaza el cuerpo de una función y nada
más: ni `ALTER TABLE`, ni GRANT nuevo, ni política RLS. El trigger
`corrective_action_event_verifier_guard` sigue apuntando a la misma función y no se recrea.
`0011_corrective_actions.sql` no se edita —una migración aplicada no se reescribe— y el archivo
nuevo cita el número de la que enmienda.

### D5 — La decisión se registra como ADR-019

R3 en `docs/Requisitos_V1.2.md` §3 dice "una persona distinta del ejecutor". No se reescribe: la
convención de `docs/adr/README.md` es que una opinión que cambia se escribe en un ADR nuevo.
ADR-019 cita R3 §3, ADR-002 y ADR-004 (por qué la excepción va en el motor) y ADR-017 (por qué
el coordinador es quien declara el trabajo hecho de una persona sin cuenta). No supersede a
ninguno: ADR-016, 017 y 018 tocan otras piezas del mismo ciclo y siguen vigentes.

## Risks / Trade-offs

- **El control de cuatro ojos deja de existir para el rol que más acciones cierra** → Es la
  decisión pedida, y lo que la hace defendible es que el registro no se pierde: el evento de
  completado y el de cierre nombran al actor y quedan append-only, así que una auditoría puede
  listar exactamente qué acciones cerró la misma cuenta que las declaró hechas. La excepción es
  por rol y está en un solo `IF` del trigger, legible en el esquema.
- **Un segundo coordinador en el futuro hereda la excepción sin decisión nueva** → Aceptado. Con
  dos coordinadores el par de ojos vuelve a existir de hecho, y la regla como está no les
  impide usarlo; si se quisiera obligar, es un ADR nuevo, no un caso especial escondido acá.
- **Un `hs_coordinator` dado de baja o degradado** → El trigger lee el rol vigente al momento
  del INSERT, no el que tenía cuando declaró el trabajo hecho. Es lo correcto: la autorización
  siempre es sobre quien actúa ahora, y es la misma lectura que hace `requireActor`.
- **Los tests de integración que hoy prueban la regla usan al coordinador como ejecutor** →
  Cuatro casos (`corrective-actions.int-spec.ts` ×3, `incidents.int-spec.ts` ×1) hay que
  releerlos uno por uno: los que quieran seguir probando la regla pasan a un `supervisor`, y se
  agrega el caso positivo del coordinador. Un test que se "arregla" borrándolo deja la regla
  restante sin cobertura.

## Migration Plan

1. La migración es `CREATE OR REPLACE FUNCTION` sobre una función existente: se aplica en
   caliente, sin bloquear la tabla más que el tiempo del reemplazo, y no reescribe filas.
2. No hay backfill ni ventana de incompatibilidad: el código viejo con la función nueva sigue
   siendo correcto (el servicio simplemente rechaza antes lo que el motor ya no rechazaría), y
   el código nuevo con la función vieja fallaría con `HS005` — así que el orden es **migración
   primero, despliegue después**, que es el orden normal del repo.
3. Rollback: una migración inversa con el cuerpo original de `hs_action_verifier_guard`, tal
   como está en `0011_corrective_actions.sql`. No hay datos que revertir; las acciones que el
   coordinador haya cerrado en el ínterin siguen cerradas y sus eventos siguen siendo válidos.
