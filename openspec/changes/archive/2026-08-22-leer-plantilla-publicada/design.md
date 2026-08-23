## Context

Ver `proposal.md — Why`. Lo que condiciona el diseño y no está allá:

- **`template_version` es inmutable y este change solo la LEE.** ADR-002 / ADR-004: la tabla
  no tiene `UPDATE` ni `DELETE` para ningún rol y su `SELECT` está concedido a `hs_app` desde
  la migración 0003. Este change **no toca ninguna tabla inmutable en escritura** y no lleva
  migración.
- **No lleva `site_id`, así que no hay política RLS detrás.** El aislamiento por sitio (ADR-002)
  no aplica: una plantilla es contenido de referencia de la organización, no un dato de planta,
  y eso ya está escrito como requisito (`The plants a draft named do not travel to the published
  template`). Lo que protege esta lectura es que no hay nada que proteger.
- **El documento ya tiene un lector**: `templateVersionPackage` en `inspections.service.ts` hace
  exactamente este `SELECT version, document FROM template_version WHERE id = $1`, pero llega al
  id por una inspección programada y devuelve el paquete de campo (con `site_id` e
  `inspector_id`). No es reutilizable: ADR-008 prohíbe que `templates` llame a `inspections`, y
  el DTO que necesita esta pantalla no es un paquete de campo.
- **El editor ya dibuja un documento**, pero el de borrador y editable: `SectionCard`, `ItemRow`
  y `ResponseTypeConfig` son controles, no lectura.

## Goals / Non-Goals

**Goals:**

- Una lectura del documento congelado direccionada por la identidad de la versión, no por la
  plantilla.
- Una pantalla que se lea como el registro que es: completa, ordenada y sin un solo control que
  sugiera que se puede tocar.
- Cero privilegios, cero columnas, cero migración.

**Non-Goals (de diseño, además de los del proposal):**

- No se toca `published-version.sql.ts`. Esa expresión resuelve "la más alta publicada" para los
  tres consumidores que congelan; esta lectura no congela nada y no resuelve nada.
- No se reusa ni se generaliza el editor. Ninguna pieza de `TemplateDraftRoute` se convierte en
  "componente compartido con modo readonly".
- No se cachea en Dexie ni entra al precache del service worker.

## Decisions

### 1. `GET /templates/versions/:versionId`, y no `/templates/:id` ni `/templates/:id/versions/latest`

La versión se pide por SU id, que es el `latest_version_id` que `GET /templates` ya entrega.

