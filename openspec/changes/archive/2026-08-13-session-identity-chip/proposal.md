## Why

Una vez autenticado, el sistema no dice en ninguna parte quién está usando el dispositivo.
La barra de navegación tiene los links y un botón "Sign out", y nada más: ni nombre, ni
email, ni el rol con el que se está trabajando.

No es una molestia estética. ADR-001 asume **un dueño, un dispositivo, un firmante**, y el
envío de una inspección es el punto de no retorno. Un teléfono de planta que pasa de turno
en turno deja al inspector sin forma de confirmar que el borrador que tiene delante es el
suyo antes de firmarlo. El sistema conoce la respuesta desde el login y se la guarda.

La causa está en el contrato: la sesión resuelta transporta `user_id`, `person_id`, `role`
y `site_scope` —ids y permisos— y ningún dato con el que se pueda escribir una persona. Y
no hay otra vía: no existe endpoint que exponga una fila de `person` ni de `app_user`, así
que hoy la interfaz solo puede mostrar el rol.

**Etapa de §7: ninguna.** La etapa 2 (Sitio, Persona, Usuario, auth, roster) está cerrada y
este change no la reabre. Existe porque la etapa 3 —la PWA que corre en un dispositivo
compartido y sin señal— convirtió en un hueco algo que en la etapa 2 no se notaba: la
sesión se especificó por lo que **autoriza**, y nunca por lo que **identifica**.

## What Changes

- **La sesión resuelta suma `email` y el nombre de la persona.** El email sale de
  `app_user`; el nombre, de `person`. Van en `sessionSchema`, así que los reciben tanto
  `POST /auth/sign-in` como `GET /auth/session`.
- **Los tres campos son opcionales en el contrato**, y es la decisión más importante del
  change. El cliente guarda la sesión en Dexie y la revalida con el mismo esquema al
  arrancar sin red: una fila escrita por la versión anterior no tiene esas claves, y con
  campos requeridos la validación la rechazaría y mandaría a login a quien está en una
  planta sin señal para dárselo. La compatibilidad hacia atrás acá no es higiene, es no
  perder un recorrido.
- **El nombre es "mejor esfuerzo" y el email no.** `person` está aislada por sitio; si la
  persona vive en una planta fuera del alcance de su cuenta, RLS no la devuelve y la sesión
  sale sin nombre. El cliente cae al email, y sin email al rol.
- **Nuevo `ROLE_LABELS` en contracts**: el término de §4 para cada rol ("JHSC member", y
  nunca `jhsc_member` ni "Inspector"). No es i18n —la UI es solo inglés—, es que el
  vocabulario del dominio se escriba en un solo lugar.
- **La PWA muestra un chip permanente** con el nombre y el rol, junto a "Sign out".

**Sin migración y sin tabla nueva.** `person.first_name`/`last_name` y `app_user.email` ya
existen desde `0005_identity.sql`, con sus `GRANT` puestos. No se toca ninguna tabla
inmutable, ninguna política RLS y ningún privilegio.

**Sin cambios incompatibles.** Los campos nuevos son aditivos y opcionales en las dos
puntas.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `identity`: la requirement **"A session carries the user, the person and the site scope"**
  pasa a exigir también con qué se identifica a quien está adentro. Hoy la spec enumera
  cuatro valores y los cuatro son de autorización; el sistema puede resolver los cuatro y
  seguir sin poder decir quién es. Se agrega el email como parte garantizada de la sesión y
  el nombre como parte de mejor esfuerzo, con el escenario que fija qué pasa cuando la
  persona queda fuera del alcance.

  Se modifica esa requirement en vez de escribir una nueva porque es literalmente sobre
  qué transporta una sesión, y partirla en dos dejaría la respuesta a esa pregunta en dos
  lugares.

## Impact

- **Contracts**: `packages/contracts/src/auth.ts` (`sessionSchema`),
  `packages/contracts/src/identity.ts` (`ROLE_LABELS`).
- **API**: `apps/api/src/auth/session.service.ts` (`SessionContext`, `resolve`,
  `toContractSession`, que pasa a ser async), `auth.service.ts` y `auth.controller.ts` en
  sus dos llamadas.
- **Web**: `apps/web/src/components/AccountChip.tsx` (nuevo), `app/router.tsx`,
  `index.css`.
- **Reusa**: `DbService.withSessionClient` para la lectura bajo alcance —la misma puerta
  que cualquier otra lectura del sistema (ADR-002)— y el `Session` que `session-context.tsx`
  ya expone a toda pantalla.
- **Sin tocar**: esquema, migraciones, RLS, privilegios, `packages/forms`, el service
  worker y el outbox.
- **Riesgo principal**: `person` lleva RLS y la resolución del token corre sin alcance
  declarado. Leer el nombre por el camino equivocado no devuelve un nombre vacío: rompe el
  login entero. El design fija dónde se lee y por qué ahí.
