## Context

Ver proposal.md — Why. Lo que este documento tiene que resolver es una sola tensión, y es
de motor, no de interfaz.

La resolución del token (`SessionService.resolve`) corre en **cada** request y corre contra
el pool sin alcance declarado. Tiene que ser así: es la consulta que CONSTRUYE el alcance,
y una política RLS sobre lo que se lee para construir el alcance es un arranque circular.
Por eso el comentario del método ya declaraba que ninguna de las tablas que toca lleva
política.

`app_user` cumple esa condición. **`person` no**: la migración 0005 le aplica
`hs_apply_site_isolation`, con `FORCE ROW LEVEL SECURITY` (ADR-002). Y el nombre que la
interfaz necesita vive ahí.

El change **no toca ninguna tabla inmutable**, ninguna política, ningún `GRANT` y ninguna
migración. Solo lee.

## Goals / Non-Goals

**Goals:**

- Que el nombre se lea por la puerta que ADR-002 define para toda lectura, y no por un
  atajo.
- Que el costo no caiga sobre el camino caliente: la identidad hace falta cuando se le
  devuelve la sesión a alguien, no en cada request.
- Que una sesión guardada por la versión anterior siga siendo válida sin red.

**Non-Goals:**

- Una pantalla de cuenta. El chip responde "quién soy"; el detalle del alcance, la ventana
  del auditor y el historial de sesiones son otro change si alguna vez hacen falta.
- Exponer `person` o `app_user` por HTTP. No se agrega ningún endpoint.
- Mostrar los nombres de las plantas del alcance. `GET /sites` ya existe y el chip no lo
  llama: sería un request por pantalla para un dato que nadie pidió.

## Decisions

### El nombre se lee en `toContractSession`, no en `resolve`

**La decisión central.** `resolve` no puede leer `person`: sin `app.site_ids` declarado la
política no matchea ninguna fila, y como el join sería INNER, la consulta devolvería cero
filas y **todo request fallaría como "sesión inexistente"**. No es un nombre vacío: es el
login roto.

`toContractSession` es el otro extremo. Lo llaman exactamente dos lugares —`POST
/auth/sign-in` y `GET /auth/session`—, y para cuando corre, el alcance ya está resuelto.
Lee bajo `DbService.withSessionClient`, que es la vía del camino HTTP y la única que puede
construir un alcance a partir de una sesión.

Consecuencia aceptada: `toContractSession` pasa a ser `async`. Es la señal correcta —ahora
toca la base— y cuesta dos `await`.

**Alternativas descartadas:**

- *`LEFT JOIN person` en `resolve`.* No rompe el login, pero devuelve `NULL` siempre: la
  política filtra igual. Sería el bug silencioso en lugar del ruidoso.
- *Declarar el alcance dentro de `resolve` y consultar `person` ahí.* Se puede —los
  `site_ids` ya se leyeron— pero paga una transacción con alcance en cada request para un
  dato que solo se usa en dos rutas, y le devuelve a `resolve` la circularidad que su
  diseño evita.
- *Una función `SECURITY DEFINER` que saltee RLS para leer el nombre propio.* Es
  defendible —el nombre de uno no es un registro de una planta— pero introduce un mecanismo
  que **no existe en ninguna parte del esquema**: no hay un solo `SECURITY DEFINER` en las
  migraciones. Agregar la primera puerta de escape de RLS para poner un nombre en una barra
  es un precio desproporcionado.
- *Un endpoint `GET /me` que devuelva la persona.* Un request más en cada arranque, y la
  misma lectura bajo alcance, con una ruta más que mantener.

### Sin `ReadDescriptor` en esa lectura

`withSessionScope` registra las lecturas del `external_auditor` (design D10 de ADR-011)
cuando se le pasa un `ReadDescriptor`. Acá se omite a propósito: lo que ese registro tiene
que probar es qué **registros** miró el auditor, y su propio nombre no es uno. Registrarlo
ensuciaría la cadena con una entrada por cada carga de pantalla.

### Los tres campos son opcionales en el contrato

El servidor los manda siempre; la opcionalidad es del lado del cliente. `refreshAccount`
revalida con `sessionSchema` la sesión que guardó en Dexie, y una fila escrita por la
versión anterior no tiene esas claves. Con campos requeridos, actualizar la aplicación
haría que un dispositivo sin señal no viera cuenta y pidiera un login que no puede
completar — ADR-001 acepta perder borradores, no recorridos.

Se pueden volver requeridas cuando no queden dispositivos con la caché vieja. El comentario
del esquema lo dice para que la deuda esté escrita y no se descubra.

### `ROLE_LABELS` vive en contracts

Junto a `ROLES`, y tipado `Record<Role, string>` para que agregar un rol sin etiquetarlo no
compile. En la web hubiera sido más corto, pero el vocabulario de §4 exige un solo término
—`jhsc_member` se muestra "JHSC member" y nunca "Inspector"— y un mapa por pantalla es
exactamente cómo aparece el segundo término.

### El chip degrada en tres pasos

Nombre completo → email → rol. La cadena existe porque los campos son opcionales: una
tolerancia en el esquema que dejara un hueco en la pantalla no serviría de nada. El rol
siempre está, así que el chip nunca queda vacío.

## Risks / Trade-offs

- **Un join a `person` desde `resolve` rompería todo request, no solo el nombre** →
  Cubierto por el comentario en `resolve` que explica por qué el email viaja ahí y el
  nombre no, y por el escenario de integración que verifica el nombre contra la base real
  con RLS puesta. Un refactor que mueva la lectura falla el test.
- **Una consulta más en sign-in y en `GET /auth/session`** → Es por clave primaria y solo
  en esas dos rutas. `GET /auth/session` se llama al arrancar la aplicación, no por
  pantalla.
- **Una cuenta cuya persona está fuera de su alcance se muestra por email** → Es el
  comportamiento especificado, no un fallo. No hay restricción que obligue a
  `person.site_id ∈ user_site_scope`, así que el caso es alcanzable y se degrada en vez de
  fallar.
- **El email queda a la vista de quien tenga el teléfono en la mano** → Es el identificador
  con el que esa persona inicia sesión y el nombre ya circula en el roster; no se expone
  nada que la sesión no supiera. Por eso el email va en `title` y no en la línea visible:
  se muestra el nombre, y el email aparece cuando hace falta desambiguar.

## Migration Plan

No hay migración de datos ni de esquema. El despliegue es el orden normal —contracts, API,
web— y los campos son aditivos, así que un cliente viejo contra una API nueva ignora lo que
no conoce y una API vieja contra un cliente nuevo devuelve una sesión sin identidad, que el
chip ya sabe mostrar. Rollback: revertir; nada quedó escrito.
