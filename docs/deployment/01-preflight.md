# 01 — Preflight: el repositorio, listo para construir

Primer documento de la secuencia. **No toca ninguna infraestructura.** Todo lo que hace
son cambios de código y de documentación dentro del repositorio, más la preparación —no la
ejecución— de la edición del seed de arranque.

El contexto compartido, las tres decisiones, el contrato de nombres, la propiedad de
artefactos y la tabla de variables están en [`README.md`](README.md) de este directorio.
Acá no se repiten: se citan.

**Estado al entrar.** Repositorio en `main`, sin cambios pendientes salvo este directorio.
`GET /health` exige token (H3). `VITE_API_BASE_URL` no existe en ningún `.env.example`
(H4). `apps/api/scripts/bootstrap-invitation.mjs` falla con un error de libpq cuando
`DATABASE_URL` no está. `apps/api/seeds/004_bootstrap_coordinator.sql` siembra la persona
de relleno. La topología de ADR-008 sigue siendo la única escrita.

**Estado al salir.** `docs/adr/026-despliegue-vps-unico.md` existe y declara la desviación.
`GET /health` responde sin token. Las dos variables no documentadas están en
`.env.example` con su porqué. El script de la primera invitación falla con un mensaje que
nombra la variable que falta. La prosa del repositorio ya no afirma que `auth:bootstrap`
se niega en producción. El seed sigue **sin editar**, con la edición especificada y con
dueño (`04`). `pnpm -r build && pnpm typecheck && pnpm test` pasan, y el presupuesto de
precache tiene holgura medida.

---

## 1. Precondiciones

Cada una se verifica con un comando. Si alguna falla, no se empieza.

### 1.1 El repositorio, y nada más abierto

```bash
cd /ruta/al/repo/hs-platform
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

Esperado: la rama en la que se trabaja, y un `git status --porcelain` que no lista nada
fuera de `docs/deployment/`. Un árbol sucio mezcla estos cambios con otros y el paso 7 deja
de decir qué fue lo que rompió.

### 1.2 Node y pnpm

```bash
node --version
pnpm --version
```

Esperado: Node **22.12.0 o superior** y pnpm **11.20.0**. Node 20 no sirve (H1):
`apps/api` es CommonJS y consume paquetes ESM por `require(esm)`; compila y explota al
arrancar. `.npmrc` fija `engine-strict=true`, así que `pnpm install` se va a negar solo.

### 1.3 Los archivos que este documento toca existen donde dice

```bash
ls -1 docs/adr/025-management-y-las-acciones-correctivas.md \
      apps/api/src/app.controller.ts \
      apps/api/src/auth/auth.guard.ts \
      apps/api/scripts/bootstrap-invitation.mjs \
      apps/api/scripts/create-account.mjs \
      apps/api/seeds/004_bootstrap_coordinator.sql \
      apps/web/scripts/check-service-worker.mjs \
      .env.example
