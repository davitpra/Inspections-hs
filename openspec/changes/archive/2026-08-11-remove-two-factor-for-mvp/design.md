# Diseño — la remoción del segundo factor

ADR aplicable: **ADR-011 (autenticación y sesiones)**, cuyo D7 introdujo la sesión de propósito
limitado. ADR-002 gobierna la inmutabilidad y la cadena de auditoría. Ninguno se reescribe acá.

## D1 — Sí, este change toca tablas inmutables, y en la forma más fuerte posible

La regla del proyecto dice que se declare explícitamente cuando un change toca una tabla
inmutable. Este toca dos, y a una la elimina:

- **`app_two_factor` se dropea entera.** `0006` la creó con `hs_make_immutable`: trigger de
  columnas congeladas, prohibición de `DELETE` y prohibición de `TRUNCATE`. Ninguna de esas
  barreras impide un `DROP TABLE` —son triggers de fila, no event triggers de DDL, y se verificó
  que el proyecto no define ningún event trigger—, así que la migración puede dropearla y los
  cuatro triggers caen con ella.
- **`app_session` pierde una columna congelada.** `purpose` figura en el arreglo de columnas
  inmutables de `hs_auth_guard()`; sale del arreglo y sale de la tabla.

**Por qué dropear y no dejar la tabla huérfana.** La alternativa —dejar `app_two_factor` en pie,
sin código que la lea— parece más conservadora y no lo es: deja una tabla con secretos TOTP en
claro dentro del esquema, protegida por triggers que nadie prueba, y una función de auditoría
apuntando a un flujo que ya no ocurre. Un secreto que ya no sirve para autenticar sigue siendo un
secreto que hay que custodiar. Se dropea.

**Qué se pierde y qué no.** Se pierden las filas de `app_two_factor`: qué cuenta tenía qué
secreto y cuándo lo confirmó. **No se pierde el hecho auditable.** Las entradas
`two_factor.enrolled` y `two_factor.reset` que `hs_two_factor_audit()` haya emitido viven en
`audit_log`, en otra tabla, encadenadas por sitio, y esta migración no las toca. La cadena sigue
verificando. Esa asimetría es intencional: ADR-002 puso la cadena precisamente para que el
registro de lo que pasó sobreviva a los cambios de opinión del producto sobre cómo funcionan las
cosas.

En una base de desarrollo, además, no hay nada que perder: ningún coordinador llegó nunca a
inscribir un segundo factor, porque la pantalla para hacerlo no existe. Ese es el punto de partida
del change.

## D2 — Migración nueva, no edición de `0006`

`0006_authentication.sql` podría editarse: el proyecto escribe las migraciones a mano
(`drizzle-kit generate` está prohibido por ADR-004), no guarda snapshots en `meta/`, y
`pnpm db:reset` reconstruye desde cero. Tentador, y equivocado.

Drizzle registra en `__drizzle_migrations` el hash de cada archivo aplicado. **Editar `0006` en
una base que ya lo aplicó produce un desajuste de hash**, y cualquier entorno que haya migrado
—hoy o mañana— queda inconsistente sin aviso. El historial de migraciones es append-only por la
misma razón que el `audit_log` lo es: describe lo que efectivamente le pasó a una base, no lo que
nos gustaría que le hubiera pasado.

Se agrega `0015_remove_two_factor.sql` y su entrada en `meta/_journal.json` con la convención
exacta del archivo (`idx` 14, `when` sintético secuencial `1754524800014`).

## D3 — `hs_auth_guard()` se reemite completa

Es la decisión más delicada de la migración y la que hay que hacer bien.

`hs_auth_guard()` es **una sola función compartida por cinco tablas**: decide qué columnas están
congeladas con un `CASE TG_TABLE_NAME` que devuelve un arreglo distinto para `app_credential`,
`user_invitation`, `app_two_factor`, `app_session` y `app_refresh_token`. Está escrita así, con
`jsonb` en vez de acceso directo a `NEW.columna`, justamente porque una función compartida no
puede nombrar columnas que no existen en todas las tablas.

No hay forma de quitarle una rama parcialmente: hay que reemitirla entera con `CREATE OR REPLACE`.
Y si al reescribirla se pierde o se altera la rama de otra tabla, **esa tabla queda mutable sin
que ninguna prueba de este change lo note**, porque el fallo no es un error sino una ausencia de
error. Por eso la migración copia el cuerpo de `0006` literal, borra la rama de `app_two_factor`,
saca `'purpose'` del arreglo de `app_session`, y no cambia nada más — y por eso las tareas de
verificación incluyen intentar un `UPDATE` prohibido sobre otra tabla y exigir `HS001`.

El orden de las sentencias no tiene dependencias reales —el arreglo del `CASE` contiene literales
de texto, no referencias a columnas, así que dropear `purpose` antes o después de reemitir la
función da lo mismo— pero se escribe de mayor a menor alcance para que se lea como lo que es:
primero muere la tabla, después su función de auditoría, después se corrige el guard compartido,
y al final se limpia la columna.

## D4 — Sin bandera de configuración

Se consideró vaciar `ROLES_REQUIRING_TWO_FACTOR` y dejar el resto en pie, por ser reversible en
una línea. Se descarta: dejaría el servicio, la tabla, los tres endpoints, la rama del guard y el
`purpose` de la sesión como código que hay que mantener compilando, probando y leyendo, para una
funcionalidad que nadie usa. Peor, reintroduce el bug original —tokens persistidos para una sesión
que el guard rechaza— en cuanto alguien vuelva a llenar el arreglo sin construir la pantalla que
falta.

El día que el segundo factor vuelva, vuelve con su propia propuesta y con las dos mitades.

## D5 — El bug del cliente se arregla por construcción, no por parche

El síntoma reportado —el coordinador entra al recargar— tiene tres causas encadenadas:
`session-client.ts` persiste los tokens antes de que nadie mire `purpose`; `SignInRoute` muestra
el mensaje sin borrarlos; y `Shell` gatea con `if (!account)` sin consultar `purpose`.

Se podría parchear cada una. No hace falta ninguna: **si `purpose` no existe, una sesión no nula
es siempre plena**, y las tres piezas vuelven a ser correctas sin cambiarlas. `Shell` no se toca.
Es la señal de que la remoción ataca la causa y no el síntoma.

## D6 — Qué prueba que no quedó nada

`pnpm typecheck` es la red principal, y es una red densa: quitar `purpose` de `sessionSchema` y
`code` de `signInRequestSchema` hace que **todo** consumidor sobreviviente falle a compilar, en la
API y en el web, porque ambos consumen el mismo paquete de contratos. Un typecheck limpio es
prueba de que no quedó ninguna referencia huérfana en TypeScript.

Lo que typecheck **no** cubre, y por eso está en las tareas: el SQL de la migración, que solo
prueba una corrida limpia contra Postgres, y la integridad de `hs_auth_guard()` para las cuatro
tablas restantes, que solo prueba un `UPDATE` que debe fallar.
