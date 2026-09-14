# ADR-019 — El coordinador de H&S verifica lo que él mismo declaró hecho

|                             |                                                                        |
| --------------------------- | ---------------------------------------------------------------------- |
| **Estado**                  | Superada                                                               |
| **Fecha**                   | 2026-08-30                                                             |
| **Supersede**               | —                                                                      |
| **Superada por**            | ADR-025 (parcial: la excepción se extiende a management)              |
| **Referencias**             | `docs/Requisitos_V1.2.md` §3 R3, §4 roles, §7 etapa 5; ADR-002, ADR-004, ADR-016, ADR-017 |
| **Changes que la consumen** | `coordinator-verifies-own-work`                                        |

## Contexto

R3 pide que "una persona distinta del ejecutor" verifique y cierre la acción correctiva. El
control se implementó sin excepción por rol y contra el dato correcto: el `actor_user_id` del
evento que movió la acción a `awaiting_verification`, no `assignee_person_id`. La diferencia era
deliberada — el ejecutor real es quien declaró el trabajo hecho, y puede ser el coordinador
actuando en nombre de una persona del roster sin cuenta.

Esa misma precisión es la que deja al coordinador sin salida. La operación tiene **un** rol
`hs_coordinator` sobre dos sitios, y es la única cuenta que puede declarar trabajo hecho por una
persona sin usuario. Cada vez que lo hace, la acción queda retenida en `awaiting_verification`
esperando a un `supervisor` o a `management` que no participó del trabajo, no lo vio y no tiene
nada que aportar a la verificación. El resultado no es un segundo par de ojos: es trabajo
terminado que el registro muestra como pendiente, que es lo contrario de lo que R3 persigue.

El control de cuatro ojos vale donde hay dos pares. Escrito como universal, para este rol no
protege nada y sí produce un registro que dice algo falso sobre el estado de la planta.

## Decisión

El control de cuatro ojos de R3 **conserva su fuerza para `supervisor` y `management`** y **deja
de aplicar cuando la cuenta que verifica tiene rol `hs_coordinator`**. Un coordinador puede
cerrar (`awaiting_verification → closed`) y puede rechazar la verificación
(`awaiting_verification → in_progress`, con `reason`) aunque sea el actor del evento de
completado.

**La excepción vive en el motor.** La guarda `hs_action_verifier_guard` — SQLSTATE `HS005`,
migración 0011 — se reescribe para leer el rol vigente del actor en `app_user` y levantar el
error solo si el rol todavía carga la regla. No se elimina el trigger: ADR-002 y ADR-004 fijan
que una regla dura la fuerza el motor, y una excepción implementada solo en NestJS dejaría al
endpoint aceptando lo que el trigger rechaza. El rol se lee de la tabla, nunca de un valor que
venga con el evento: una guarda que confía en lo que le pasan no es una guarda.

El chequeo previo de `ActionsService.transition` incorpora la misma condición, y sigue siendo lo
que era — un adelanto para no traducir un error de trigger en el camino normal, no la
autorización.

**Lo que no cambia.** La comparación sigue siendo contra el `actor_user_id` del evento de
completado. Los `roles` de las dos transiciones de `TRANSITIONS` quedan idénticos. El `reason`
sigue siendo obligatorio al rechazar y sigue sin pedirse al cerrar. Los escalamientos de +3 y +7
días no se tocan. La evidencia sigue siendo opcional (ADR-016) y quién abre la acción sigue
siendo lo que fijó ADR-017.

## Consecuencias

- El rol que más acciones cierra deja de tener un verificador independiente. Lo que hace la
  decisión defendible es que **el registro no se pierde**: el evento de completado y el de
  cierre nombran cada uno a su actor y son append-only, así que una auditoría puede listar
  exactamente qué acciones cerró la misma cuenta que las declaró hechas. La excepción es por rol
  y está en un solo `IF` del esquema, legible sin leer la aplicación.
- El rol se evalúa al momento del INSERT, no al momento en que se declaró el trabajo hecho. Un
  coordinador degradado deja de tener la excepción; es la misma lectura que hace `requireActor`,
  y la autorización siempre es sobre quien actúa ahora.
- Un segundo coordinador en el futuro hereda la excepción sin decisión nueva. Con dos cuentas el
  par de ojos vuelve a existir de hecho y la regla no impide usarlo; obligarlo sería un ADR
  nuevo, no un caso especial escondido en el trigger.
- `openspec/specs/actions/spec.md` — el requisito "The verifier is never the person who declared
  the work done" se reemplaza por "The verifier is someone other than the executor, unless they
  are the HS coordinator", con los escenarios de ambos lados y del INSERT directo.
- La web no cambia de comportamiento: `canAttempt` nunca evaluó `not_executor` — media regla
  copiada al cliente se separa de su otra mitad — y el servidor sigue respondiendo
  `verifier_is_executor` a quien todavía la tiene prohibida. Solo cambia el texto que la ficha
  del hallazgo muestra bajo *Next step*, que afirmaba la regla sin condición.