```

Esperado: las ocho rutas, sin ningún `No such file`. Si alguna cambió de lugar, los
números de línea de este documento dejaron de ser válidos y hay que releer el archivo antes
de editarlo.

### 1.4 El número 026 está libre

```bash
ls -1 docs/adr/ | sort | tail -6
```

Esperado: el archivo de mayor número es `025-management-y-las-acciones-correctivas.md`.

> **Nota, no es un problema de este documento.** El listado muestra **dos** archivos
> numerados 024: `024-renombre-de-roles.md` y `024-reportante-ejecuta-la-accion.md`. Es una
> colisión real de numeración, y el índice de `docs/adr/README.md` solo lista el segundo.
> No afecta a `026`, que sigue libre. Se anota y se sigue.

### 1.5 Docker: no hace falta acá

Este documento **no necesita Docker**. Ver el Paso 7 para por qué los tests de
integración quedan fuera del preflight.

---

## 2. Decisiones ya tomadas

No se re-deciden. Cada una con una línea de porqué.

| # | Decisión | Porqué |
| --- | --- | --- |
| D1 | La topología de un VPS no se resuelve editando ADR-008: se escribe **ADR-026** | `CLAUDE.md` — las ADRs se citan por número y no se reescriben |
| D2 | ADR-026 supera **solo la sección "Topología de despliegue"** de ADR-008 | El resto de ADR-008 (monolito modular, dependencias, costuras críticas) sigue gobernando el código |
| D3 | `GET /health` se hace público con `@Public()`, no moviendo el guard | `auth.module.ts` tiene escrito por qué el guard es global: al revés, una ruta nueva nace abierta |
| D4 | **NO se agrega guarda de `NODE_ENV` a `auth:bootstrap`** | Ver D5. Es la decisión más importante de este documento |
| D5 | Lo que se corrige es la **prosa**, no el código: `auth:bootstrap` **debe** correr en producción | `POST /auth/invitations` exige sesión administrativa. Si el comando se negara, la primera credencial del sistema no tendría cómo emitirse. Es el huevo y la gallina que ese script existe para romper (ADR-011) |
| D6 | `auth:reset-password` **conserva** su guarda de `NODE_ENV` | Su caso es distinto: reemplaza una credencial, y en producción esa operación tiene dueño (el coordinador, con `POST /auth/credentials/revoke`) |
| D7 | El seed de arranque **se prepara acá y se edita en el `04`** | Editarlo es una sola oportunidad y su precondición es `db:seed`, que es del `04` |
| D8 | `apps/api/scripts/demo-content.mjs:51` y la tabla de `README.md:170` **se dejan como están** | Ver el Paso 4 |
| D9 | Los tests de integración **no entran** en el preflight | Ver el Paso 7 |
| D10 | Este documento no escribe `Dockerfile`, `compose.prod.yml` ni `Caddyfile` | Son del `02` y del `03` (README, "Propiedad de artefactos") |

### D4 y D5, en largo. Leer antes de tocar `bootstrap-invitation.mjs`

Hay una contradicción real en el repositorio, y la resolución **no** es alinear el código
con la documentación:

- `README.md` de la raíz, línea 80: *"Para la primera credencial del coordinador —el
  arranque real, sin datos inventados— el comando es `pnpm auth:bootstrap`"*.
- `apps/api/scripts/create-account.mjs`, líneas 26-28, afirma: *"La regla detrás de la
  negativa de `auth:bootstrap` y `auth:reset-password` no es «los comandos no corren en
  producción»…"*. Da por hecho que `auth:bootstrap` se niega.
- `apps/api/scripts/bootstrap-invitation.mjs` **no tiene ninguna guarda de `NODE_ENV`**.
  Verificable: `grep -n NODE_ENV apps/api/scripts/*.mjs` devuelve `demo-data.mjs:381`,
  `reset-password.mjs:203` y `demo-content.mjs:896`, y ninguna línea de
  `bootstrap-invitation.mjs`.

**El código coincide con el README de la raíz, y tiene que coincidir.** Un ejecutor que
"alinee el código con la documentación" agregando la guarda deja el sistema sin primera
credencial: la cuenta del seed existe, no tiene credencial, y la única forma de emitirle
una invitación sin sesión administrativa es ese comando.

`auth:reset-password` sí se niega, y ahí la negativa está bien por una razón que
`auth:bootstrap` no comparte: `reset-password` **revoca y reemplaza** una credencial
existente. En producción eso tiene dos salidas propias —esperar los quince minutos del
bloqueo, o que el coordinador revoque desde la aplicación— y un comando de terminal que las
saltee es exactamente lo que ADR-011 no quiere. `auth:bootstrap` no reemplaza nada: emite
la invitación de una cuenta que todavía no tiene credencial.

Lo único que se le agrega a `bootstrap-invitation.mjs` es la validación de `DATABASE_URL`.

---

## 3. Pasos

### Paso 1 — La ADR nueva

#### Qué resuelve

La decisión 1 del despliegue (todo en un VPS) contradice la sección "Topología de
despliegue" de ADR-008, que fija CDN estático, Postgres gestionado con PITR de al menos 7
días, y declara no negociable *"una restauración de prueba ejecutada antes de que el
sistema tenga datos reales"*. La decisión 2 (directo a producción, sin entorno de ensayo)
hace imposible esa restauración en su ventana.

`CLAUDE.md`: las ADRs se citan por número y no se reescriben. La salida correcta es una ADR
nueva.

#### El comando

```bash
cat > docs/adr/026-despliegue-vps-unico.md <<'ADR'
# ADR-026 — Despliegue en un VPS único

|                             |                                                                  |
| --------------------------- | ---------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                         |
| **Fecha**                   | 2026-09-20                                                       |
| **Supersede**               | ADR-008, sección "Topología de despliegue" (solo esa)            |
| **Superada por**            | —                                                                |
| **Referencias**             | `docs/deployment/README.md`; ADR-002, ADR-005, ADR-006, ADR-008, ADR-009, ADR-013 |
| **Changes que la consumen** | Ninguno. Es una decisión de despliegue, no de código             |

## Contexto

ADR-008 eligió cuatro piezas gestionadas —CDN estático, plataforma de contenedores,
Postgres gestionado con PITR y object storage— con el criterio explícito de "costo
operativo para un solo desarrollador". Desde entonces cambiaron dos cosas.

**ADR-013 retiró Playwright.** El criterio que ADR-008 escribe en su tabla para elegir la
plataforma de contenedores es textualmente *"Playwright necesita Chromium: sin
serverless"*. ADR-013 dice: *"Playwright y Chromium dejan de ser restricciones de runtime y
hosting porque ningún flujo superviviente genera documentos. La API sigue en un contenedor
por sus otras necesidades, pero ya no por un navegador headless."* La justificación
original de esa fila ya no está vigente. La conclusión —un contenedor de larga vida— sí lo
está, pero por pg-boss dentro del proceso (ADR-005), no por un navegador.

**La escala del despliegue quedó fijada.** Dos plantas, 15-20 cuentas, 200+ personas en el
roster, una inspección al mes por planta, un solo desarrollador, y una ventana de
mantenimiento aceptada. Cuatro proveedores gestionados son cuatro facturas, cuatro
consolas, cuatro modelos de credenciales y cuatro superficies de red que alguien tiene que
mantener con vida. A esta escala ese costo operativo pesa más que lo que compra, con una
excepción grande que esta ADR declara abajo y no disimula.

## Decisión

Una sola máquina virtual con Docker Compose: Postgres, MinIO, la API de NestJS y Caddy, con
TLS automático sobre tres subdominios. Región única, la más cercana a Ontario.

Esto supera **únicamente la sección "Topología de despliegue" de ADR-008** —su diagrama y
su tabla de cuatro piezas—. Todo el resto de ADR-008 queda intacto y sigue siendo la
referencia vigente: el monolito modular, la dirección única de las dependencias entre
módulos, la excepción declarada de `inspections` → `findings`, las dos costuras críticas y
las capas delgadas `controller → service → repository`.

| Pieza, según ADR-008 | Lo que la reemplaza |
| --- | --- |
| CDN estático (Cloudflare Pages, Netlify) | Caddy sirviendo el bundle construido, en la raíz del dominio |
| Plataforma de contenedores (Railway, Render, Fly.io) | El mismo Docker Compose de la máquina |
| Postgres gestionado **con PITR** | Un contenedor de Postgres sobre un volumen local |
| S3-compatible con versioning (R2, B2, S3) | MinIO con versioning activado, en modo path-style |

ADR-009 no se toca: sigue sin haber exigencia de residencia canadiense y sigue siendo una
sola región.

## La desviación, declarada

ADR-008, sección "El backup es la mitad de la inmutabilidad", fija tres mínimos que llama
no negociables. Esta decisión incumple dos de los tres.

1. **No hay recuperación punto-en-el-tiempo.** Un Postgres en contenedor sin archivado de
   WAL no restaura a un instante arbitrario. La ventana entre el último respaldo y la falla
   se pierde.
2. **No hay restauración de prueba antes de que el sistema tenga datos reales.** El
   despliegue va directo a producción, sin entorno de ensayo: la primera base con datos es
   la única base que va a existir. La ventana que ADR-008 pide no llega a abrirse.

El tercer mínimo sí se cumple, y sin cambios: versioning activado en el bucket y ninguna
credencial de borrado en la aplicación (ADR-006).

No se disfraza. Con esta topología, la frase de ADR-008 —*"un sistema de registro
regulatorio sin recuperación punto-en-el-tiempo tiene inmutabilidad decorativa"*— describe
un riesgo que se **asume**, no uno que se resolvió.

## Qué sustituye a lo que se pierde

Cuatro mecanismos, ninguno opcional. El **cómo** —frecuencia, destino, retención, cifrado y
comandos— es de `docs/deployment/08-backups.md`, que es su único dueño. Acá van como
obligación, no como implementación.

1. **`pg_dump` periódico fuera de la máquina.** Un volcado lógico completo, copiado a un
   destino que no comparta modo de falla con el VPS. Cambia el objetivo de recuperación de
   segundos a un período entre volcados: es peor que PITR, y es la parte que se paga.
2. **Snapshots del volumen que ofrezca el proveedor del VPS.** Cubren la pérdida de la
   máquina entera, incluidos los objetos de MinIO, que un `pg_dump` no toca.
3. **Versioning de MinIO.** Ya exigido por ADR-006: una versión de objeto no se pisa ni se
   borra desde la aplicación, porque la credencial no lleva `DeleteObject`.
4. **Un ensayo de restauración sobre una copia.** No antes de los datos reales, porque esa
   ventana no existe: se ejecuta apenas el respaldo existe, levantando una base aparte
   desde el volcado, y **nunca contra la base viva**. Es el punto exacto en el que `08`
   deja de ser un script y pasa a ser un backup. Eso de ADR-008 no se supera: un backup no
   verificado sigue sin ser un backup.

## Consecuencias

- La ventana de pérdida deja de medirse en segundos y pasa a medirse en el período entre
  volcados. Es una propiedad del sistema, no un detalle de operación, y `10-operacion.md`
  la vigila.
- La máquina es un punto único de falla. Está aceptado: sin réplicas, sin alta
  disponibilidad, con ventana de mantenimiento admitida.
- pg-boss sigue dentro del proceso y sobre la misma base (ADR-005). El contenedor no puede
  dormir: un trabajo programado que no corre no produce ningún error.
- No cambia ningún GRANT, REVOKE ni política de RLS. Los dos roles de ADR-002 son los
  mismos; lo único que cambia es quién hospeda el motor.
- El cliente deja de servirse desde un CDN y pasa a servirse desde el mismo Caddy, en la
  raíz del dominio y con fallback SPA.

## Condición de revisión

Se revisa cuando ocurra cualquiera de estas tres, y no antes:

- El ensayo de restauración de `08` falla, o el volcado deja de completarse en su ventana.
  Entonces esta topología no sostiene un registro regulatorio y hay que volver a una base
  gestionada con PITR.
- Aparece una tercera planta, o el roster pasa de cientos a miles de personas.
- Un regulador, una aseguradora o un contrato exige punto-en-el-tiempo por escrito.

Migrar es mover una base y un bucket. **No se construye nada hoy para anticiparlo.**
ADR
```

#### Actualizar el índice de ADRs

`docs/adr/README.md` tiene dos lugares que reflejan el cambio.

**a. La fila nueva**, al final de la tabla del índice, después de la de ADR-025:

```
| [026](026-despliegue-vps-unico.md) | Despliegue en un VPS único | Aceptada |
```

**b. La fila de ADR-008**, que pasa a declarar la superación parcial:

```
| [008](008-system-architecture.md)           | Arquitectura del sistema                          | Parcialmente superada por ADR-026 |
```

Es el mismo formato que ya usan las filas de ADR-011, ADR-017 y ADR-019.

**c. La tabla "Stack consolidado"** del mismo archivo tiene tres filas que ahora mienten
sobre la topología:

```
| Hosting API           | Plataforma de contenedores, región única | 008, 009 |
| Hosting cliente       | CDN estático                             | 008      |
| Backups               | PITR ≥ 7 días + versioning de objetos    | 008, 026 |
```

Pasan a citar también a 026:

```
| Hosting API           | Contenedor en VPS único, región única    | 008, 009, 026 |
| Hosting cliente       | Servido por Caddy desde el mismo VPS     | 008, 026      |
| Backups               | Volcado periódico + versioning de objetos | 006, 026     |
```

**d. El encabezado de ADR-008.** Por la convención de superación de `docs/adr/README.md`
(punto 3), la única edición permitida sobre un ADR superado es su estado. Como acá la
superación es **parcial**, se edita la fila `Superada por` y **no** la de `Estado`:

```
| **Estado**                  | Aceptada                                                    |
| **Superada por**            | ADR-026 (parcial: solo la sección "Topología de despliegue") |
```

#### Comprobación

Distinta del comando que la escribió:

```bash
head -12 docs/adr/026-despliegue-vps-unico.md
grep -n "026" docs/adr/README.md
grep -n "Superada por" docs/adr/008-system-architecture.md
```

Esperado: la tabla de encabezado de 026 con las seis filas y la fecha `2026-09-20`; al
menos tres apariciones de `026` en el índice (la fila nueva y las del stack); y la fila
`Superada por` de ADR-008 nombrando a ADR-026 con la palabra **parcial**.

Y una comprobación de que la superación es del alcance correcto:

```bash
grep -n "Topología de despliegue" docs/adr/008-system-architecture.md docs/adr/026-despliegue-vps-unico.md
```

Esperado: la sección en 008 (línea 12) y la mención en 026. Si 026 dijera que supera ADR-008
entero, estaría retirando el monolito modular y las dos costuras críticas, que es todo lo
que el código del día a día consume.

---

### Paso 2 — Hacer público `GET /health`

#### Qué resuelve

`apps/api/src/app.controller.ts:9` define `@Get('health')`. El `AuthGuard` está registrado
como `APP_GUARD` global en `apps/api/src/auth/auth.module.ts:43`, y solo exime las rutas
marcadas con `@Public()`. `AppController` no la tiene, así que `GET /health` responde
`session_ended` sin token. Cualquier healthcheck —el del compose, el de Caddy, el de un
monitor externo— lo lee como servicio caído, siempre.

Que el guard sea global es deliberado y no se toca. Está escrito en el propio módulo:
*"Al revés —guard por controlador— una ruta nueva nace abierta, y el día que alguien
agregue un endpoint de hallazgos sin acordarse del decorador, el sistema no se lo dice."*
La excepción se declara en la ruta, que es como ya lo hacen `POST /auth/sign-in`
(`auth.controller.ts:44`), `POST /auth/refresh` (línea 60) y la aceptación de invitación
(línea 115).

#### El diff

Sobre `apps/api/src/app.controller.ts`, completo:

```diff
 import { Controller, Get } from '@nestjs/common';
 import { type HealthResponse } from '@hs/contracts';
 import { AppService } from './app.service';
+import { Public } from './auth/auth.guard';

 @Controller()
 export class AppController {
   constructor(private readonly appService: AppService) {}

+  /**
+   * Pública a propósito: la consume el healthcheck del contenedor y el proxy, que no
+   * tienen sesión ni deben tenerla. No devuelve nada del dominio —`{ status, service }`,
+   * `healthResponseSchema`— así que no hay nada que filtrar.
+   */
+  @Public()
   @Get('health')
   getHealth(): HealthResponse {
     return this.appService.getHealth();
   }
 }
