# ADR-016 — Evidencia de cierre opcional

|                             |                                                                 |
| --------------------------- | --------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                        |
| **Fecha**                   | 2026-08-29                                                      |
| **Supersede**               | —                                                               |
| **Superada por**            | —                                                               |
| **Referencias**             | `docs/Requisitos_V1.2.md` §3 R3, §7 etapa 5; ADR-001, ADR-002, ADR-004, ADR-006 |
| **Changes que la consumen** | `evidencia-de-cierre-opcional`                                  |

## Contexto

R3 exigía evidencia antes/después para declarar terminado el trabajo de una acción
correctiva. La obligación estaba repetida en cuatro capas: la fila de la máquina de estados,
el esquema del request, el servicio HTTP y el constraint trigger diferido de la base. Esa
defensa impedía que un arreglo realmente terminado llegara a _esperando verificación_ cuando
no había una fotografía disponible y mantenía el escalamiento ligado a una limitación de la
cámara, no a la persistencia del peligro.

La evidencia sigue aportando contexto útil, pero no todos los trabajos terminados se pueden
representar con una fotografía. El control de cuatro ojos de R3 no depende de ella: una
persona distinta de quien declaró terminado el trabajo todavía debe verificarlo y cerrarlo.

## Decisión

La evidencia deja de ser condición para pasar de `in_progress` a
`awaiting_verification`. Se retiran juntas las cuatro capas de la compuerta:

- el requisito `after_evidence` de la máquina de estados;
- el rechazo del request sin evidencia `after`;
- el rechazo equivalente del servicio y su código de error;
- el trigger diferido y la función que impedían el commit sin evidencia `after`.

El sistema sigue pidiendo evidencia antes/después, aceptándola en cualquier evento y
conservándola de forma append-only. Se mantienen enteras las garantías que no dependen de su
obligatoriedad:

- el verificador debe ser distinto de quien declaró terminado el trabajo;
- cada archivo viaja como `object_key`, nunca como bytes (ADR-001);
- la key debe pertenecer al prefijo del sitio y de la acción (ADR-006);
- los eventos y la evidencia conservan la inmutabilidad de ADR-002 y el aislamiento por sitio
  de ADR-004.

La migración solo elimina objetos de esquema de la compuerta. No escribe ni borra filas, no
altera permisos ni políticas RLS y no modifica evidencia ni auditoría ya registradas.

## Consecuencias

- Una acción puede llegar a _esperando verificación_ sin evidencia.
- La interfaz sigue ofreciendo primero la carga de fotografías, pero el envío no depende de
  ella.
- Se acepta que una acción pueda cerrarse sin prueba fotográfica. El costo queda mitigado por
  el verificador distinto del ejecutor y por el registro append-only del actor y el instante de
  cada transición.
- El plazo, los escalamientos de +3 y +7 días y la máquina de estados no cambian.
- La evidencia existente conserva su inmutabilidad, aislamiento, prefijo y auditoría.
