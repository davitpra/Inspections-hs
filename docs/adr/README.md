# Decisiones de arquitectura

Este directorio reemplaza a `Stack_Tecnologico_V1.md`, que queda disuelto. Cada decisión vive
en su propio archivo con estado propio y puede ser superada sin editar el pasado.

**Documento de requisitos:** `docs/requisitos-v1.2.md`
**Contexto inyectado a los agentes:** `openspec/config.yaml` (campo `context`)

---

## Principio rector

El documento de requisitos identifica tres propiedades caras (§2): inmutabilidad, PWA
offline-first y builder visual de plantillas.

**Dos de las tres son mucho más baratas de lo que el enunciado sugiere**, porque los
no-objetivos ya recortaron su parte difícil. El stack se elige para materializar ese ahorro.

| Propiedad             | Costo asumido en v1     | Costo real dado los no-objetivos               |
| --------------------- | ----------------------- | ---------------------------------------------- |
| Offline-first         | Motor de sincronización | Caché de lectura + outbox de un solo envío     |
| Inmutabilidad         | Event sourcing          | Append-only forzado por Postgres               |
| Builder de plantillas | Alto                    | Alto — sin cambios. Sigue siendo la pieza cara |

El builder es el único costo que no se reduce. Todo el presupuesto de complejidad del proyecto
debe ir ahí — y por eso se construye **último** (`docs/requisitos-v1.2.md` §7): el sistema es
utilizable con plantillas cargadas como seeds en SQL, así que un atraso en el builder no
bloquea el recorrido crítico.

---

## Índice

| ADR                                         | Decisión                                          | Estado   |
| ------------------------------------------- | ------------------------------------------------- | -------- |
| [001](001-offline-is-not-sync.md)           | El offline no es sincronización                   | Aceptada |
| [002](002-engine-enforced-immutability.md)  | Inmutabilidad forzada por la base, no event sourcing | Aceptada |
| [003](003-vite-client-not-nextjs.md)        | Cliente con Vite, no Next.js                      | Aceptada |
| [004](004-postgres-drizzle-rls.md)          | PostgreSQL + Drizzle + Row Level Security         | Aceptada |
| [005](005-pg-boss-not-bullmq.md)            | pg-boss, no BullMQ + Redis                        | Aceptada |
| [006](006-object-storage-and-pdf.md)        | Almacenamiento de objetos versionado              | Aceptada |
| [007](007-pnpm-monorepo.md)                 | Monorepo con pnpm workspaces                      | Aceptada |
| [008](008-system-architecture.md)           | Arquitectura del sistema                          | Aceptada |
| [009](009-data-residency.md)                | Residencia de datos (ex-S1)                       | Aceptada |
| [010](010-target-devices.md)                | Dispositivos objetivo: Android (ex-S2)            | Aceptada |
| [011](011-authentication.md)                | Autenticación: better-auth en apps/api (ex-S3)    | Parcialmente superada por ADR-022 |
| [012](012-css-tokens-not-tailwind.md)       | CSS con tokens semánticos, no Tailwind + shadcn   | Aceptada |
| [013](013-retirada-reportes-cumplimiento.md) | Retirada preproducción del reporte de cumplimiento | Aceptada |
| [014](014-retirada-clasificacion-riesgo.md)  | Retirada preproducción de la clasificación de riesgo | Aceptada |
| [015](015-retirada-recurrencia-hallazgos.md) | Retirada preproducción de la recurrencia de hallazgos | Aceptada |
| [016](016-evidencia-de-cierre-opcional.md) | Evidencia de cierre opcional                    | Aceptada |
| [017](017-quien-abre-la-accion-correctiva.md) | Quien reportó el hallazgo también abre la acción correctiva | Superada parcialmente por ADR-025 |
| [018](018-enmiendas-de-asignacion.md) | La asignación se enmienda antes de iniciar el trabajo | Superada |
| [019](019-el-coordinador-verifica-lo-que-ejecuto.md) | El coordinador de H&S verifica lo que él mismo declaró hecho | Superada parcialmente por ADR-025 |
| [020](020-asignacion-editable-hasta-el-cierre.md) | La asignación es editable hasta el cierre | Superada |
| [021](021-asignacion-congelada-al-declarar-el-trabajo.md) | La asignación se congela al declarar el trabajo hecho | Aceptada |
| [022](022-reduccion-de-roles.md) | Tres roles y dos autoridades administrativas | Aceptada |
| [023](023-membresia-jhsc-por-rol.md) | Membresía del JHSC derivada del rol | Aceptada |
| [024](024-reportante-ejecuta-la-accion.md) | Quien reportó el hallazgo también ejecuta la acción | Aceptada |
| [025](025-management-y-las-acciones-correctivas.md) | Management comparte las facultades administrativas sobre acciones correctivas | Aceptada |

