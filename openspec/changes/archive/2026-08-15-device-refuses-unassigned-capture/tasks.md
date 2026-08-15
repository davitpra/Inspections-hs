## 1. El contrato y el servidor

- [x] 1.1 Agregar `inspector_id` (uuid nullable, requerido) a `templateVersionPackageSchema`
      en `packages/contracts/src/field-package.ts`, con el comentario de por qué viaja acá
      —lo mismo que `site_id`: saber de quién es la inspección sin red.
- [x] 1.2 Servirlo desde `templateVersionPackage` en
      `apps/api/src/inspections/inspections.service.ts`, leyéndolo de `scheduled_inspection`
      dentro de la transacción con alcance. Sin `WHERE site_id` (ADR-002).
- [x] 1.3 `pnpm -r build` antes de typecheck: `apps/web` y `apps/api` consumen
      `@hs/contracts` por su `dist`.

## 2. El dispositivo guarda la asignación

- [x] 2.1 Agregar `inspector_id?: string | null` al payload `template_version` de
      `PrefetchPayload` en `apps/web/src/offline/db.ts`. Opcional a propósito (design D4):
      describe lo que la base puede tener guardado de ayer, no lo que el servidor manda hoy.
      Sin subir la versión de Dexie (design D3).
- [x] 2.2 Verificar que `prefetchInspection` lo guarda sin cambios —hace `{ kind, ...parsed }`—
      y que `storedTemplateVersion` lo devuelve.

## 3. No se abre lo ajeno

- [x] 3.1 Función pura en `apps/web/src/offline/drafts.ts` (o el módulo de presentación que
      corresponda) que decida si una inspección se puede capturar: recibe el `inspector_id`
      guardado y la cuenta activa, devuelve `ok`, `not_assigned` o `unassigned`. Ausente =
      `ok` (design D4).
- [x] 3.2 Test unitario de esa función: asignada a la cuenta, asignada a otra, `null`, y
      ausente.
- [x] 3.3 `CaptureRoute` no llama a `openDraft` cuando la decisión no es `ok`: muestra el
      motivo en inglés y ofrece volver, sin ninguna petición de red.
- [x] 3.4 Test de la ruta: con la descarga hecha y la inspección de otra cuenta, no se crea
      borrador en Dexie y la pantalla nombra el motivo.

## 4. No se firma lo que dejó de ser tuyo

- [x] 4.1 `ReviewRoute` deshabilita firmar cuando la misma decisión no es `ok`, con el aviso
      en pantalla. El borrador se sigue leyendo entero.
- [x] 4.2 Test de la ruta: borrador existente + inspección reasignada → botón deshabilitado,
      motivo visible, respuestas todavía legibles.

## 5. La cola manda solo lo de su dueño

- [x] 5.1 `outboxFor(accountId)` en `apps/web/src/offline/outbox.ts` y `runOutbox` filtrando
      por el `account_id` del borrador; `OutboxRoute` y `queryKeys.outbox(userId)` por cuenta.
- [x] 5.2 Tests: no se manda la entrada ajena y queda en la cola, sin cuenta no sale nada,
      `outboxFor` recorta por cuenta y descarta la huérfana sin borrarla.

## 6. Cierre

- [x] 6.1 Actualizar `apps/api/test/field-package.int-spec.ts` con el campo nuevo, incluido el
      caso de la inspección sin inspector. El caso del coordinador con las dos plantas queda
      como está: sigue leyendo el paquete.
- [x] 6.2 `pnpm lint`, `pnpm -r build`, `pnpm typecheck`, `pnpm test`, y
      `pnpm --filter api test:int` para el paquete de campo.