```

`Public` se importa desde `./auth/auth.guard`, que es donde está declarado
(`auth.guard.ts:16`, `export const Public = (): CustomDecorator => SetMetadata(PUBLIC, true)`).
`auth.controller.ts:18` lo importa del mismo lugar. **No** se importa desde
`auth.module.ts`.

#### El test: verificado, no hay nada que romper

`apps/api/src/app.controller.spec.ts` construye un `TestingModule` con
`controllers: [AppController], providers: [AppService]` y llama a
`appController.getHealth()` directo. No monta el guard, no hace un request HTTP, y un
decorador de metadatos no cambia lo que devuelve el método. **Pasa igual.**

Y la comprobación que el encargo pedía explícitamente:

```bash
grep -rn "health" --include=*.ts apps/api/test/
```

Esperado: **ninguna línea**. Verificado: no existe ningún test de integración que golpee
`/health`, ni uno que espere que la ruta rechace sin token. La única mención a `health` en
la API fuera del controlador y su spec es `healthResponseSchema` en `app.service.ts:2`, que
es el contrato de la respuesta y no cambia.

#### Comprobación

Estática, sin levantar nada:

```bash
grep -n "Public" apps/api/src/app.controller.ts
```

Esperado: dos líneas —el `import` y el decorador `@Public()`—, y el decorador **arriba** de
`@Get('health')`.

Funcional, contra la API local, si hay una base levantada:

```bash
pnpm --filter api start:dev   # en otra terminal
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/health
curl -s http://localhost:3000/health
```

Esperado: `200`, y el cuerpo `{"status":"ok","service":"api"}`. Antes del cambio, ese mismo
`curl` devolvía un error de sesión. Una segunda llamada **con** un `Authorization` inválido
tiene que seguir dando `200`: `@Public()` corta el guard antes de mirar el token.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer no-sirve' http://localhost:3000/health
```

Esperado: `200`. Si da un error de sesión, el decorador quedó en el lugar equivocado.

---

### Paso 3 — `VITE_API_BASE_URL` en `.env.example`

#### Qué resuelve

`apps/web/src/api/client.ts:11` la lee así:

```ts
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
```

Es build-time y no está documentada en ningún `.env.example`, ningún README ni ningún
comentario. Un olvido no produce ningún error: produce un bundle que apunta a
`http://localhost:3000` y falla en todos los dispositivos a la vez.

#### El bloque

Se agrega a `.env.example`, **después de `WEB_ORIGINS`** (hoy el último bloque, línea 90).
Va ahí y no arriba a propósito: es la única variable del archivo que no la consume el
proceso de la API, y quedar pegada a `WEB_ORIGINS` deja juntos los dos extremos del mismo
CORS.

