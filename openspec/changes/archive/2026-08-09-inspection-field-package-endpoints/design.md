## Context

Ver `proposal.md` — Why, y `specs/inspections/spec.md` para los requisitos.

Estado de partida, que es casi todo lo que este change necesita:

- `apps/web/src/offline/prefetch.ts` ya pide las tres rutas, ya parsea sus respuestas con
  Zod y ya las guarda en las tres filas de `prefetch`. Sus esquemas llevan una nota que
  dice que son un supuesto declarado mientras el servidor no exista. **Este change hace
  que la nota deje de ser cierta**, y borrarla es parte del trabajo.
- `apps/api/src/uploads/uploads.service.ts` resuelve exactamente el mismo problema de
  alcance: lee `scheduled_inspection` dentro de `withSessionScope` y rechaza si la
  transacción no la ve. Las tres rutas nuevas necesitan esa misma resolución.
- `template_version.document` es una columna `jsonb` con el documento completo. No hay
  nada que reconstruir.
- `location` y `person` llevan `site_id` y política RLS. `template_version` no lleva
  `site_id`: se alcanza únicamente a través de la inspección.
- `packages/contracts` ya expone `locationOptionSchema` y `personOptionSchema`, que son
  literalmente las dos formas que el dispositivo espera.

Restricciones que no se re-discuten acá:

- **ADR-002** — el aislamiento por planta lo aplica la política RLS, nunca un `WHERE` del
  endpoint.
- **ADR-007** — el cliente consume DTOs de `packages/contracts`; el esquema Drizzle no sale
  de `apps/api`. El documento de plantilla es de `@hs/forms` y `@hs/contracts` lo re-exporta.
- **ADR-011** — el alcance sale de la sesión resuelta por el guard y de ningún otro lado.
- **ADR-001** — la descarga previa baja las tres piezas por separado; el dispositivo no
  sincroniza, descarga.

**Tablas inmutables tocadas: ninguna.** Las tres operaciones son lecturas y este change no
escribe una sola fila en Postgres. Tampoco hay migración: no se crea ni se altera ninguna
tabla.

## Goals / Non-Goals

**Goals:**

- Que el dispositivo pueda quedar listo para el campo con las rutas que ya llama, sin
  cambiar una línea de su lógica de descarga.
- Que el contrato del paquete de campo sea uno solo y viva en `packages/contracts`, de modo
  que un desajuste entre las dos mitades sea un error de compilación y no un `safeParse`
  que falla en una planta.
- Que la garantía de congelamiento —la v3 no mueve una inspección atada a la v2— quede
  probada del lado del servidor y no solo del dispositivo.

**Non-Goals de diseño:**

- Caché HTTP, `ETag` o `If-None-Match`. El dispositivo ya cachea en Dexie y la descarga
  previa es un acto deliberado del inspector, no un `poll`. Agregar revalidación sería
  agregar un camino de red a un flujo cuyo objetivo es no tener ninguno.
- Paginación del roster. Son ~200 personas por planta (contexto del proyecto) y la
  respuesta entra en decenas de kilobytes; paginar acá sería complejidad al servicio de un
  problema que este sistema no tiene.
- Unificar el código de error de `POST /uploads/presign` con el del resto del controlador
  de inspecciones. Ver D6.

## Decisions

### D1 — Tres rutas y no una

Una sola `GET /scheduled-inspections/:id/field-package` sería una respuesta más chica de
escribir y una peor de usar: el requisito es que un fallo parcial deje evidencia de **qué**
falta, y con una respuesta única el único fallo posible es "todo o nada".

Es la misma decisión que D5 de `offline-inspection-capture` tomó del lado del dispositivo
—tres filas de `prefetch`, "listo para el campo" = las tres presentes— y las dos mitades
tienen que coincidir para que `missingForField()` pueda nombrar el roster.

**Alternativa considerada:** una ruta única con las tres piezas y un campo de errores
parciales por pieza. Reproduce el mismo comportamiento con un contrato más raro, y hace que
reintentar solo el roster requiera pedir de nuevo el documento entero, que es la parte cara.

### D2 — Las tres cuelgan de la inspección, no del sitio ni de la plantilla

`GET /sites/:id/locations` y `GET /templates/:id/versions/:v` serían las rutas "naturales"
por recurso, y son las equivocadas para esto por dos motivos distintos:

1. **El alcance.** Colgando de la inspección, la autorización es una sola pregunta —¿esta
   cuenta ve esta inspección?— resuelta por RLS sobre una tabla que ya tiene política. Con
   rutas por recurso habría tres preguntas de alcance distintas, y la de `template_version`
   no tendría respuesta, porque esa tabla no lleva `site_id`.
2. **El significado.** Lo que el dispositivo pide no es "el catálogo": es "lo que esta
   inspección necesita". Que la ruta lo diga es lo que impide que mañana alguien le agregue
   un filtro por texto y la convierta en una API de catálogo por la puerta de atrás.

### D3 — El filtro por `site_id` en catálogo y roster es de SELECCIÓN, no de seguridad

Las consultas de ubicaciones y de roster llevan `WHERE site_id = <el de la inspección>`, y
eso **parece** exactamente lo que ADR-002 prohíbe. No lo es, y la diferencia es la que hay
que tener escrita para que un revisor no la tenga que reconstruir:

- El límite de **seguridad** lo pone la política RLS: una cuenta sin alcance en la planta no
  ve la inspección, y sin la inspección la consulta no llega a correr. Si esa política
  desapareciera, el `WHERE` de acá no salvaría nada.
