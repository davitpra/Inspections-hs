## Context

Ver `proposal.md` — Why. Lo que condiciona el diseño es que la regla que falta ya tiene un
antecesor exacto en el código: `requireActor` en `ActionsService.transition` no comprueba
"este rol puede avanzar acciones", comprueba "esta cuenta es la responsable de ESTA acción"
resolviendo `app_user.person_id` contra `assignee_person_id`. La creación necesita la misma
forma de regla, contra otra columna: `finding.reported_by` en vez de
`corrective_action.assignee_person_id`.

`finding.reported_by` ya existe y ya es una CUENTA (`app_user.id`), no una persona del
roster: en un hallazgo derivado es `inspection.submitted_by`, que la ingesta fija a quien
firmó el envío; en uno manual es `session.userId` en el momento de `FindingsService.report`.
No hace falta ninguna columna nueva ni ningún cambio de contrato.

**Este change no toca ninguna tabla.** No hay migración: la única superficie nueva es un
`GET` de lectura (`/findings/:id/roster`), espejo de uno que ya existe para inspecciones.

## Goals / Non-Goals

**Goals:**

- Que abrir una acción sobre un hallazgo deje de depender de un tercero cuando quien lo vio
  tiene todo lo que la decisión necesita.
- Que la regla sea la MISMA clase de comprobación que ya usa `requireActor`: una relación con
  el registro puntual, verificable contra la sesión, nunca un rol ancho nuevo.
- Que el selector de responsable no filtre el perfil completo a quien antes no lo veía.

**Non-Goals:**

- Extender el permiso a la creación sobre una investigación. No tiene reportante: la reporta
  un supervisor y la investiga el coordinador.
- Tocar cualquier otra transición del ciclo de vida. Empezar, declarar hecho y verificar
  siguen exactamente con las reglas de R3.
- Reabrir la posibilidad de una segunda acción antes de que `ciclo-de-vida-del-hallazgo`
  la ofrezca: el control de creación sigue apareciendo solo cuando el hallazgo no tiene
  ninguna acción.
- Cambiar qué ve `GET /people`. Sigue siendo del coordinador con el perfil completo; este
  change no amplía esa ruta, agrega una distinta con menos columnas.

## Decisions

### La regla es sobre el HALLAZGO, no sobre el rol de quien reporta

La alternativa más simple —agregar `jhsc_member` a la lista de roles que pueden crear— abre
la creación sobre CUALQUIER hallazgo del sitio, incluidos los que levantó otro inspector.
Eso no es lo que el problema pide (un inspector actuando sobre lo que ÉL vio) y contradice
más ampliamente el requisito existente de que «a `jhsc_member` SHALL be refused every
write» fuera de la relación puntual que ya tiene sobre sus propias acciones. La regla
correcta compara `session.userId` contra `finding.reported_by`, exactamente como
`requireActor` compara contra `assignee_person_id`. Un `jhsc_member` que no reportó el
hallazgo sigue sin poder escribir nada sobre él.

### El hallazgo se resuelve antes de comprobar el permiso

`create()` hoy comprueba el rol antes de tocar la base. Con la regla nueva eso invertiría la
respuesta que el resto del servicio ya eligió: un hallazgo de otra planta, para una sesión
sin ese permiso, debería seguir respondiendo "no existe" y no "no podés" — la misma razón
por la que `actionNotFound()` ya unifica "no existe" y "es de la otra planta" en el resto del
servicio (§6 pregunta 5). Se resuelve el hallazgo primero (una consulta que la política RLS
ya recorta) y recién con `{siteId, reportedBy}` en mano se decide el permiso.

### `createForInvestigation` no se toca

Comparte `createForParent` con `create`, pero la guarda de entrada es distinta a propósito:
una investigación no tiene un campo equivalente a `reported_by` — la reporta un supervisor
(`incident.reported_by`) y la INVESTIGA el coordinador, que es un acto distinto de reportar
el incidente. No hay cuenta candidata a la que extenderle el permiso sin inventar una regla
que §4 no pide. Queda comentado en el código para que la próxima persona que lea las dos
funciones lado a lado no asuma que es una omisión.

### El selector de responsable es una ruta nueva, no una ampliación de `/people`

`/people` comprueba el rol también en la LECTURA porque devuelve el perfil completo — seis
columnas, incluida la cuenta de cada persona — y §4 es explícito: se elige a una persona sin
poder ver su perfil. Abrir esa ruta a más roles pondría el perfil completo al alcance de
alguien que hoy no lo tiene, que es exactamente el desvío que el requisito de `incidents`
"The subject and the witnesses are chosen without seeing a profile" ya previene para el
selector de sujeto. La respuesta es la misma que ese requisito ya adoptó: una ruta con la
forma `PersonOption` — cuatro columnas, solo activas — colgada del recurso que la necesita.
`GET /scheduled-inspections/:id/roster` es el precedente exacto: incidencia por cuidado, no
por accidente, ambas cuelgan del padre y no del roster general.

Que el coordinador TAMBIÉN pase a usarla (en vez de mantener dos caminos, uno por rol) es la
alternativa más simple y la más segura: un solo `useQuery`, una sola clave de caché, y
ninguna rama de código que distinga "cómo elijo a alguien" según quién mira.

## Risks / Trade-offs

- **`created_by` deja de implicar `hs_coordinator`.** Cualquier lectura futura que asuma "la
  acción la creó el coordinador" porque `created_by` apunta a una cuenta con ese rol deja de
  ser válida. No hay tal lectura hoy: `created_by` se usa solo para auditoría.
- **Superficie nueva, aunque de solo lectura.** Un `GET` más por sitio no cambia el perfil de
  riesgo: el precedente (`/scheduled-inspections/:id/roster`) ya prueba que cuatro columnas
  sin comprobación de rol no filtran nada que `incidents` no filtre ya.

## Migration Plan

Sin datos que migrar. La comprobación de rol de `create()` se reemplaza en el mismo commit
que agrega la relación; no hay estado intermedio en el que ambas reglas convivan porque no
hay flag de features en este proyecto (un desarrollador, sin cohortes de usuarios).

## Open Questions

Ninguna. El diseño reutiliza dos piezas que ya existen (`requireActor` como precedente de la
regla, `rosterPackage` de `inspections` como precedente de la ruta) y no introduce ningún
concepto nuevo.