```
# apps/web — a dónde le habla la PWA. La lee `src/api/client.ts` y NO es una variable del
# proceso: Vite la resuelve AL CONSTRUIR y el valor queda horneado adentro del bundle y
# adentro del precache del service worker. Cambiarla después de un build no hace
# absolutamente nada; hay que volver a construir y volver a publicar.
#
# Sin definir, el código cae a su default —`http://localhost:3000`— y ahí está el problema:
# el build no falla, el deploy no falla, el servidor no registra nada. Falla en el teléfono
# de cada inspector, todos a la vez, y con un service worker instalado que ya se llevó ese
# valor puesto. No hay validación que lo detecte: `apps/api/src/env.ts` valida el entorno de
# la API, no el del cliente, y nunca va a ver esta variable.
#
# En producción es el origen https de la API —pelado, sin barra final y sin ruta—, el mismo
# formato que pide WEB_ORIGINS, y tiene que estar en la lista blanca de WEB_ORIGINS del
# otro lado o el navegador corta el request antes de que la API lo vea.
VITE_API_BASE_URL=http://localhost:3000
```

El valor que queda en `.env.example` es el de **desarrollo local**, que es lo que ese
archivo documenta. El valor de producción es del `07`, y no aparece acá.

#### Comprobación

```bash
grep -n -A1 "VITE_API_BASE_URL" .env.example
grep -rn "VITE_API_BASE_URL" apps/web/src/
```

Esperado: la variable presente en `.env.example` con su bloque de comentario, y una sola
lectura en el código, en `apps/web/src/api/client.ts`. Si aparece en más de un lugar, hay
un segundo default que este bloque no describe.

---

### Paso 4 — `bootstrap-invitation.mjs` y la prosa que lo contradice

> **Antes de escribir una línea: releé la decisión D4/D5 de la sección 2.** Lo que este
> paso hace es **una** validación de variable y **tres** correcciones de prosa. Lo que este
> paso NO hace, y no puede hacer, es agregar una guarda de `NODE_ENV`.

#### La validación de `DATABASE_URL`

Hoy `apps/api/scripts/bootstrap-invitation.mjs:112` hace:

```js
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
```

Con la variable ausente, `connectionString` queda `undefined` y libpq falla con un error
sobre el usuario o el socket que no menciona la configuración por ningún lado. El resto de
los scripts ya resuelven esto con el mismo mensaje: `create-account.mjs:296-298`,
`reset-password.mjs:210-212`, `demo-content.mjs:900-902` y `demo-data.mjs:385-387`.

El diff, sobre `main()`:

```diff
 async function main() {
   const targetId = process.argv[2] ?? COORDINATOR_ID;

+  if (!process.env.DATABASE_URL) {
+    throw new Error('Falta DATABASE_URL. Ver .env.example.');
+  }
+
   const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
```

**Va adentro de `main()` y no arriba, en el módulo.** `issueInvitation()` se **exporta** y
lo importan `reset-password.mjs:5` y `demo-data.mjs`; una validación en el cuerpo del
módulo se dispararía al importarlo, no al usarlo, y rompería dos comandos que hoy funcionan.
El archivo ya tiene escrito ese cuidado en el guard del final:

```js
// Solo cuando se lo invoca como script, no cuando lo importa `demo-data.mjs`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
```

El mensaje es literal y copiado del estilo existente: `'Falta DATABASE_URL. Ver .env.example.'`

#### La prosa de `create-account.mjs`

`apps/api/scripts/create-account.mjs`, líneas 26-33, afirma un hecho que el código no hace
**y que no debe hacer**. El argumento sobre credenciales que da es bueno y se conserva; lo
que está mal es la afirmación sobre `auth:bootstrap`.

```diff
- * CORRE EN PRODUCCIÓN, y es el único `auth:*` que lo hace. La regla detrás de la negativa
- * de `auth:bootstrap` y `auth:reset-password` no es "los comandos no corren en
- * producción": es que ninguno establece ni reemplaza una CREDENCIAL ahí. Los dos
- * convierten el acceso al servidor en acceso a una cuenta. Este no toca `app_credential`:
+ * CORRE EN PRODUCCIÓN. La regla detrás de la única negativa que existe —la de
+ * `auth:reset-password`— no es "los comandos no corren en producción": es que ese comando
+ * REEMPLAZA una credencial, y ahí esa operación ya tiene dueño y no es una terminal (la
+ * revoca el coordinador con `POST /auth/credentials/revoke`, y el bloqueo por intentos se
+ * espera). Este no toca `app_credential`:
   * la cuenta que crea no puede iniciar sesión —nace sin credencial y sigue necesitando la
   * invitación emitida y aceptada— así que lo peor que puede hacer quien lo corre es crear
   * una cuenta de más, visible, auditada y desactivable. Negarse en producción habría
   * dejado el alta REAL, la única que importa, en el mismo `psql` que este comando saca.
+ *
+ * `auth:bootstrap` TAMPOCO SE NIEGA, y eso no es un olvido: emite la PRIMERA invitación,
+ * la única que no puede venir de una sesión administrativa porque todavía no existe
+ * ninguna. `POST /auth/invitations` exige esa sesión. Si el comando se negara con
+ * NODE_ENV=production, la primera credencial del sistema no tendría cómo emitirse: es
+ * exactamente el huevo y la gallina que ese script existe para romper (ADR-011, y el
+ * encabezado de `bootstrap-invitation.mjs`). No le agregues la guarda.
```

La última línea es deliberadamente una instrucción: el comentario es el único lugar donde
alguien que llegue a "alinear el código con la documentación" va a mirar.

#### La misma afirmación falsa, en el `README.md` de la raíz

> **Discrepancia con el encargo, anotada.** La tarea nombraba solo `create-account.mjs`. Al
> verificarlo apareció que el `README.md` de la raíz repite el mismo hecho falso en dos
> lugares. Es el mismo defecto y la misma clase de archivo —documentación del repositorio,
> no un artefacto de otro documento de despliegue—, así que se corrige acá.

`README.md:110`:

```diff
-   Es el **único `auth:*` que corre en producción**, y la razón es que no siembra ni
-    reemplaza ninguna credencial. Solo acepta `coordinator`, `inspector` y `management`.
+   Corre en producción, y la razón es que no siembra ni reemplaza ninguna credencial.
+   Solo acepta `coordinator`, `inspector` y `management`. El paso 2, `auth:bootstrap`,
+   también corre en producción: es la única forma de emitir la primera invitación del
+   sistema, cuando todavía no hay una sesión administrativa que la firme. El único `auth:*`
+   que se niega con `NODE_ENV=production` es `auth:reset-password`, porque reemplaza una
+   credencial existente.
```

`README.md:291`, en la tabla de comandos:

```diff
-| `pnpm auth:create-account`                 | Crea la cuenta de una persona del roster. El único `auth:*` que corre en producción. |
+| `pnpm auth:create-account`                 | Crea la cuenta de una persona del roster. Corre en producción.                       |
```

El README ya dice bien lo que importa en su línea 80 (*"Para la primera credencial del
coordinador —el arranque real— el comando es `pnpm auth:bootstrap`"*), así que después de
estas dos correcciones el documento deja de contradecirse a sí mismo.

#### `reset-password.mjs`: su caso es distinto, y ahí la negativa está bien

Verificado en `apps/api/scripts/reset-password.mjs:203-208`:

```js
if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'auth:reset-password no corre con NODE_ENV=production. Ahí el bloqueo se espera y la ' +
      'credencial la revoca el coordinador desde la aplicación.',
  );
}
```

La guarda existe, es lo primero que hace `main()`, y **se conserva tal cual**. La diferencia
con `auth:bootstrap` es material, no de estilo:

| | `auth:bootstrap` | `auth:reset-password` |
| --- | --- | --- |
| Qué hace con la credencial | Emite una invitación a una cuenta que **no tiene** ninguna | **Revoca** la vigente y emite una para reemplazarla |
| Alternativa en producción | Ninguna. `POST /auth/invitations` exige sesión administrativa y todavía no hay | Dos: esperar los quince minutos del bloqueo, o que el coordinador revoque con `POST /auth/credentials/revoke` |
| Qué pasa si se niega | El sistema **no tiene** primera credencial | Nada. La operación sigue teniendo dueño |

Hay un detalle que conviene tener presente y que no cambia nada acá: `reset-password.mjs:5`
importa `issueInvitation` de `bootstrap-invitation.mjs`. O sea que el camino de la
invitación es uno solo y ya lo comparten. Por eso la validación de 6.1 va en `main()`.

#### Comprobación

```bash
grep -n "NODE_ENV" apps/api/scripts/*.mjs
```

Esperado, exactamente tres archivos y **ninguno** de ellos `bootstrap-invitation.mjs`:

```
apps/api/scripts/demo-data.mjs:381
apps/api/scripts/reset-password.mjs:203
apps/api/scripts/demo-content.mjs:896
```

Si `bootstrap-invitation.mjs` aparece en esa lista, el paso se ejecutó mal y hay que
revertirlo: ver la sección 6 ("Si falla"), síntoma 3.

Y que la validación nueva haga lo que dice, sin base y sin variable:

```bash
env -u DATABASE_URL node apps/api/scripts/bootstrap-invitation.mjs
```

Esperado: `Falta DATABASE_URL. Ver .env.example.` y código de salida 1. Antes del cambio
salía un error de libpq que no nombraba la variable.

Que `reset-password` siga negándose, y por lo que corresponde:

```bash
NODE_ENV=production node apps/api/scripts/reset-password.mjs alguien@example.com
```

Esperado: el mensaje `auth:reset-password no corre con NODE_ENV=production…`.

Y que `auth:bootstrap` **no** se niegue por `NODE_ENV` —falla por la variable, que es otra
cosa—:

```bash
NODE_ENV=production env -u DATABASE_URL node apps/api/scripts/bootstrap-invitation.mjs
```

Esperado: `Falta DATABASE_URL. Ver .env.example.` **y no** un mensaje sobre `NODE_ENV`. Si
sale un mensaje sobre producción, alguien agregó la guarda.

---

### Paso 5 — `DEMO_COORDINATOR_PASSWORD` en `.env.example`

#### Qué resuelve

`apps/api/scripts/demo-content.mjs:913` la lee:

```js
const coordinatorPassword = process.env.DEMO_COORDINATOR_PASSWORD ?? password;
```

Está mencionada en el `README.md` de la raíz (líneas 155-158 y la tabla de la 170) pero no
está en `.env.example` junto a `DEMO_PASSWORD`, que es donde alguien la busca.

Nunca llega a producción (`docs/deployment/README.md`, grupo "Nunca llegan a producción"), y
`demo:content` se niega con `NODE_ENV=production` (`demo-content.mjs:896`). Se documenta
igual: una variable que existe y no está escrita en ningún lado es una que alguien va a
volver a descubrir leyendo el script.

#### El bloque

Se agrega en `.env.example` inmediatamente después de `DEMO_PASSWORD` (hoy línea 45), donde
ya está el bloque de las variables de demo:

```
# `pnpm demo:content` — la contraseña con la que ese comando INICIA SESIÓN como el
# coordinador. No la cambia, y esa es toda la razón por la que es una variable aparte de
# DEMO_PASSWORD: el inspector lo crea `demo:data` y su contraseña la elige el script, pero
# el coordinador es una cuenta REAL del entorno —la siembra
# `seeds/004_bootstrap_coordinator.sql` y su credencial la pone `auth:bootstrap` a mano—, así
# que puede tener ya una que este comando no conoce y que NO le corresponde pisar.
# Resetearla para que coincida revocaría la credencial y cortaría las sesiones vivas de
# alguien que no pidió nada.
#
# Sin definir cae a DEMO_PASSWORD, y sin esa, a `DEFAULT_PASSWORD` de `scripts/demo-data.mjs`.
# Se deja comentada porque es la única variable de este archivo cuyo valor correcto depende
# de lo que tenga puesto tu entorno, no de un default.
# DEMO_COORDINATOR_PASSWORD=
```

#### Comprobación

```bash
grep -n "DEMO_" .env.example
grep -n "DEMO_COORDINATOR_PASSWORD" apps/api/scripts/demo-content.mjs README.md
```

Esperado: `DEMO_PASSWORD` y `DEMO_COORDINATOR_PASSWORD` presentes en `.env.example`; y el
nombre citado en `demo-content.mjs` (líneas 913 y 924) y en el README de la raíz. El
archivo `.env.example` no menciona `DEMO_MANAGER_EMAIL` ni `DEMO_MANAGER_PASSWORD`, y así
queda: `docs/deployment/README.md` ya dice que no las lee nadie.

---

### Paso 6 — Preparar la edición del seed de arranque (NO ejecutarla)

> **Este paso no edita nada.** Deja especificado qué se cambia, qué se conserva y qué datos
> hay que tener a mano. **La ejecución de la edición es del documento `04`**, que la tiene
> como precondición de `pnpm db:seed`. Editarlo acá adelanta un cambio que no se puede
> probar hasta que exista la base, y lo deja seis documentos suelto en el árbol.

#### Qué hace hoy el seed

`apps/api/seeds/004_bootstrap_coordinator.sql` rompe el huevo y la gallina de ADR-011: crea
la persona y la cuenta del primer coordinador, sin credencial. La credencial llega después,
por `pnpm auth:bootstrap`.

#### Las cuatro líneas que se editan

| Línea | Hoy | Qué va |
| --- | --- | --- |
| 51 | `'BOOTSTRAP-0001',` | El número de legajo **real** de ADP de la persona |
| 52 | `'Health and Safety',` | Su nombre de pila, tal como va en el roster |
| 53 | `'Coordinator',` | Su apellido, tal como va en el roster |
| 64 | `'coordinator@example.com',` | Su email corporativo |

Y una quinta, que es una decisión y no un reemplazo mecánico:

| Línea | Hoy | Qué va |
| --- | --- | --- |
| 54 | `'5717e900-0000-4000-8000-000000000001')` | El UUID de **su planta**: `…0001` es St. Thomas, `…0002` es Glencoe (`seeds/002_sites.sql:33-34`) |

La línea 54 es el sitio de la **persona** en el roster, no el alcance de la cuenta. Son dos
cosas distintas y el seed las separa: el alcance son las dos plantas y se otorga abajo, en
el `INSERT INTO user_site_scope` de las líneas 77-81. Una persona vive en una planta; la
cuenta del coordinador ve las dos (§6, pregunta cerrada 5). Solo hay que tocar la 54 si el
coordinador real no es de St. Thomas.

#### Lo que se conserva, y por qué

Los UUID literales **no se tocan**. No es una preferencia de estilo: hay código que los
nombra por valor.

| Valor | Línea(s) del seed | Quién más lo nombra |
| --- | --- | --- |
| `acc00000-0000-4000-8000-000000000001` (la cuenta) | 62, 78 | `apps/api/scripts/bootstrap-invitation.mjs:26` (`COORDINATOR_ID`, el argumento **por default** de `pnpm auth:bootstrap`); `apps/api/seeds/005_inspection_schedules.sql:35` y `:51`; `apps/api/test/helpers/identity.ts:19` |
| `7e150000-0000-4000-8000-000000000001` (la persona) | 50, 63 | `apps/api/test/helpers/identity.ts:18` |
| `5717e900-…0001` y `…0002` (las plantas) | 37 (`set_config`) | `apps/api/seeds/002_sites.sql:33-34`, y medio repositorio |

Si cambiara el UUID de la cuenta, `pnpm auth:bootstrap` sin argumentos dejaría de encontrarla
y el seed `005_inspection_schedules.sql` fallaría al declarar `app.user_id`. El encabezado
del propio archivo (líneas 16-18) ya lo dice: *"Los ids son literales fijos… los fixtures y
los tests nombran la cuenta sin una subconsulta"*.

También se conservan, sin cambios:

- **Las cláusulas `ON CONFLICT`** (líneas 55, 66, 81). Son la idempotencia: `pnpm db:seed`
  se corre las veces que haga falta.
- **El `set_config('app.site_ids', …)` de las líneas 35-38.** Declara el alcance antes de
  cualquier `INSERT`, y hace falta por dos razones que el archivo explica: la política RLS
  de `person` (que hace `FORCE`, así que alcanza también a `hs_migrator`) y el trigger
  diferido `app_user_created_audit`, que frena con HS002 si alguna planta del alcance no
  está declarada.
- **El `WHERE s.code IN ('st-thomas', 'glencoe')`** de la línea 80. Es el alcance de dos
  plantas de la cuenta.
- **El rol `'coordinator'`** de la línea 65.

#### Los datos que hay que tener a mano antes del `04`

Cuatro, y los cuatro definitivos. Por ADR-002 no hay `DELETE`, así que una corrección
posterior deja las dos filas en el roster y en la cadena de auditoría:

1. Nombre y apellido tal como van a figurar en el roster real.
2. **El número de legajo de ADP**, el verdadero. El comentario de las líneas 44-47 del seed
   explica por qué importa: el `roster:import` es un **upsert por `employee_number`**, así
   que con el número de relleno la primera importación real **crea una fila nueva** en vez
   de corregir esta. Es la única fila del sistema donde puede pasar, y poner el número real
   ahora es lo que hace que no pase.
3. El email corporativo. Es a donde va a llegar el link de la invitación de
   `pnpm auth:bootstrap`, que se muestra una sola vez.
4. En cuál de las dos plantas está esa persona (línea 54).

#### Editar el seed es seguro para la suite. Verificado

El único test que menciona un correo parecido es
`apps/api/test/rename-roles-migration.int-spec.ts:89`, y **usa su propio valor**:

```
($1, $3, 'ada.coordinator@example.com', 'hs_coordinator'),
```

Es `ada.coordinator@example.com`, no `coordinator@example.com`, y el test lo **inserta él
mismo** en ese `INSERT INTO app_user`. Lo vuelve a afirmar en su línea 241. No lee nada del
seed.

Y hay una razón estructural, más fuerte que la coincidencia de nombres:
`apps/api/test/helpers/postgres.ts` levanta el contenedor y corre **solo las migraciones**
(`migrate(drizzle(migrator), { migrationsFolder: MIGRATIONS_DIR })`, línea 92). **Los seeds
no se aplican en los tests de integración.** `SEEDED_COORDINATOR` en
`test/helpers/identity.ts:17-20` es un par de constantes que los tests usan para sus propias
inserciones, no una lectura de la base sembrada.

Comprobación, para repetirla el día de la edición:

```bash
grep -rn "coordinator@example.com" --include=*.ts apps/api/test/
grep -rn "BOOTSTRAP-0001" --include=*.ts --include=*.mjs apps/ packages/
```

Esperado: en el primero, solo las dos líneas de `rename-roles-migration.int-spec.ts` con el
prefijo `ada.`. En el segundo, **ninguna línea**: el número de legajo de relleno no aparece
en ningún test ni en ningún script.

#### Qué queda desactualizado, y qué se hace con eso

Dos lugares nombran el email de relleno y quedan desfasados después de la edición del `04`.
**Los dos se dejan como están.** Decisión D8, con su porqué:

**a. `apps/api/scripts/demo-content.mjs:51`**

```js
/** La cuenta que siembra `004_bootstrap_coordinator.sql`. */
const COORDINATOR_EMAIL = 'coordinator@example.com';
```

Se deja. `demo:content` se niega con `NODE_ENV=production` (`demo-content.mjs:896`) y
`docs/deployment/README.md` ya declara que ni `demo:data` ni `demo:content` participan del
despliegue. La constante solo afecta al entorno de demo local, donde el seed **no** se
edita y el valor sigue siendo el correcto. Cambiarla la rompería exactamente ahí, que es el
único lugar donde se usa. El comentario de arriba deja de ser literal —la cuenta que siembra
el seed en producción tendrá otro email—, pero en el entorno donde el script corre sigue
siendo verdad.

**b. `README.md:170`**, la tabla "Con qué entrar":

```
| `coordinator@example.com`    | `DEMO_COORDINATOR_PASSWORD` | `coordinator` | St. Thomas + Glencoe | Health and Safety Coordinator (`BOOTSTRAP-0001`) |
```

Se deja. Esa tabla documenta el **entorno de demo local**, que es donde esos valores son
ciertos: su encabezado dice "Corridos los dos comandos, en http://localhost:5173 entran
estas dos cuentas". El `README.md` de la raíz describe el repositorio y el desarrollo, no el
despliegue; el despliegue lo describe este directorio. Meter el dato real de producción en
esa tabla sería publicar el email del coordinador en el README de un repositorio.

Por la misma razón se dejan los otros tres usos del correo de relleno, que son **ejemplos de
uso** en comentarios y no configuración: `README.md:102`, `README.md:181`, `README.md:198`,
`apps/api/scripts/create-account.mjs:43` y `apps/api/scripts/reset-password.mjs:30`.

#### Comprobación de este paso

La única que corresponde, porque este paso no edita nada:

```bash
git diff --stat -- apps/api/seeds/
grep -n "BOOTSTRAP-0001\|coordinator@example.com" apps/api/seeds/004_bootstrap_coordinator.sql
```

Esperado: `git diff --stat` **vacío** para `apps/api/seeds/`, y el seed todavía con
`BOOTSTRAP-0001` (línea 51) y `coordinator@example.com` (línea 64). Si el seed está
modificado al terminar el `01`, el paso se ejecutó de más.

---

### Paso 7 — La verificación del repositorio

#### El orden, y por qué no es negociable

**El build va antes del typecheck.** `CLAUDE.md` y `.github/workflows/ci.yml` lo dicen con
las mismas palabras: `apps/web` y `apps/api` consumen `@hs/forms` y `@hs/contracts` por sus
`exports` → `dist`, así que **no tipan** hasta que los paquetes estén compilados. Corrido al
revés, `pnpm typecheck` falla con errores de módulo no encontrado que no tienen nada que ver
con los cambios de este documento.

#### Un `dist/` limpio antes de construir

`apps/web/scripts/check-service-worker.mjs` mide el precache sumando **todo lo que hay en
`apps/web/dist/`** menos `sw.js`. Un artefacto viejo de un build anterior —un chunk con
otro hash, un asset renombrado— se suma a la cuenta y puede hacer fallar el presupuesto por
algo que no está en el bundle actual.

```bash
rm -rf apps/web/dist apps/api/dist packages/forms/dist packages/contracts/dist
```

#### La secuencia

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm -r build
pnpm typecheck
pnpm test
```