- El `WHERE` elige **cuál de las plantas del alcance** corresponde. El coordinador tiene
  alcance a las dos y RLS le deja ver las ubicaciones de las dos; devolverle las de St.
  Thomas para una inspección de Glencoe no sería una fuga, sería un desplegable con
  ubicaciones de la planta equivocada.

La prueba que separa las dos: quitar el `WHERE` produce un bug de producto (opciones de
más, todas dentro del alcance); quitar la RLS produciría un bug de seguridad. El test de
integración de la tarea correspondiente afirma las dos mitades por separado.

### D4 — El documento se sirve tal cual desde `template_version.document`

Sin reconstruirlo desde `template_version_item`. Esas filas existen para consultar —la
recurrencia de un ítem a través de versiones— y la migración `0007` las proyecta *desde* el
documento con un trigger. La fuente de verdad para validar es la columna, y `templates` ya
lo dice.

Reconstruir sería introducir una segunda representación del mismo documento, que es
precisamente lo que el motor evita, y abriría la posibilidad de que el dispositivo
interprete algo que el servidor no re-validaría igual.

### D5 — Los esquemas de respuesta se mudan a `packages/contracts`

Nuevo `packages/contracts/src/field-package.ts` con las tres respuestas. `apps/web` importa
de ahí y **borra** sus definiciones locales junto con la nota del supuesto declarado.

No es una limpieza cosmética: mientras los esquemas vivan en el cliente, el servidor puede
cambiar de forma y nada se rompe hasta que un inspector se queda sin poder prepararse. Con
el contrato compartido, el servicio de `apps/api` tipa contra el mismo objeto y el desajuste
aparece en `pnpm typecheck`.

`site_id` viaja en la respuesta de la versión de plantilla, tal como el dispositivo ya lo
espera: es lo que le permite saber de qué planta es el borrador sin red.

### D6 — La resolución de la inspección se extrae y se comparte; el código de error se alinea con `inspections`

Las cuatro rutas —las tres nuevas y `POST /uploads/presign`— hacen la misma pregunta.
Se extrae un solo lugar que resuelve "la inspección visible y no cancelada, o nada", y las
cuatro lo usan.

**Una tensión declarada:** hoy `presign` responde `403 forbidden` a esa condición y el resto
del controlador de inspecciones responde `404 inspection_not_found`. Las rutas nuevas usan
`inspection_not_found`, porque viven en ese controlador y dos convenciones dentro de un
mismo archivo son peores que una convención discutible. `presign` **no se cambia acá**:
su comportamiento ya está especificado en `offline-capture` ("rejected as forbidden") y
cambiarlo sería modificar una capability que este change no declara. Queda anotado como
divergencia conocida; unificarla es un change propio y chico.

Ninguna de las dos filtra información: las dos son la misma respuesta para "no existe",
"está cancelada" y "es de la otra planta", que es la propiedad que el requisito pide.

### D7 — Una inspección cancelada no sirve paquete de campo

Misma regla que `presign`, y por el mismo motivo: preparar para el campo una inspección
cancelada es preparar un recorrido que no hay que hacer. El dispositivo trata el fallo como
"no lista", que es exactamente lo que corresponde mostrar.

El caso incómodo —el inspector ya la preparó y después la cancelan— no se resuelve acá: el
borrador local sigue existiendo y el envío lo rechazará la ingesta. Es el comportamiento
correcto y es responsabilidad de `submission-ingestion-endpoint`.

## Risks / Trade-offs

- **El roster completo en una respuesta** → ~200 personas por planta, con cuatro campos cada
  una. Decenas de kilobytes, bajados una vez con red, en el paso en el que el inspector está
  esperando a propósito. Si una planta creciera un orden de magnitud, paginar es un cambio
  local a una ruta que ya está aislada.
- **El documento de plantilla puede ser grande** → Es el mismo `jsonb` que el servidor ya
  guarda y que el dispositivo ya tiene que poder interpretar entero. No hay una versión
  reducida que sirva: la validación necesita el documento completo (ADR-007).
- **Cuatro rutas dependen de un solo resolutor de inspección (D6)** → Un bug ahí las afecta
  a las cuatro. Es el intercambio deliberado: una implementación con un test de alcance que
  las cubre, en vez de cuatro copias donde la tercera se olvida de `cancelled_at`.
- **La divergencia 403/404 sobrevive a este change (D6)** → Anotada, no arreglada. El costo
  es una inconsistencia visible en la API; arreglarla acá significaría tocar una capability
  no declarada, que es peor.
- **`GET` con parámetro de ruta y sin caché** → Cada preparación vuelve a bajar todo. Es
  deliberado (Non-Goal): la preparación es un acto explícito y poco frecuente, y una caché
  mal invalidada sería un documento viejo interpretado sin red.

## Migration Plan

No hay migración de datos ni de esquema: tres rutas de lectura sobre tablas que ya existen.

El despliegue es del servidor primero y del cliente después, y ese orden importa poco porque
el cliente ya tolera el fallo: hoy las rutas devuelven 404 y la inspección se muestra como no
lista para el campo, que es la degradación correcta. Desplegar el servidor la convierte en
lista sin que el dispositivo cambie.

Rollback: revertir el build de la API devuelve el estado actual —inspecciones que no se
pueden preparar—, sin pérdida de datos y sin dejar nada a medias en el dispositivo: lo que
ya se bajó queda en Dexie y sigue siendo válido, porque el documento congelado no envejece.
