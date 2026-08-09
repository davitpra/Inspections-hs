## 1. El contrato compartido

- [x] 1.1 `packages/contracts/src/field-package.ts`: `templateVersionPackageSchema`
      (`site_id`, `template_version_id`, `version`, `document` contra
      `templateDocumentSchema` de `@hs/forms`), `locationPackageSchema` =
      `z.array(locationOptionSchema)` y `rosterPackageSchema` =
      `z.array(personOptionSchema)`. Las dos últimas reusan los esquemas que ya existen: si
      hubo que definir una forma nueva de ubicación o de persona, algo se desvió.
- [x] 1.2 Exportar desde `packages/contracts/src/index.ts` y agregar tests de forma en
      `field-package.test.ts`: un documento que no parsea como `TemplateDocument` no parsea;
      una entrada de roster con un campo de más no parsea (§4 dice que el supervisor elige
      sin ver el perfil); un `version` cero o negativo no parsea.

## 2. La resolución compartida de la inspección

- [x] 2.1 Extraer a `apps/api/src/inspections/` la resolución de D6: "la inspección visible
      y no cancelada, o nada", leída dentro de `withSessionScope`. Devuelve al menos
      `site_id` y `template_version_id`.
- [x] 2.2 `apps/api/src/uploads/uploads.service.ts` pasa a usarla en vez de su consulta
      propia. **Su código de error NO cambia**: sigue respondiendo `403 forbidden`, porque
      eso ya está especificado en `offline-capture` y este change no declara esa capability
      (D6). El resolutor devuelve el dato; quién lo llama decide cómo se queja.
- [x] 2.3 Test de unidad del resolutor: una inspección que la transacción no ve devuelve
      nada; una cancelada devuelve nada; una visible devuelve su `site_id`.

## 3. Las tres rutas

- [x] 3.1 `GET /scheduled-inspections/:id/template-version` en
      `InspectionsController` + su método en `InspectionsService`. El documento sale de la
      columna `template_version.document` **tal cual** (D4), unida por el
      `template_version_id` de la inspección — nunca por "la versión más alta publicada".
- [x] 3.2 `GET /scheduled-inspections/:id/locations`: las ubicaciones **activas**
      (`deactivated_at IS NULL`) de la planta de la inspección, en la forma de
      `locationOptionSchema`.
- [x] 3.3 `GET /scheduled-inspections/:id/roster`: las personas **activas** de esa misma
      planta, en la forma de `personOptionSchema` y sin un campo más.
- [x] 3.4 Las tres refutan con `inspection_not_found` cuando el resolutor no devuelve nada
      (D6). Comentario en el servicio explicando por qué es la misma respuesta para "no
      existe", "está cancelada" y "es de la otra planta".
- [x] 3.5 El `WHERE site_id = ...` de 3.2 y 3.3 lleva el comentario de D3: es un filtro de
      SELECCIÓN entre las plantas del alcance, no el límite de seguridad. El límite es la
      política RLS y sin ella este `WHERE` no salvaría nada.

## 4. Tests de integración

- [x] 4.1 `apps/api/test/field-package.int-spec.ts`: una cuenta con alcance en la planta
      recibe las tres respuestas y el documento parsea contra `templateDocumentSchema`.
- [x] 4.2 Aislamiento, las dos mitades por separado (D3): una cuenta **sin** alcance en la
      planta recibe `inspection_not_found` en las tres rutas y no recibe ninguna pieza; y un
      coordinador **con** alcance a las dos plantas recibe, para una inspección de Glencoe,
      solo ubicaciones y personas de Glencoe.
- [x] 4.3 Congelamiento: publicar la versión `3` de la plantilla y volver a leer una
      inspección atada a la `2` sigue devolviendo la `2`, con su documento. Es la garantía
      de `inspections` verificada del lado del servidor.
- [x] 4.4 Desactivados: una ubicación desactivada y una persona desactivada no aparecen en
      sus respuestas, y la fila sigue existiendo (nunca se borra, se desactiva).
- [x] 4.5 Una inspección cancelada devuelve `inspection_not_found` en las tres rutas (D7).
- [x] 4.6 **Sin migración: este change no crea ni altera ninguna tabla, y no escribe una
      sola fila.** El test lo hace explícito leyendo dos veces y afirmando que nada cambió.

## 5. Cerrar el lazo con el dispositivo

- [x] 5.1 `apps/web/src/offline/prefetch.ts` importa los tres esquemas de `@hs/contracts` y
      **borra** sus definiciones locales junto con el bloque de "SUPUESTO DECLARADO" (D5).
      Las rutas y las formas no cambian: si hubo que tocar `prefetchInspection()`, el
      contrato del servidor no calzó y eso es el hallazgo.
- [x] 5.2 Los dobles de `apps/web/src/test/fixtures.ts` y de `prefetch.test.ts` se
      construyen contra el contrato compartido, para que un desajuste futuro sea un error de
      `pnpm typecheck` y no un `safeParse` que falla en una planta.
- [x] 5.3 `pnpm typecheck`, `pnpm lint` y `pnpm test` en verde en todo el workspace.

## 6. Verificación del recorrido

- [x] 6.1 Con la API corriendo y el bucket configurado: preparar una inspección desde
      `/inspections/$id/prepare` y confirmar que las tres piezas quedan en Dexie y que la
      pantalla la reporta lista para el campo.
- [x] 6.2 Cerrar la tarea **9.3 de `offline-inspection-capture`**, que este change
      desbloquea: recorrido manual en Chrome con la red deshabilitada —preparar con red,
      capturar en avión, cerrar la pestaña, reabrir, reconectar—. El envío todavía falla
      contra `POST /inspection-submissions`, que no existe; lo que se verifica acá es que
      la entrada del outbox queda en cola y reintenta, sin perderse.