Salida esperada, comando por comando:

| Comando | Esperado |
| --- | --- |
| `pnpm install --frozen-lockfile` | Termina sin tocar el lockfile. Si dice que el lockfile está desactualizado, alguien cambió un `package.json` y este documento no lo hizo |
| `pnpm lint` | Sin errores. `eslint.config.js` implementa ADR-007 y ADR-008; si una regla salta, la conversación es sobre la ADR |
| `pnpm -r build` | Los cuatro paquetes. El de `web` imprime las dos líneas del service worker (ver el Paso 7) |
| `pnpm typecheck` | Sin errores. Es acá donde aparecería el `import` mal escrito del paso 2 |
| `pnpm test` | Verde, **incluido `apps/api/src/app.controller.spec.ts`**, que sigue pasando porque prueba el método directo y no monta el guard |

#### La holgura del presupuesto de precache

Es la comprobación que más importa de esta sección. `apps/web/scripts/check-service-worker.mjs:28`
fija:

```js
const PRECACHE_BUDGET_BYTES = 900 * 1024;
```

y el bundle medido hoy es **881.6 KiB**. Quedan alrededor de **18 KiB**.

**Dónde mirarlo.** El script lo imprime al final de `pnpm -r build`, en la salida de
`apps/web`, en dos líneas:

