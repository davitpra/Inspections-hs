# Read a published template

## Why

**La etapa 8 de `docs/Requisitos_V1.2.md` §7 dejó escribir plantillas y publicarlas, pero no
volver a leerlas.** El coordinador publica un borrador, el borrador desaparece de la lista y
`published-templates-in-console` le dice que la publicación existe: nombre, clave, versión y
fecha. Nada más. Las preguntas que escribió durante días quedan guardadas en un lugar del que
la interfaz no las sabe sacar.

Hoy el documento congelado de una `template_version` se puede leer de UNA sola forma:
`GET /scheduled-inspections/:id/template-version`, es decir, teniendo una inspección programada
contra esa versión. Para releer lo que publicó, el coordinador tiene que programar una
inspección — o abrir la base. Es exactamente el viewer que
`published-templates-in-console` declaró fuera de su alcance y dejó pendiente.

Sin él, publicar es un movimiento sin vuelta atrás Y sin confirmación: el borrador se consume
(`Publishing consumes the draft`), y lo que queda del otro lado no se puede mirar. Cierra
etapa 8 como recorrido completo — escribir, publicar, comprobar qué quedó escrito.

## Lo que este change NO es

- **No es un historial de versiones.** La pantalla lee UNA versión, la que la lista nombra.
  Publicar una segunda versión de una plantilla existente todavía no existe (`insertVersion`
  escribe `version = 1`), así que un historial sería una lista de un elemento.
- **No es editar, corregir ni retirar lo publicado.** Ningún privilegio nuevo: la lectura es
  `SELECT`, que `hs_app` ya tiene desde 0003. `template.deactivated_at` sigue fuera de alcance.
- **No es "empezar un borrador a partir de esta versión".** Es la revisión, y necesita decidir
  qué pasa con `item_key` — el change que la haga va a apoyarse en esta lectura, no al revés.
- **No es una previsualización rellenable.** No se responde nada; no hay `@hs/forms`
  evaluando visibilidad ni validando respuestas. Es el documento leído, no el formulario
  corriendo.
- **No es offline.** Como el resto de `/templates`: se lee sentado y con conexión. La copia
  offline de una plantilla existe ya, y es el paquete de campo de una inspección concreta.

## What Changes

- **Una lectura nueva: `GET /templates/versions/:versionId`.** Devuelve la versión congelada
  por SU PROPIO id —el `latest_version_id` que el listado ya entrega—, nunca "la más alta
  publicada": la pantalla que lee tiene que poder decir qué documento está mirando, y una
  ruta que resuelve la última haría que la respuesta cambiara sola bajo un enlace guardado.
  Es la misma propiedad que protege `GET /scheduled-inspections/:id/template-version`.
- **La respuesta trae identidad + documento**: `template_id`, `template_version_id`, `key`,
  `name`, `version`, `published_at` y el `document` que valida `templateDocumentSchema`. La
  identidad viaja con el documento porque una versión sin su propia identidad y la de su
  plantilla no se puede nombrar ni enlazar sin depender del request que la trajo.
- **Sin comprobación de rol, igual que `GET /templates`.** Una plantilla publicada es
  contenido de referencia de la organización, no un dato de sitio: `template_version` no lleva
  `site_id` y no tiene política RLS detrás. La responde el mismo catálogo que ya le dice a
  cualquiera qué versiones existen; negar el contenido a quien va a contestarlo en campo sería
  una restricción sin nada que proteger.
- **Una ruta nueva de solo lectura: `/templates/versions/$versionId`.** Las secciones en su
  orden, con su ubicación de organización si la declaran; las preguntas en el suyo, con su
  etiqueta de tipo de respuesta, si es obligatoria, la configuración concreta de ese tipo, su
  `item_key`, su condición de visibilidad y la prescripción completa de hallazgo cuando la hay:
  acción correctiva y umbral de fallo. Los `position` se leen en el orden, no como números; el
  `section_key` no cambia cómo se completa el documento y no se expone como dato de interfaz.
- **La fila de la lista de publicadas abre esa ruta.** El nombre pasa a ser el enlace, como en
  la fila de borrador — abrir es lo que se hace con esa fila, y no había nada que hacer antes.
- **La pantalla dice que lo que muestra está congelado.** Un documento que se lee igual que un
  borrador y no se puede tocar tiene que decir por qué no se puede tocar.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `templates`: se agrega el requisito de que una versión publicada se pueda LEER por su id
  fuera de una inspección programada, y qué contesta esa lectura. Hoy la spec dice que una
  versión es un documento congelado y que el paquete de campo lo entrega; no dice que exista
  ninguna forma de mirarlo sin programar una inspección, y ese silencio es justamente el
  hueco.

## Impact

- **Sin migración.** `GRANT SELECT ON template_version` existe desde 0003 §final y
  `template_version` no tiene RLS, porque no lleva `site_id`. No hay columna, privilegio ni
  trigger nuevos.
- `packages/contracts/src/templates.ts`: `publishedTemplateVersionSchema` y su tipo. Reusa
  `templateDocumentSchema`, que ya se re-exporta desde `@hs/forms`, e incluye la identidad de
  la propia versión en `template_version_id`.
- `apps/api/src/templates/`: un método de lectura en el servicio con su consulta —ahí y no en
  `templates.repository.ts`, que declara no tocar el modelo publicado—, un error nuevo en
  `templates.errors.ts` y la ruta en el controlador. `published-version.sql.ts` no se toca: esta lectura no resuelve "la última".
- `apps/web/src/api/templates.ts`: `getPublishedTemplateVersion`. `queryKeys` gana la clave de
  la versión.
- `apps/web/src/routes/PublishedTemplateRoute/`: la ruta nueva y su test. `PublishedRow.tsx`
  pasa a enlazar. `presentation/templates.ts` ya tiene `RESPONSE_TYPE_LABELS`.
- `apps/web/src/app/router.tsx`: la ruta. **`sw.ts` no cambia** — `CAPTURE_ROUTES` son
  `/`, `/inspections/` y `/outbox`, y `/templates/versions/$id` no matchea ninguno, así que
  la ruta nueva queda fuera del precacheo sin tocar nada.
- **Desbloquea**: la revisión de una plantilla publicada (versión 2), que necesita mostrar lo
  que hay antes de dejar cambiarlo.
