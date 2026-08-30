## Why

La pantalla ya presenta cinco etapas para un hallazgo, pero hoy las calcula en el cliente desde
la lista de acciones correctivas. Esa proyección no deja un registro auditable de cuándo cambió
el hallazgo, puede quedar desactualizada en cualquier caché que no tenga la lista de acciones y
obliga a cada consumidor a reconstruir una regla que pertenece al registro regulatorio.

Este change **no cierra una etapa nueva de requisitos-v1.2 §7**: completa la lectura conjunta de
las etapas 4 y 5 haciendo que el hallazgo tenga su propio ciclo auditable, sin introducir una
columna mutable. El estado sigue la disciplina de ADR-002 y ADR-004: la fuente de verdad es un
stream inmutable y el valor actual es su último evento.

## What Changes

- Cada hallazgo tiene uno de cinco estados: `raised`, `assigned`, `in_progress`,
  `verification` o `closed`. El estado vive exclusivamente en el stream append-only
  `finding_state_event`; `finding` no recibe una columna de estado mutable.
- Todo hallazgo recibe atómicamente un evento inicial `raised`. La base de datos añade un evento
  de estado, en la misma transacción, después de cada evento de acción correctiva que cambie el
  estado agregado del hallazgo.
- El estado agregado se calcula por la acción menos avanzada: ninguna acción es `raised`;
  `open` corresponde a `assigned`, `in_progress` a `in_progress`,
  `awaiting_verification` a `verification`, y solo todas las acciones en `closed` producen
  `closed`.
- Rechazar una verificación devuelve el hallazgo a `in_progress` cuando esa acción determina el
  agregado. Crear una acción nueva puede hacer regresar incluso un hallazgo `closed`; cerrar una
  acción no hace terminal al hallazgo para futuras acciones.
- Crear una acción escribe DOS eventos en la misma transacción —`open` y `open → in_progress`—,
  con el mismo actor y el mismo instante: nombrar al responsable es poner el trabajo en marcha.
  El hallazgo atraviesa `assigned` y queda en `in_progress`, y la interfaz deja de ofrecer un
  paso intermedio que no decidía nada. `open` sigue en la máquina para las acciones abiertas
  antes de este change, que se siguen empezando a mano.
- El contrato `Finding` y todas las lecturas de hallazgos incluyen `state`, obtenido del último
  `finding_state_event`. La API no acepta que el cliente escriba ese estado.
- La interfaz conserva el indicador de cinco etapas y el próximo paso único, pero lee
  `finding.state` en lugar de proyectarlo desde las acciones. Después de crear o avanzar una
  acción invalida tanto las cachés de acciones como las lecturas de hallazgos e inspecciones que
  contienen el estado.
- La migración manual `0040` crea el stream, reconstruye el historial necesario para los datos
  existentes, instala derivación transaccional, auditoría, REVOKE, RLS e inmutabilidad forzada
  por el motor.

El mock sigue sin añadir clasificación de riesgo, tipos de acción, recordatorios, extensiones ni
una segunda historia de acciones: esos elementos continúan fuera del alcance de este change.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `findings`: el ciclo de cinco estados pasa de una proyección efímera de la interfaz a un stream
  de eventos propio, inmutable y auditable; las lecturas exponen el estado vigente y la interfaz
  lo consume sin reconstruirlo.

- `actions`: la máquina de estados y los permisos no cambian, pero la CREACIÓN pasa a escribir
  también el arranque del trabajo, cubierto por la misma autorización. Sus eventos siguen siendo
  la causa que la base de datos usa para derivar el estado del hallazgo.

## Impact

- `packages/contracts`: estados de hallazgo y campo `Finding.state`.
- `apps/api`: esquema Drizzle, migración `0040`, `ActionsService.createForParent`, repositorios y
  respuestas de hallazgos e inspecciones, triggers de auditoría, datos de demo y pruebas de
  integración.
- `apps/web`: `InspectionFindingsRoute`, lista de hallazgos, presentación y estrategia de
  invalidación de TanStack Query.
- Base de datos: nueva tabla inmutable `finding_state_event`, RLS por sitio, backfill y triggers
  que escriben eventos iniciales y derivados dentro de la transacción causal.
- `packages/forms` no cambia. Se mantienen ADR-001, ADR-002, ADR-004, ADR-008, ADR-012 y ADR-017.