```
service worker: sin builtins de Node ✓
precache: 881.6 KiB (presupuesto 900 KiB)
```

Para volver a verlo sin reconstruir todo, con el `dist/` ya generado:

```bash
pnpm --filter web verify:bundle
```

**Qué hacer si se pasó.** El build falla con un mensaje que dice *"El precache supera el
presupuesto. Subí `PRECACHE_BUDGET_BYTES` en un commit propio"*. En ese orden:

1. **Confirmar que el `dist/` estaba limpio.** Repetir 9.2 y reconstruir. Si el número baja
   por debajo de 900, no había crecimiento: había basura.
2. **Confirmar que este documento no lo causó.** Los cambios del `01` son un `import` de un
   decorador en `apps/api`, comentarios y archivos de documentación. **Ninguno entra al
   bundle del cliente.** Si el precache creció por el `01`, algo se agregó que no está
   escrito acá.
3. Si creció de verdad, **subir el número en un commit propio y solo. Nunca en el mismo
   commit que lo hizo crecer.** El mecanismo entero es que el revisor vea cuánto subió y por
   qué; un número que sube escondido entre cambios de funcionalidad no informa nada.

No es negociable ni se desactiva: ADR-012 lo cita como una de las dos objeciones que hay que
responder antes de proponer un framework de UI.

#### Los tests de integración: fuera del preflight, y por qué

`pnpm --filter api test:int` **no forma parte de este documento.**

- Necesitan Docker: `apps/api/test/helpers/postgres.ts` levanta un Postgres real con
  Testcontainers. En CI corren en un job **aparte** del de lint/typecheck, con este
  comentario en `.github/workflows/ci.yml`: *"Job aparte del de lint/typecheck para que un
  fallo de integración se distinga de un fallo de compilación."* La misma separación aplica
  acá.
- No prueban nada que este documento cambie. Los cuatro cambios de código son: un decorador
  de metadatos en `AppController`, una validación de variable de entorno en un script `.mjs`
  que los tests no importan, y dos entradas en `.env.example`. **Ninguno toca el esquema,
  una política de RLS, un trigger ni un endpoint de dominio.**
- Como se verificó en 8.5, los tests de integración **no aplican los seeds**, así que ni
  siquiera el paso 6 los alcanzaría.

Sí corresponden en el `04`, que es donde se toca la base de verdad. Si alguien los quiere
correr igual acá, necesita Docker levantado y son varios minutos; el criterio de hecho de
este documento no los incluye.

---

## 4. Verificación

Bloque completo y repetible. Se pega entero, desde la raíz del repositorio. Sirve igual
dentro de un mes para confirmar que el `01` sigue aplicado.