Los ADR 001–008 conservan la numeración original citada en el encabezado de
`docs/requisitos-v1.2.md`. Los 009–011 eran las "decisiones de contexto resueltas" S1, S2 y S3:
son ADRs en todo salvo el nombre y se promueven para que los agentes las lean igual que al resto.

ADR-022 supera únicamente el ciclo de vida del auditor externo y la excepción de registro de
lecturas de ADR-011. Sus decisiones sobre autenticación, invitaciones y sesiones siguen vigentes.

---

## Stack consolidado

| Capa                  | Elección                                 | ADR      |
| --------------------- | ---------------------------------------- | -------- |
| Cliente               | Vite + React + TanStack Router / Query   | 003      |
| UI                    | CSS con tokens semánticos, sin framework | 012      |
| Almacén offline       | Dexie (IndexedDB)                        | 001      |
| Service worker        | Serwist                                  | 001      |
| Validación compartida | Zod (cliente y servidor, mismo paquete)  | 007      |
| API                   | NestJS                                   | 008      |
| Base de datos         | PostgreSQL + RLS                         | 004      |
| ORM / migraciones     | Drizzle                                  | 004      |
| Trabajos programados  | pg-boss                                  | 005      |
| Archivos              | S3-compatible con versioning             | 006, 013 |
| PDF                   | No hay renderer de documentos            | 013      |
| Tests de integración  | Vitest + Testcontainers                  | —        |
| Monorepo              | pnpm workspaces                          | 007      |
| Hosting API           | Plataforma de contenedores, región única | 008, 009 |
| Hosting cliente       | CDN estático                             | 008      |
| Backups               | PITR ≥ 7 días + versioning de objetos    | 008      |

El paquete de esquema compartido no es opcional: la validación de la plantilla tiene que
correr idéntica en el dispositivo offline y en el servidor al recibir el envío.

La UI son dos capas de tokens en `apps/web/src/index.css` y un check que las hace condición
del build. ADR-012 tiene el detalle y, sobre todo, las dos objeciones que hay que responder
antes de proponer Tailwind o shadcn: `check-tokens.mjs` se queda ciego ante una utilidad
como `bg-emerald-600` —no es un literal ni un `var()`—, y el precache tiene un presupuesto
medido, que es donde se paga cada primitiva de Radix.

---

## Spikes obligatorios

Los tres spikes **no son ADRs**: son criterios de aceptación. Cada uno entra como
`#### Scenario:` en el spec del change que lo cierra, y desde ahí corre en CI.

| Spike | Qué prueba                                                          | Change que lo cierra                | ADR      |
| ----- | ------------------------------------------------------------------- | ----------------------------------- | -------- |
| 1     | Outbox de punta a punta: inspección con 5 fotos en modo avión, cerrar app, reconectar. Un solo registro; reenviar el mismo `client_submission_id` no duplica. En Android real | `offline-inspection-capture`        | 001, 010 |
| 2     | Inmutabilidad verificada: `UPDATE` y `DELETE` sobre una inspección enviada con el rol de la app fallan a nivel de motor | `bootstrap-immutable-persistence`   | 002      |
| 3     | Identidad dual del ítem: tres versiones sucesivas con ediciones realistas devuelven una serie de 4, no 1+2+1 | `template-versioning-item-identity` | 004      |

El spike 3 no es una prueba manual: entra al repositorio como test de integración el primer
día y corre en cada commit.

---

## Convención de superación

Ningún ADR se edita para cambiar de opinión. Se escribe uno nuevo:

1. Nuevo archivo con el siguiente número disponible.
2. En el nuevo: `Supersede: ADR-00X`.
3. En el viejo: `Estado: Superada` y `Superada por: ADR-0YY`. Es la única edición permitida.
4. El índice de arriba refleja el cambio de estado.

Correcciones de tipeo y links rotos sí se editan en el lugar.
