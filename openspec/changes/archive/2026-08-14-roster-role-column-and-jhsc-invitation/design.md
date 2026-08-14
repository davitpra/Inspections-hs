## Context

Ver `proposal.md` — Why. Lo que condiciona el diseño es lo que ya existe:

- `POST /auth/invitations` **ya es HTTP** y ya es solo del coordinador
  (`apps/api/src/auth/auth.controller.ts:88`). Devuelve el token en claro una sola vez.
- El alta de la cuenta existe como comando (`apps/api/scripts/create-account.mjs`) y su
  corrección entera es un orden: los dos INSERT en **la misma** transacción, con
  `app.site_ids` y `app.user_id` declarados, porque `hs_account_audit_fanout()`
  (`0005_identity.sql` §8) está diferido a `COMMIT` para encontrar el alcance otorgado.
- `asAdministrator()` (`apps/api/src/auth/account-scope.ts`) es el único lugar donde ese
  alcance se declara, y declara el del **actor**: eso convierte `HS002` en la verificación
  de permisos, sin un `if` que se pueda olvidar.
- `person` está aislada por RLS; `app_user` y `user_site_scope` no.

**Ninguna tabla inmutable se toca.** No hay migración: `app_user`, `user_site_scope` y
`user_invitation` ya existen con sus `GRANT` y sus políticas (0005). ADR-011 (alta por
invitación, sin auto-registro, sin correo transaccional), ADR-002/ADR-004 (RLS y
`deactivated_at`) y ADR-008 (dependencias en una dirección) se citan, no se reescriben.

## Goals / Non-Goals

**Goals:**

- Que el coordinador vea, en la fila de cada persona, si esa persona alcanza el sistema y
  como qué.
- Que invitar a un miembro del JHSC sea un gesto en esa fila, con el mismo rastro de
  auditoría que hoy deja el comando.
- Que el orden de la transacción del comando —lo único que hace correcta el alta— quede
  escrito una vez y compartido, no copiado a un servicio nuevo.

**Non-Goals:**

- Editar, desactivar o cambiarle el rol o el alcance a una cuenta existente desde la
  pantalla. La consola sigue mostrando; lo único que ahora también hace es dar de alta.
- Los otros cuatro roles. `external_auditor` ni siquiera es alcanzable: su `CHECK` exige
  `expires_at`, `records_from` y `records_to` coherentes.
- Correo. El token se copia a mano, como ya lo hace `auth:bootstrap` (ADR-011, design D9).
- Tocar `person`. La consola del roster sigue sin poder escribirla.

## Decisions

### D1 — La cuenta viaja dentro de la fila de `GET /people`, no en un segundo endpoint

Alternativa considerada: `GET /accounts?site_id=…` y unir las dos listas en el cliente.

Se descarta porque la unión en el cliente inventa un estado que el servidor ya sabe: con dos
respuestas, una fila puede quedar "sin cuenta" solo porque la segunda consulta todavía no
volvió, y el botón de invitar aparecería sobre alguien que ya tiene cuenta. La respuesta del
roster está acotada a **una planta**, que es lo que sostiene no paginar; el `LEFT JOIN` no
cambia ese orden de magnitud.

### D2 — De la cuenta viaja lo mínimo para decidir: `id`, `role`, `active`, `can_sign_in`

Ni email, ni alcance, ni credencial, ni token. La pantalla contesta dos preguntas —¿alcanza
el sistema? ¿como qué?— y todo lo demás sería el `app_user` completo colgado de una lectura
del roster.

`can_sign_in` lo calcula el servidor (existe `app_credential` activa) y no el cliente: el
cliente no ve credenciales y no debe verlas. Es también el dato que distingue "invitada" de
"entrando", que es lo que le dice al coordinador si tiene que reenviar el link.

### D3 — `POST /accounts` corre dentro de `asAdministrator`, y de ahí sale su permiso

El rol del actor se comprueba explícitamente (`hs_coordinator`, como
`InvitationService.issue`) porque es una regla de la ruta. El **alcance** no se comprueba en
el servicio: la transacción declara el alcance del actor y `hs_account_audit_fanout()` frena
con `HS002` si la cuenta nueva alcanza una planta que el coordinador no tiene. Escribir
además un `if` sobre `site_ids` duplicaría la regla en el peor lugar posible — el lugar donde
se puede olvidar de actualizarla.

### D4 — El alta y la invitación son **una** transacción, no dos llamadas del cliente

Alternativa considerada: que la web llame `POST /accounts` y después `POST /auth/invitations`.
Se descarta: entre las dos llamadas cabe una pérdida de red, y lo que queda es una cuenta que
no puede entrar y que además bloquea el reintento (una persona tiene a lo sumo una cuenta).
El coordinador vería "ya tiene cuenta" sobre alguien a quien nunca pudo invitar.

Entonces `POST /accounts` acepta pedir la invitación en el mismo acto, y los tres INSERT
—`app_user`, `user_site_scope`, `user_invitation`— van en la misma transacción de
`asAdministrator`. Requiere extraer de `InvitationService.issue` la parte que escribe, para
que reciba el `client` de una transacción en curso en vez de abrir la suya: el token, su hash
y las verificaciones no se duplican, se comparten.

Consecuencia buscada: **no existe el estado intermedio**. Si algo falla, no hay cuenta y el
coordinador vuelve a apretar el botón. Si lo que se pierde es la **respuesta**, el reintento
se rechaza nombrando la cuenta que ya existe, y el coordinador revoca y reemite la invitación
—que es el camino que ADR-011 ya define para un token perdido.

### D5 — La ruta vive en `apps/api/src/auth/`, junto a la invitación