```bash
cd /ruta/al/repo/hs-platform

echo '--- 1. ADR-026 existe, con su encabezado y su fecha'
head -12 docs/adr/026-despliegue-vps-unico.md
grep -c "Topología de despliegue" docs/adr/026-despliegue-vps-unico.md
grep -n "Condición de revisión" docs/adr/026-despliegue-vps-unico.md

echo '--- 2. El índice de ADRs y el encabezado de ADR-008 lo reflejan'
grep -n "026" docs/adr/README.md
grep -n "Superada por" docs/adr/008-system-architecture.md

echo '--- 3. GET /health es público'
grep -n "Public" apps/api/src/app.controller.ts

echo '--- 4. Ningún test espera que /health rechace'
grep -rn "health" --include=*.ts apps/api/test/ || echo '(ninguno, correcto)'

echo '--- 5. Las dos variables están documentadas'
grep -n "VITE_API_BASE_URL\|DEMO_COORDINATOR_PASSWORD" .env.example

echo '--- 6. bootstrap-invitation valida DATABASE_URL'
grep -n "Falta DATABASE_URL" apps/api/scripts/bootstrap-invitation.mjs

echo '--- 7. NO tiene guarda de NODE_ENV (tres archivos, ninguno es este)'
grep -n "NODE_ENV" apps/api/scripts/*.mjs

echo '--- 8. La prosa ya no afirma que auth:bootstrap se niega'
grep -n "único \`auth:\*\`" apps/api/scripts/create-account.mjs README.md || echo '(ninguna, correcto)'

echo '--- 9. El seed sigue SIN editar'
grep -n "BOOTSTRAP-0001\|coordinator@example.com" apps/api/seeds/004_bootstrap_coordinator.sql

echo '--- 10. El repositorio construye, en el orden correcto'
rm -rf apps/web/dist apps/api/dist packages/forms/dist packages/contracts/dist
pnpm install --frozen-lockfile
pnpm lint
pnpm -r build
pnpm typecheck
pnpm test

echo '--- 11. La holgura del precache'
pnpm --filter web verify:bundle
```

Lo que tiene que dar:

1. Las seis filas del encabezado y la fecha `2026-09-20`; al menos una mención a "Topología
   de despliegue"; la sección "Condición de revisión" presente.
2. `026` en el índice y en la tabla de stack; `Superada por` de ADR-008 con la palabra
   **parcial**.
3. Dos líneas: el `import { Public } from './auth/auth.guard';` y el `@Public()`.
4. Nada, o el `(ninguno, correcto)`.
5. Las dos variables presentes.
6. La línea de la validación, adentro de `main()` y por encima del `new pg.Pool`.
7. Exactamente `demo-data.mjs:381`, `reset-password.mjs:203` y `demo-content.mjs:896`.
   **`bootstrap-invitation.mjs` no aparece.**
8. `(ninguna, correcto)`.
9. Las dos líneas todavía con los valores de relleno: 51 y 64.
10. Los cinco comandos, verdes, en ese orden.
11. `precache: … KiB (presupuesto 900 KiB)`, con el primer número por debajo de 900.

---

## 5. Criterios de hecho

Binarios y comprobables. Todos tienen que dar sí.

- [ ] `docs/adr/026-despliegue-vps-unico.md` existe, con la tabla de encabezado de seis
      filas, fecha `2026-09-20` y `Estado: Aceptada`.
- [ ] ADR-026 declara que supera **la sección "Topología de despliegue"** de ADR-008, y no
      el ADR entero.
- [ ] ADR-026 cita a ADR-013 como lo que invalidó la justificación original de la fila "API"
      de ADR-008.
- [ ] ADR-026 declara explícitamente las dos desviaciones: sin PITR, y sin restauración de
      prueba en la ventana que ADR-008 pide.
- [ ] ADR-026 nombra los cuatro sustitutos —volcado `pg_dump` fuera de la máquina, snapshots
      de volumen, versioning de MinIO, ensayo de restauración sobre una copia— y remite a
      `08-backups.md` para el cómo.
- [ ] ADR-026 tiene sección "Condición de revisión".
- [ ] `docs/adr/README.md` lista a ADR-026 y marca a ADR-008 como parcialmente superada.
- [ ] `apps/api/src/app.controller.ts` importa `Public` de `./auth/auth.guard` y tiene
      `@Public()` sobre `@Get('health')`.
- [ ] `apps/api/src/app.controller.spec.ts` **no se modificó** y sigue pasando.
- [ ] `.env.example` documenta `VITE_API_BASE_URL`, con el porqué de que es build-time y de
      que un olvido no se arregla sin recompilar.
- [ ] `.env.example` documenta `DEMO_COORDINATOR_PASSWORD` junto a `DEMO_PASSWORD`.
- [ ] `apps/api/scripts/bootstrap-invitation.mjs` falla con
      `Falta DATABASE_URL. Ver .env.example.` cuando la variable no está.
- [ ] `apps/api/scripts/bootstrap-invitation.mjs` **no menciona `NODE_ENV` en ninguna línea.**
- [ ] `apps/api/scripts/reset-password.mjs:203` conserva su guarda de `NODE_ENV`, sin cambios.
- [ ] Ni `create-account.mjs` ni `README.md` afirman que `auth:bootstrap` se niega en
      producción.
- [ ] `apps/api/seeds/004_bootstrap_coordinator.sql` **sigue sin editar**: `git diff` vacío
      para `apps/api/seeds/`.
- [ ] `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm -r build`, `pnpm typecheck` y
      `pnpm test` pasan, en ese orden, sobre un `dist/` limpio.
- [ ] La línea `precache: … KiB (presupuesto 900 KiB)` está registrada, y el número anotado
      en el `07` como referencia para el build de producción.

---

## 6. Si falla

| # | Síntoma observable | Causa probable | Qué hacer |
| --- | --- | --- | --- |
| 1 | `pnpm typecheck` dice que no encuentra `@hs/contracts` o `@hs/forms` | Se corrió antes de `pnpm -r build`. Los dos paquetes se consumen por `exports` → `dist` | Correr `pnpm -r build` y repetir. No agregar paths al `tsconfig` |
| 2 | `pnpm typecheck` no encuentra `Public` desde `app.controller.ts` | El `import` apunta a `./auth/auth.module` o a `@hs/contracts` | `Public` se declara en `apps/api/src/auth/auth.guard.ts:16`. El import correcto es `from './auth/auth.guard'`, igual que en `auth.controller.ts:18` |
| 3 | `grep -n NODE_ENV apps/api/scripts/bootstrap-invitation.mjs` devuelve algo | Alguien agregó la guarda "para alinear el código con la documentación" | **Revertir ese cambio.** Punto de retroceso: `git checkout -- apps/api/scripts/bootstrap-invitation.mjs` y volver a aplicar solo la validación de `DATABASE_URL`. Releer la decisión D4/D5 |
| 4 | `pnpm demo:data` o `pnpm demo:content` dejan de correr en local | La validación de 6.1 se puso en el cuerpo del módulo en vez de adentro de `main()`, y se dispara al importar `issueInvitation` | Mover el `if` adentro de `main()`. Lo importan `reset-password.mjs:5` y `demo-data.mjs` |
| 5 | `curl http://localhost:3000/health` sigue devolviendo error de sesión | El decorador quedó debajo de `@Get('health')`, o en el método equivocado | `@Public()` va **arriba** de `@Get('health')`. Comprobar con el `curl` que manda un Bearer inválido (4.4): tiene que dar `200` |
| 6 | `apps/api/src/app.controller.spec.ts` falla | El spec se modificó, o se cambió lo que devuelve `getHealth()` | El spec no se toca. `@Public()` es solo metadatos y no cambia el valor de retorno. Punto de retroceso: `git checkout -- apps/api/src/app.controller.spec.ts` |
| 7 | `pnpm --filter web build` falla con "El precache supera el presupuesto" | `dist/` sucio, o crecimiento real | Ver 9.4, en ese orden: limpiar y reconstruir; confirmar que no lo causó el `01`; recién después subir `PRECACHE_BUDGET_BYTES` **en un commit propio y solo** |
| 8 | `pnpm --filter web build` falla con "nombra builtins de Node" | Una dependencia transitiva metió un builtin adentro del bundle del service worker (ADR-007) | **No es de este documento y no se resuelve subiendo un presupuesto.** Parar, ver qué dependencia entró, y tratarlo como una violación de ADR-007 |
| 9 | `pnpm install --frozen-lockfile` dice que el lockfile está desactualizado | Alguien cambió un `package.json`. Este documento no toca ninguno | Averiguar qué cambió antes de seguir. `pnpm install` a secas acá esconde el problema hasta el `02`, que construye la imagen |
| 10 | `pnpm install` se niega por la versión de Node | Node por debajo de 22.12 y `engine-strict=true` en `.npmrc` (H1) | Instalar Node ≥ 22.12. No se saltea con `--engine-strict=false`: con Node 20 `apps/api` compila y explota al arrancar |
| 11 | `git diff` muestra `apps/api/seeds/` modificado al terminar | Se ejecutó la edición del seed, que es del `04` | `git checkout -- apps/api/seeds/` y anotar los datos reales para el `04`. **Si además ya se corrió `db:seed` contra una base real, esto deja de ser reversible**: ver la sección 8, Riesgos con datos reales |

