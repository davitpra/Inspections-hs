## Why

El roster solo se puede poblar aplicando un archivo entero. Alguien que entró ayer no existe
para el sistema hasta que RR.HH. exporte el próximo CSV de ADP y el coordinador lo suba: hasta
ese día esa persona no aparece en ningún selector de sujeto, no se le puede asignar una
inspección, y no se la puede invitar al JHSC. El remedio actual es pedirle a otra área un
archivo, para agregar una fila.

Es la única alta del sistema que no se puede hacer desde la pantalla en la que se ve el
problema. Y no es un olvido: la consola se escribió deliberadamente sin escritura por persona
—`roster.service.ts` lo dice— dejando anotada la pregunta que faltaba contestar: *qué gana
cuando el siguiente CSV pise el cambio hecho a mano*. Este change la contesta y abre el alta,
sin abrir nada más.

Cierra el hueco que quedó de la **etapa 2** de `docs/Requisitos_V1.2.md` §7 —«Sitio, Persona,
Usuario, auth, importación CSV del roster»—: la importación ya tiene superficie HTTP, pero
sigue siendo la única forma de que una persona exista.

## What Changes

- Exponer el alta de UNA persona como `POST /people`, reservado al rol `hs_coordinator`:
  `employee_number`, `first_name`, `last_name` y el `site_id` de la planta que la pantalla
  está mirando. Devuelve la persona creada.
- Rechazar el alta cuyo `employee_number` ya existe, **sin decir dónde existe**. La unicidad
  del número es global y `person` lleva RLS por sitio, así que el conflicto puede ser contra
  alguien de una planta que quien pide el alta no administra; decir cuál de los dos casos es
  filtraría la existencia de esa persona. Mismo criterio que el `unknown or out-of-scope
  site_code` del importador.
- Rechazar el alta cuyo `site_id` no está en el alcance de la sesión. Acá el chequeo es
  explícito y no se delega en RLS: un INSERT que viola la política es un error del motor, y la
  respuesta correcta a un pedido mal dirigido no es un 500.
- Fijar que **el CSV manda**: el alta manual solo CREA la fila; cuando una importación
  posterior traiga ese mismo `employee_number`, el importador la actualiza como a cualquier
  otra. El alta a mano es un adelanto del archivo, no una excepción a él.
- Añadir a la consola del roster un diálogo «Add person» desde el encabezado de la ruta, sobre
  la planta que el selector ya muestra, y reescribir el aviso que hoy manda al coordinador al
  CSV como si fuera la única forma de meter gente en la lista.

Fuera de alcance, explícito: corregir un nombre, transferir de planta o dar de baja a una
persona desde la pantalla —el archivo sigue siendo el único que modifica una fila existente—;
crear la cuenta en el mismo acto que la persona (para eso ya está «Invite to JHSC», y Persona ≠
Usuario); y cualquier conexión con ADP.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `identity` — la consola del roster deja de prohibir toda escritura fila por fila sobre
  `person` para prohibir solo la MODIFICACIÓN fila por fila: el alta de una persona pasa a
  estar disponible para el `hs_coordinator` sobre un sitio de su alcance, con el número de
  empleado único y no divulgante, y con la regla de precedencia frente a la importación
  escrita en la spec.

## Impact

- **Sin migración.** `person` ya existe con su `UNIQUE (employee_number)`, su política
  `hs_apply_site_isolation` y el `GRANT SELECT, INSERT ON person TO hs_app` de
  `0005_identity.sql`. Ninguna tabla inmutable cambia de forma y no se concede ningún
  privilegio nuevo.
- **Sin auditoría nueva.** El trigger `person_audit` ya escribe `person.created` en
  `audit_log` en cada INSERT: el alta manual queda auditada por el motor, igual que la del
  importador, sin que el endpoint escriba nada.
- `packages/contracts` — un `createPersonRequestSchema` que reusa `employeeNumberSchema` y
  `nameSchema`; la respuesta es el `personSchema` que ya existe.
- `apps/api/src/roster/` — un `POST` en el controlador, un método en el servicio, un
  `insertPerson` en el repositorio (que NO reusa el `upsertPerson` del importador: aquel
  actualiza al chocar, que es justo lo que el alta no debe hacer) y dos códigos de error
  nuevos.
- `apps/web` — `api/roster.ts` gana su primera escritura sobre una persona,
  `permissions/session.ts` un predicado, y `routes/RosterRoute/` el diálogo y su disparador.
  Varios docblocks de las dos apps afirman hoy que no existe ninguna escritura por persona y
  dejan de ser ciertos.
