# Identidad, roles e importación del roster

## Why

El segundo dolor de Atlas (`docs/Requisitos_V1.2.md` §2) es que **agregar a una persona al
roster exige darle una cuenta**, y como nadie quiere darle acceso al sistema a 200 personas, el
roster queda desactualizado. La consecuencia medida está en la tabla de métricas de §2:
*"incidentes bloqueados por roster desactualizado: 0"* — hoy no es 0, porque el supervisor abre
el formulario, no encuentra a la persona en el selector y abandona el reporte.

La decisión que lo resuelve ya está tomada y es la más importante del modelo (§4, "La distinción
central"): **Persona ≠ Usuario**. Persona es el registro del roster —200 y pico, la mayoría no
inicia sesión nunca— y existe para poder ser sujeto de un incidente o responsable de una acción.
Usuario es la cuenta, un subconjunto de 15 a 20, y siempre apunta a una Persona. Un supervisor
nombra a una Persona sin que eso le dé acceso a nadie y sin ver su perfil.

Este change cierra la **segunda mitad de la etapa 2** de §7 ("Sitio, Persona, Usuario, auth,
importación CSV del roster"): la primera mitad —`site` y `location`— ya está. Lo que queda es
`person`, la cuenta con su rol y su alcance, y la vía por la que entran 200 personas, que la
pregunta cerrada 3 de §6 resolvió como **importación por CSV, manual y controlada**, no
sincronización con ADP.

Va ahora porque tres cosas lo están esperando: `audit_log.actor_user_id` es un `uuid` sin FK
desde la etapa 0; `location` tiene `GRANT UPDATE (name, deactivated_at)` para "el coordinador"
con un comentario que dice que el rol lo trae `identity`; y las etapas 4, 5 y 6 no pueden
escribir una fila sin una Persona real a la que apuntar — una acción correctiva sin responsable
nombrado (R3) y un incidente sin sujeto (R4) no son registros.

**La autenticación queda fuera y es deliberado.** ADR-011 elige better-auth dentro de
`apps/api`; el login, la sesión, la contraseña y el TOTP son un change propio. Acá se construye
*a quién* se autentica y *qué alcanza*, que es lo que el resto del sistema necesita y lo que
better-auth no decide.

## What Changes

- **`person`** — el registro del roster. Identificada por **número de empleado de ADP**, no por
  nombre (§4). `site_id` obligatorio con política RLS: el selector de sujeto de un supervisor de
  St. Thomas ofrece personas de St. Thomas. `deactivated_at` para la baja lógica: una persona
  que se fue no se borra nunca —queda referenciada en registros inmutables— y desaparece del
  selector.
- **`app_user`** — la cuenta. Siempre apunta a una `person`, y una persona tiene como mucho una
  cuenta. Lleva el rol, la fecha de baja y, para el auditor externo, el vencimiento. **No lleva
  credenciales**: la tabla existe y una cuenta creada acá todavía no puede iniciar sesión, que
  es exactamente el estado correcto hasta el change de auth.
- **Cinco roles, exactamente uno por cuenta** — `hs_coordinator`, `jhsc_member`, `supervisor`,
  `management`, `external_auditor`, forzados por `CHECK` en el motor. Se adopta el término
  `jhsc_member` que fija la nota de vocabulario de §4: "inspector" y "miembro del JHSC" son la
  misma cosa y el proyecto elige una sola palabra.
- **`user_site_scope`** — el alcance por sitio de una cuenta, como filas y no como arreglo, con
  `granted_at`/`revoked_at` porque quitar un alcance tampoco es un `DELETE`. Es lo que alimenta
  `app.site_ids` y por lo tanto lo que hace cierta la pregunta cerrada 5: un miembro del JHSC de
  St. Thomas no ve Glencoe; solo coordinador y gerencia tienen los dos sitios.
- **El ciclo de vida del auditor externo, forzado por el motor** — riesgo I de §5:
  `expires_at` **obligatorio** para ese rol y prohibido para los demás, máximo 90 días desde el
  alta, sin renovación automática, revocable en cualquier momento. Es un `CHECK`, no una regla
  de servicio.
- **Importación del roster por CSV** — pregunta cerrada 3. Un comando que lee un archivo,
  aplica las filas válidas y **reporta fila por fila las rechazadas con su motivo**. Las
  aceptadas y el reporte se confirman en una sola transacción: no existe la importación a
  medias.
- **`roster_import` y `roster_import_rejection`** — el reporte de la importación queda como
  registro, no solo como salida en pantalla. Tablas inmutables: quién importó, cuándo, cuántas
  filas entraron, cuántas se rechazaron y por qué.
- **Ausencia del archivo no da de baja a nadie.** Una persona se desactiva porque el CSV lo dice
  en su columna de estado, nunca porque no aparezca. Un archivo parcial cargado por error no
  puede vaciar el roster.
- **Alta, cambio de nombre, transferencia de planta, baja y reactivación de persona, y todo el
  ciclo de vida de una cuenta y de su alcance, entran al log de auditoría escritos por trigger**,
  como el catálogo en la etapa 2a. Los eventos de cuenta se escriben en la cadena de cada sitio
  de su alcance: "a quién se le dio acceso a esta planta" es parte del registro de esa planta.
- **FK de `audit_log.actor_user_id` → `app_user(id)`**, la referencia que la etapa 0 dejó sin
  poner porque la tabla no existía. Cierra el requisito de ADR-011 de que el actor identifique a
  una persona real.
- **`packages/contracts`** — persona, cuenta, rol, alcance, fila de CSV y reporte de
  importación como esquemas Zod, que es lo que el cliente va a consumir para pintar el selector
  de sujeto y la pantalla de administración del roster.

Fuera de alcance, explícito:

- **Login, sesión, contraseña, TOTP, invitación, recuperación.** ADR-011 y su change propio.
  Este change no instala better-auth ni ninguna de sus tablas.
- **Endpoints HTTP y pantallas.** Sin auth no hay coordinador autenticado a quien exigirle nada,
  así que un endpoint de administración sería una superficie sin dueño. La importación es un
  comando de servidor, como los seeds. El módulo importador se escribe para que el endpoint del
  change de auth lo llame sin reescribirlo.
- **Sincronización con ADP**, en cualquier dirección. La pregunta cerrada 3 la descarta por
  nombre.
- **Varios roles por cuenta, roles a medida, permisos por recurso.** Cinco roles cerrados y uno
  por cuenta.
- **Cuentas compartidas.** ADR-011 las prohíbe: si el `actor_id` no identifica a una persona
  real, la inmutabilidad no prueba nada.
- **Jerarquía organizacional.** Una persona no tiene supervisor asignado. "Quién le reporta a
  quién" no lo necesita ningún requisito de v1.
- **El registro de lecturas del auditor externo.** Es un requisito real (§5 riesgo I) y necesita
  una lectura que registrar; llega con los endpoints de reporte.
- **La ventana de fechas del auditor aplicada a las consultas.** Las columnas y su validación
  están acá; hacerlas valer sobre una lectura es del change que le dé al auditor algo que leer.

## Capabilities

### New Capabilities

- `identity`: persona y cuenta como entidades separadas, roles cerrados, alcance por sitio de
  una cuenta, ciclo de vida del auditor externo, baja lógica que preserva la resolución
  histórica, e importación del roster por archivo con reporte de filas rechazadas.

### Modified Capabilities

- `audit`: se agrega el requisito de que `audit_log.actor_user_id` referencie una cuenta real
  —hasta ahora era un `uuid` libre por orden de construcción—, y el de que los cambios de
  persona, de cuenta y de alcance se auditen sin depender del código de aplicación, incluida la
  regla de a qué cadena de sitio va un evento de cuenta.

## Impact

- **Migraciones** — `apps/api/drizzle/0005_identity.sql`, escrita a mano y registrada a mano en
  `_journal.json`. `drizzle-kit generate` sigue prohibido (ADR-004).
- **Esquema Drizzle** — `apps/api/src/db/schema/identity.ts`, espejo a mano del SQL, reexportado
  desde `schema/index.ts`. Sigue viviendo solo en `apps/api`.
- **`packages/contracts`** — `identity.ts` con los esquemas Zod de persona, cuenta, rol, alcance
  y reporte de importación.
- **Importador** — módulo nuevo en `apps/api/src/roster/`, sin dependencias de NestJS en el
  parseo, más un script `pnpm roster:import <archivo.csv>` que lo invoca.
- **`audit_log`** — `ALTER TABLE ... ADD CONSTRAINT` de la FK a `app_user`. No toca datos ni el
  encadenado: la FK no entra en `hs_audit_canonical`, así que ningún hash cambia.
- **`withSiteScope`** — `app.user_id` deja de ser un uuid arbitrario y pasa a ser un
  `app_user.id` con FK. Los tests que hoy inventan uno tienen que sembrar una cuenta.
- **Seeds** — `apps/api/seeds/004_bootstrap_coordinator.sql`: la primera cuenta de coordinador,
  con alcance a los dos sitios y sin credenciales. Es lo único que rompe el huevo y la gallina —
  sin ella, el change de auth no tiene a quién invitar.
- **Fixtures de test** — los helpers existentes ganan una persona y una cuenta sembradas, para
  que el `actor_user_id` de los tests de auditoría satisfaga la FK nueva.
- **CI** — el job de integración existente cubre el spec nuevo; no hace falta job nuevo.
- **Etapas 4 a 6** — quedan desbloqueadas: `action.responsible_person_id`,
  `action.verifier_person_id` e `incident.subject_person_id` ya tienen a qué apuntar, y el
  selector de sujeto tiene su regla de visibilidad definida por RLS y no por el endpoint.