**Punto de retroceso general.** Todo lo del `01` son archivos versionados y ninguna
infraestructura. Si algo quedó mal:

```bash
git checkout -- apps/api/src/app.controller.ts apps/api/scripts/ .env.example README.md docs/adr/
rm -f docs/adr/026-despliegue-vps-unico.md
```

y se vuelve a empezar. **Mientras `db:seed` no se haya corrido contra la base de producción,
nada de este documento es irreversible.**

---

## 7. Lo que este documento le pide a otro

Descubierto al ejecutar el `01`, y no resuelto acá por la regla de propiedad de artefactos.

| Para | Qué |
| --- | --- |
| `04-postgres.md` | **Ejecutar la edición del seed**, como precondición de `pnpm db:seed`. La especificación está en el Paso 6: cuatro líneas de datos (51, 52, 53, 64), una de decisión (54), y los UUID de 50, 62, 63 y 78 intactos. Los cuatro datos a tener a mano están en ese mismo paso |
| `04-postgres.md` | Correr `pnpm --filter api test:int` si se quiere una comprobación de integración: necesita Docker y no pertenece al preflight (9.5) |
| `07-entorno-y-release.md` | `VITE_API_BASE_URL` ya está en `.env.example` con su bloque de comentario. Falta su **valor** de producción en la matriz. Es del grupo C, build-time, y no la valida nadie |
| `07-entorno-y-release.md` | Anotar el número que imprimió `precache: … KiB` en este preflight. Es la línea de base contra la que se compara el build de producción del `06` |
| `06-cliente-web.md` | El build del cliente tiene que recibir `VITE_API_BASE_URL` **en el paso de construcción**, no en el de servir. Un `dist/` construido sin ella queda con `http://localhost:3000` horneado y solo se arregla reconstruyendo |
| `03-infraestructura.md` | El healthcheck del servicio `api` puede apuntar a `GET /health` sin token a partir de este documento. Devuelve `200` con `{"status":"ok","service":"api"}` |
| `08-backups.md` | ADR-026 le asigna, por nombre, los cuatro sustitutos del PITR: volcado `pg_dump` fuera de la máquina, snapshots del volumen del proveedor, versioning de MinIO y el ensayo de restauración sobre una copia. ADR-026 dice **qué**; `08` es el único dueño del **cómo** |
| `09-puesta-en-marcha.md` | `pnpm auth:bootstrap` **corre en producción** y es el único camino a la primera credencial. No lleva guarda de `NODE_ENV` y no se le agrega (D4/D5). Sí exige `DATABASE_URL`, que ahora falla con un mensaje claro |
| `09-puesta-en-marcha.md` | Recordatorio de H16: con **un solo** coordinador, si se bloquea o pierde la contraseña no hay salida — `auth:reset-password` sí se niega en producción, y su negativa se conserva. Por eso el `09` da de alta **dos** cuentas administrativas |
| `10-operacion.md` | La ventana de pérdida de datos pasa a medirse en el período entre volcados, no en segundos. ADR-026 lo declara como propiedad del sistema, y `10` es quien la vigila |
| — | **Fuera de la secuencia de despliegue:** hay dos archivos numerados ADR-024 en `docs/adr/` (`024-renombre-de-roles.md` y `024-reportante-ejecuta-la-accion.md`), y el índice solo lista el segundo. No afecta al `026`. Se anota para quien mantenga el índice |

---

## 8. Riesgos con datos reales

Este documento no toca ninguna base, y sin embargo prepara los dos errores más caros de
toda la secuencia. Los dos se cometen acá y se pagan más adelante.

### R1 — El seed sin editar. Irreversible por ADR-002

**Qué es.** Si el seed llega al `04` con `BOOTSTRAP-0001`, `Health and Safety Coordinator` y
`coordinator@example.com`, `pnpm db:seed` inserta esa persona y esa cuenta en la base de
producción.

**Por qué no tiene deshacer.** ADR-002: `hs_app` no tiene `UPDATE` ni `DELETE` por default y
este sistema **nunca borra**; lo que hay es `deactivated_at`. La persona de relleno queda en
el roster real y en la cadena de auditoría **para siempre**, y el alta escribe entradas
encadenadas en las dos plantas. El email de la cuenta sí se corrige desde la administración
—el seed lo dice en su línea 58— pero eso deja un `UPDATE` auditado sobre una fila que
nunca debió existir, no la borra.

**El agravante que casi nadie ve.** El `roster:import` es un **upsert por
`employee_number`**. Con el legajo de relleno sembrado, la primera importación real del
roster **no corrige** esa fila: **crea una segunda**. El coordinador queda duplicado en el
roster, con dos identidades de persona, una de ellas vinculada a la cuenta que firma. El
propio seed lo advierte en sus líneas 44-47.

**Cómo se evita.** El Paso 6 especifica la edición y el `04` la bloquea como precondición
de `db:seed`. **Nadie corre `db:seed` en producción sin haber verificado antes que el seed
tiene los datos reales.** Es una comprobación de diez segundos:

```bash
grep -n "BOOTSTRAP-0001\|coordinator@example.com" apps/api/seeds/004_bootstrap_coordinator.sql
```

Si devuelve algo, **parar**.

**El riesgo simétrico, del mismo tamaño.** Editar los **UUID** en vez de los datos. Son
literales fijos que nombran por valor `bootstrap-invitation.mjs:26`,
`seeds/005_inspection_schedules.sql:35` y `:51`, y `test/helpers/identity.ts:18-19`. Con el
UUID de la cuenta cambiado, `pnpm auth:bootstrap` sin argumentos no encuentra a quién
invitar y el seed `005` falla al declarar `app.user_id`. Se cambian **los datos**, se
conservan **los ids**.

### R2 — La guarda de `NODE_ENV` agregada a `auth:bootstrap`

**Qué es.** Un ejecutor lee `create-account.mjs`, ve que afirma que `auth:bootstrap` se
niega en producción, comprueba que el script no tiene la guarda, y "arregla la
inconsistencia" agregándola.

**Qué rompe.** `POST /auth/invitations` exige una sesión administrativa. En una instalación
nueva no hay ninguna: la cuenta del seed existe, no tiene credencial, y no puede iniciar
sesión. `auth:bootstrap` es **el único** camino a esa primera credencial, y con
`NODE_ENV=production` puesto en el servicio `api` (grupo A de la matriz de variables), la
guarda se dispara siempre. **El sistema queda sin ninguna forma de emitir la primera
credencial**, y no hay una segunda puerta: `auth:reset-password` sí se niega, y
`auth:create-account` crea cuentas sin credencial.

**El detalle que lo hace peor.** No se descubre al agregar la guarda. Se descubre en el
`09-puesta-en-marcha.md`, con la infraestructura entera levantada, la base migrada y
sembrada, y el coordinador real esperando el link de su invitación.

**Cómo se evita.** Este documento corrige la prosa —que es la causa— en `create-account.mjs`
y en las dos líneas del `README.md` de la raíz, y deja escrito en el propio comentario del
script: *"No le agregues la guarda."* La comprobación de 6.5 es la que lo detecta:

```bash
grep -n "NODE_ENV" apps/api/scripts/*.mjs
```

Tres archivos —`demo-data.mjs`, `reset-password.mjs`, `demo-content.mjs`— y
`bootstrap-invitation.mjs` **no** entre ellos.

### R3 — `VITE_API_BASE_URL` olvidada en el build

Menor que los dos anteriores porque **sí tiene deshacer**, pero conviene nombrarlo acá
porque es donde la variable entra al repositorio. Un bundle construido sin ella apunta a
`http://localhost:3000`, no falla en ningún log del servidor, y falla en todos los
dispositivos a la vez. El agravante es el service worker: un teléfono que ya instaló ese
bundle se lo queda hasta que el `sw.js` nuevo lo reemplace (H10). Se arregla reconstruyendo
y volviendo a publicar. Es del `06` y del `07`; acá solo queda documentada.