- Alternativa descartada — **`GET /templates/:templateId`, "dame la última"**: la respuesta
  cambiaría sola el día que exista la versión 2, bajo un enlace que alguien guardó. Es el mismo
  fallo silencioso contra el que está escrito `published-version.sql.ts` y el docblock de
  `GET /scheduled-inspections/:id/template-version` ("El documento congelado. Nunca 'la versión
  más alta publicada'").
- Alternativa descartada — **`GET /templates/:templateId/versions/:versionId`**: el par no aporta
  nada. `template_version.id` es único; el `template_id` del path sería un dato que hay que
  comprobar contra la fila para que no mienta, y comprobarlo es trabajo puesto a defender una
  redundancia que se eligió sola.
- Alternativa descartada — **`GET /template-versions/:id`**: un controlador nuevo para una ruta.
  Las plantillas ya tienen el suyo, y `versions/` no colisiona con `drafts/`.

### 2. La consulta vive en el servicio, no en `templates.repository.ts`

`templates.repository.ts` declara en su cabecera que no toca `template`, `template_item` ni
`template_version` salvo los `SELECT` de `isNameTaken`, y esa propiedad es la que hace que la
autoría no necesite privilegios sobre el modelo publicado. Meter ahí la lectura de una versión
publicada haría falsa la cabecera. `list` ya tiene su consulta escrita en el servicio, con
`withSessionClient`; esta va al lado, por la misma razón y con la misma forma.

### 3. Sin `requireCoordinator`, con `withSessionClient`

`GET /templates` no comprueba rol y esta lectura contesta sobre las mismas filas. Gatearla haría
que la plataforma le negara a un inspector el texto de las preguntas que va a contestar mañana.

`withSessionClient` igual (ADR: `db.service.ts` / `site-scope.ts`): es el camino HTTP. Que la
tabla no tenga política no es motivo para usar `withSiteScope` — eso sería fabricar un alcance
que el request no trae, y la distinción entre los dos métodos existe justamente para que eso no
pase por descuido.

### 4. `template_version_not_found`, un error propio y no uno de borrador

`TemplateDraftErrorCode` enumera los errores de la AUTORÍA de borradores, y una versión
publicada no es un borrador: reusar ese tipo haría que un código de borrador nombrara algo que
no lo es. Se declara en `templates.errors.ts` un `TemplateVersionException` hermano, con su
único código `template_version_not_found` y un `404`.

El id se valida como UUID en el controlador (`z.uuid().parse`), para que un id mal formado
salga como el `400` de Zod y no como el `22P02` de Postgres envuelto en un 500.

### 5. El DTO es plano: identidad + documento

```
{ template_id, template_version_id, key, name, version, published_at, document }
```

`published_at` es `text` (`published_at::text`), como `latest_published_at` en el listado:
`formatDay` recorta la cadena ISO a propósito para leer el registro en el huso en que se guardó.
Convertirlo a `Date` acá y de vuelta allá sería el único lugar del sistema donde la fecha de una
publicación se reinterpreta.

`document` se devuelve tal como está guardado y se valida con `templateDocumentSchema` en el
cliente, como toda respuesta (`request.ts`). No se normaliza ni se reordena en el servidor: el
orden es `position`, y quien lo dibuja usa `sectionsInDocumentOrder` de `@hs/forms`. No se escribe
un segundo `sort`: esa función ya define qué significa "orden del documento" para la visibilidad
y la validación (ADR-007).

### 6. Ruta web `/templates/versions/$versionId` en `PublishedTemplateRoute/`

Carpeta propia, como toda ruta (CLAUDE.md § Rutas). Adentro:

- `index.tsx` — la consulta y la composición.
- `VersionHeader.tsx` — el título, la clave, la versión, la fecha y el aviso de congelado.
- `SectionCard.tsx` / `ItemRow.tsx` — la lectura de una sección y de una pregunta, incluida su
  obligatoriedad, la configuración que corresponda a su `response_type` y la prescripción
  completa de hallazgo. **Nombres iguales a los del editor y archivos distintos a propósito**:
  son otra cosa —los del editor son controles— y compartirlos obligaría a un `readonly` que
  atraviesa los dos.
- `presentation.ts` + `presentation.test.ts` — el conteo de preguntas, la configuración de cada
  tipo de respuesta, el umbral de fallo y el texto de una condición `visible_when` en palabras.

`RESPONSE_TYPE_LABELS` sale de `src/presentation/templates.ts`, que ya cruza rutas: el tipo de
respuesta tiene que llamarse igual acá que en el editor, o el coordinador va a creer que publicó
otra cosa.

El enlace lo pone `PublishedRow.tsx`: el nombre pasa a ser `<Link>`, exactamente como en
`DraftRow`.

### 7. La condición de visibilidad se dice en palabras, no como JSON

Un `visible_when` crudo en pantalla es la estructura, no la regla. `presentation.ts` la traduce
("Shown when *Is the guard in place?* is No") y compone en palabras tanto una condición simple
como `all_of` y `any_of`.

`CONDITION_OPERATORS` de `@hs/forms` enumera operadores, pero no los etiqueta. La ruta declara un
`Record<ConditionOperator, string>` exhaustivo: si el motor agrega uno, el typecheck obliga a
decidir cómo se lee antes de que aparezca crudo. Si un ítem referenciado no está en el documento
—imposible después de `templateDocumentSchema`, pero la función sigue siendo total— se cae al
`item_key`, que es lo único cierto que queda.

### 8. La configuración se presenta por tipo, no como un objeto genérico

`presentation.ts` discrimina por `response_type` y produce líneas legibles para lo que ese tipo
declara: rango de escala; longitud de texto; rango y decimales de número; etiquetas y valores de
opciones; límites de selección; o cantidad de fotos. `yes_no`, `yes_no_na` y `signature` dicen que
no llevan configuración adicional. `required` se presenta por separado porque pertenece a todos
los tipos.

La misma regla aplica a `finding.fails_when`: un `Record<FailureOperator, string>` exhaustivo lo
convierte en "Fails below", "Fails at or below", "Fails above" o "Fails at or above", seguido del
valor. El `corrective_action` conserva su texto tal como quedó publicado. Nada de esto evalúa el
documento ni decide si una respuesta falla; solo vuelve legible el registro congelado.

### 9. La versión publicada tiene una clave de consulta propia

`queryKeys.publishedTemplateVersion(id)` produce `['published-template-version', id]`; no cuelga
de `templates()`. La lista responde cuál es la última versión de cada plantilla y cambia cuando se
publica otra. Esta lectura responde por una identidad inmutable y no necesita invalidarse cuando
cambia la lista.

Tampoco comparte prefijo con `templateVersionPackage`: ese dato es el paquete de campo de una
inspección programada, incluye identidad de sitio e inspector y puede guardarse en el dispositivo.
Dos formas y ciclos de vida distintos no deben ocupar la misma entrada de caché.

## Risks / Trade-offs

- **La pantalla duplica el dibujo del editor** → Es deliberado (decisión 6). El riesgo real es el
  inverso: un componente con `readonly` que se usa en los dos lados hace que un cambio pensado
  para el editor cambie el registro que alguien está leyendo como evidencia.
- **Un documento largo es una página larga, sin paginado ni índice** → Aceptado en este change.
  Las plantillas de v1 tienen decenas de preguntas, no cientos; el índice es una mejora que se
  puede agregar sin cambiar ni el endpoint ni el contrato.
- **Mostrar toda la configuración hace cada pregunta más densa** → Aceptado: esta pantalla existe
  para comprobar qué se publicó, no para responder rápido. Las etiquetas reemplazan nombres de
  campo y JSON, pero no ocultan decisiones que cambian cómo se completa una inspección.
- **La API de lectura no está gateada por rol y el enlace vive en una consola que sí** → Es una
  asimetría querida (decisión 3), pero deja una ruta alcanzable escribiendo la URL para un rol que
  no ve el enlace. No expone nada: el contenido es el mismo que ese rol responde en campo.
- **El `latest_version_id` que la fila enlaza puede quedar viejo** el día que exista la versión 2
  y otro coordinador publique mientras esta pantalla está abierta → El enlace sigue abriendo una
  versión que existe y que se identifica en pantalla por su número. Es exactamente el
  comportamiento que la decisión 1 compra.

## Migration Plan

No hay migración. Se despliega API y web juntos; la web nueva no funciona contra una API vieja
(404 en la ruta), y una API nueva con la web vieja no cambia nada porque nadie llama al endpoint.
Rollback: revertir el commit.