`app_user` ya lo administran `invitation.service.ts` y `credential.service.ts`; `roster/` es
la mitad de `person` del mismo contexto `identity` de ADR-008. Poner el alta en un módulo
nuevo dejaría `asAdministrator` con dos llamadores en dos módulos y la disciplina de la
transacción repartida. La lectura de D1 sí se queda en `roster/`: es la consulta del roster
con una columna más, no la administración de cuentas.

### D6 — `pnpm auth:create-account` no se borra y no se reimplementa

El comando y la ruta comparten el servicio; el comando sigue siendo el único camino para los
otros roles y para el arranque, cuando todavía no hay coordinador con sesión. Se descarta
dejarlo como copia paralela: dos implementaciones del mismo orden de INSERT es exactamente
cómo una de las dos deja de escribir auditoría sin que nadie se entere.

**Lo que "compartir el servicio" significa en la práctica.** El comando es un `.mjs` plano
—sin `ts-node` ni `tsx` en el repo, confirmado al implementar— y no puede importar
`account.service.ts` directamente: esa clase es `@Injectable()` con `DbService` e
`InvitationService` inyectados. Lo que sí es compartible sin runtime de TypeScript es el
`INSERT` en sí, que es la mitad peligrosa de duplicar (la mitad del rol y los mensajes de
error puede vivir aparte sin riesgo: una responde HTTP, la otra imprime en una terminal).
Se extrajo a `apps/api/src/auth/account.repository.ts` —funciones planas, sin decorador,
sin DI— y el comando lo importa COMPILADO desde `dist/auth/account.repository.js`. Eso ata
`pnpm auth:create-account` a `pnpm --filter api build` corrido antes; el comando lo dice si
falta, con un mensaje que nombra el build en vez del `ERR_MODULE_NOT_FOUND` crudo de Node.

### D7 — El botón invita con el sitio que la pantalla está mirando

El alcance de la cuenta nueva es el `site_id` del selector, no una elección aparte:
`jhsc_member` normalmente lleva una planta (§6, pregunta cerrada 5), y el coordinador está
mirando el roster de esa planta. El email, en cambio, se pide: no está en `person` y no se
puede derivar del `employee_number`.

### D8 — El link recién emitido vive en la consola, no en la fila que lo originó

Encontrado al implementar, no en la propuesta original: la primera versión guardaba el
token en el `useState` de `InviteButton`, la misma fila que ofrecía el botón. Invitar
invalida `queryKeys.roster(siteId)` (task 4.2), el refetch trae a esa persona ya CON
cuenta, y la celda de rol dejaba de renderizar `InviteButton` para renderizar
`accountRoleLabel(...)` — la tabla es la fuente de verdad de si hay cuenta, así que la fila
tenía que cambiar de forma. React desmonta el componente que sale del árbol, y con él el
`useState` que tenía el único token en claro que el servidor iba a dar. El link se creaba y
se perdía en el mismo instante de la invitación: la única salida quedaba ser revocar y
reemitir algo que nadie llegó a ver.

La corrección sube el estado del token a `RosterConsole` (`invited`, en `index.tsx`) y lo
muestra `InvitationLink.tsx`, un banner arriba de la tabla —fuera de la fila, fuera del
filtro de búsqueda—, que sobrevive al refetch porque no depende de qué cuenta tenga esa
persona ahora. `InviteButton.onSuccess` entrega el token por `onInvited(...)` ANTES de
invalidar, y no se queda con ninguna copia: sigue siendo el mismo token de un solo uso, la
única diferencia es dónde vive mientras la consola está en pantalla. `Done` lo descarta a
mano; no hay ruta que lo vuelva a pedir.

**La lección para cualquier acción que cambie el estado por el que su propia fila se
decide mostrar**: el resultado de esa acción no puede vivir en el estado de la fila que la
ofreció. El componente que la muestra tiene que sobrevivir al efecto de haberla disparado.

## Risks / Trade-offs

- **El alta de una identidad sale por primera vez de una terminal** → El permiso no se
  escribe dos veces (D3): rol en el servicio, alcance en el motor. Un test de integración
  cubre el caso que el comando nunca tuvo — el coordinador de una planta invitando a la
  otra— y verifica que ninguna fila quedó escrita.
- **La auditoría se puede perder en silencio si los INSERT se separan** → D4 los pone en la
  misma transacción y el test de integración afirma que la entrada existe en la cadena de la
  planta después del `COMMIT`, no que la llamada devolvió 201.
- **El token en claro pasa a viajar en una respuesta HTTP a la pantalla del roster**, y no
  solo por la salida de un comando en el servidor → Es el mismo token que ya devuelve
  `POST /auth/invitations` con la misma regla de una sola vez; lo que cambia es quién lo
  copia. La pantalla lo muestra una vez, no lo guarda en la caché de TanStack Query y no lo
  vuelve a pedir.
- **Una columna más en la pantalla más ancha del sistema** → La acción y el rol comparten
  columna: sin cuenta se ve el botón, con cuenta se ve el rol. La tabla queda en cuatro
  columnas en un teléfono (ADR-010).
- **`GET /people` deja de ser una consulta a una sola tabla** → El `LEFT JOIN` es contra
  `app_user`, que no está aislada por RLS: el aislamiento lo sigue dando la política sobre
  `person`, que es la tabla de la que se parte. Una cuenta sin persona visible no aparece
  porque no hay fila de la que colgarla.

## Migration Plan

Sin migración de esquema y sin despliegue en dos pasos: la respuesta de `GET /people` gana un
campo (los clientes viejos lo ignoran; el `strictObject` de contracts obliga a desplegar el
paquete junto con la web, que es lo que ya hace el build). El rollback es revertir el
despliegue: no queda ningún dato con forma nueva. Las cuentas creadas por la ruta son
indistinguibles de las creadas por el comando — misma tabla, mismo trigger, misma cadena.
