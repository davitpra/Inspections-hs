## Context

Ver `proposal.md — Why`. Lo que importa acá del estado actual:

- Las tres rutas del paquete de campo cuelgan de `findActiveInspection`, que recorta por
  RLS y nada más (ADR-002). Ninguna sabe de asignación.
- `CaptureRoute` abre el borrador con `openDraft` en cuanto `missingForField` devuelve
  vacío. El id sale de la URL.
- Lo único que el dispositivo tiene sin red sobre la inspección es lo que guardó la
  descarga previa: `prefetch[scheduled_inspection_id + kind]`, con el payload de
  `template_version` llevando ya `site_id` por exactamente esta razón — saber de quién es
  el borrador sin preguntar.
- La comprobación del servidor (`submissions.service.ts`, ADR-008 costura 1) es la que
  garantiza la corrección y no se toca.

Ninguna tabla inmutable se toca: este change no escribe en el esquema. No hay migración
SQL, no hay REVOKE ni RLS nuevos — la única lectura agregada es una columna que ya existe
(`scheduled_inspection.inspector_id`) en una consulta que ya corre bajo la política.

## Goals / Non-Goals

**Goals:**

- Que el "esto no es tuyo" llegue antes del recorrido y no después de firmar.
- Que la comprobación funcione sin red, porque es donde el inspector está.
- Que el trabajo ya capturado sobreviva a una reasignación.

**Non-Goals:**

- Recortar por asignación las rutas del paquete de campo. El coordinador las sigue
  leyendo y el test de las dos plantas sigue valiendo tal cual.
- Reemplazar la comprobación del envío. Esto reduce cuándo se llega a ella, no lo que
  garantiza.
- Descartar el borrador ajeno. Fuera de alcance, decidido.

## Decisions

### D1 — La comprobación vive en el dispositivo, no en el servidor

**Alternativa considerada:** que las tres rutas respondan `forbidden` a quien no es el
inspector asignado. Corta antes —sin descarga no hay captura— y es menos código.

**Por qué no:** la pregunta hay que contestarla en el momento de abrir la captura, y ese
momento es sin red por definición (ADR-001: el offline no es sincronización). Un servidor
que rechaza la descarga no ayuda al dispositivo que descargó cuando la inspección era
suya y fue reasignado después — que es justamente el caso 3 del alcance. Además le
sacaría al coordinador una lectura que hoy tiene y que un test de integración afirma.

La consecuencia aceptada: quien quiera capturar lo ajeno **puede**, tocando la base local
o la URL con la descarga hecha. No es una defensa de seguridad y no pretende serlo — el
límite real lo pone el servidor al recibir el envío. Lo que esto evita es el accidente,
que es el problema que se observó.

### D2 — La asignación viaja en `template-version` y no en una ruta nueva

Es la primera de las tres lecturas, la que ya lleva `site_id` por el mismo motivo, y la
que el dispositivo necesita sí o sí para capturar. Una cuarta ruta rompería "tres
lecturas, cada una nombrable si falta"; meterla en `locations` o `roster` pondría un dato
de la inspección en una respuesta que es un catálogo.

`inspector_id` es requerido en el contrato y `nullable` — el servidor lo manda siempre, y
`null` significa "sin inspector", que es un estado real y refusable, no un dato ausente.

### D3 — Sin migración de Dexie

El payload de `template_version` se guarda entero, como venga: `prefetchInspection` hace
`{ kind, ...parsed }`. Agregar un campo al esquema del contrato lo agrega al payload
guardado sin tocar el esquema de la base. La versión de Dexie no cambia.

### D4 — Un `inspector_id` ausente en lo guardado NO bloquea

Un dispositivo que descargó **antes** de este change tiene el payload sin el campo. Ese
caso se trata como desconocido y **deja capturar**: bloquear ahí le negaría el recorrido a
un inspector legítimo por una descarga vieja, y el que se equivoque igual choca contra el
servidor, que es donde estábamos antes de este change. Por eso el campo es opcional en el
tipo del payload guardado aunque sea requerido en el contrato: los dos tipos describen
cosas distintas —lo que el servidor manda hoy y lo que la base puede tener guardado de
ayer— y confundirlos es lo que haría fallar al inspector equivocado.

### D5 — Firmar se niega contra lo mismo que abrir

La pantalla de revisión compara contra el `inspector_id` del payload guardado, no contra
una lectura fresca: si hubiera red, ya la habría. La reasignación se conoce cuando el
dispositivo vuelve a descargar; hasta entonces el borrador se firma y el servidor lo
rechaza, que es el comportamiento de hoy y el que ADR-001 acepta (se puede perder un
borrador; la corrección la garantiza el servidor).

### D6 — La cola manda solo lo de su dueño

Parte del mismo problema y ya implementado en el working tree: `runOutbox` recorría
`outbox.toArray()` sin mirar de quién era cada entrada, así que la cuenta abierta mandaba
con SU sesión el envío firmado por otra — y el servidor lo rechazaba con `forbidden`
permanente. El dueño es el del borrador (`drafts.account_id`), el mismo criterio que
`listDrafts` y `unsyncedStatus`. Entra en este change porque es la misma requirement de
`offline-capture` y porque sin él, el resto no alcanza: cerrar la puerta de la captura no
vacía las colas que ya quedaron mal.

## Risks / Trade-offs

- **La comprobación es del cliente y el cliente miente** → No es una defensa de
  seguridad. Se declara así en D1 y el servidor sigue siendo el único límite real; el
  test de integración del envío no se toca.
- **Un dispositivo con la descarga vieja no comprueba nada** (D4) → Vuelve al
  comportamiento actual, que es el peor caso conocido, no uno nuevo. Se corrige solo la
  próxima vez que se prepara la inspección.
- **La reasignación conocida tarde deja firmar** (D5) → Es el diseño de ADR-001, no una
  omisión: el rechazo del servidor sigue existiendo, y ahora la entrada rechazada al menos
  no se le manda desde la sesión de otro (D6).
- **`strictObject` en el contrato** → Agregar el campo hace fallar el parseo del cliente
  contra un servidor viejo. En este despliegue —un servidor, una PWA— no hay ventana de
  versiones cruzadas que administrar; el service worker sirve el bundle que se despliega.

## Migration Plan

Nada que migrar: sin cambios de esquema y sin datos que reescribir. Un dispositivo con
descarga previa vieja sigue funcionando (D4) y se pone al día al volver a preparar la
inspección.
