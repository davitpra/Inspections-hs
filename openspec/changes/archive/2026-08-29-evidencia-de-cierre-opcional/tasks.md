## 1. Decisión y alcance vigente

- [x] 1.1 Crear `docs/adr/016-evidencia-de-cierre-opcional.md` con la retirada de la evidencia
  obligatoria: qué se retira (las cuatro capas de la compuerta), qué se conserva entero (el
  verificador distinto del ejecutor, el `object_key` sin bytes de ADR-001, el prefijo por
  sitio y por acción de ADR-006, la inmutabilidad y el aislamiento de ADR-002 y ADR-004), y
  cuál es el costo aceptado. Añadir la fila al índice de `docs/adr/README.md` sin reescribir
  ningún ADR aceptado.
- [x] 1.2 Enmendar §3 R3 de `docs/Requisitos_V1.2.md`: la carga de evidencia antes/después
  deja de ser condición para pasar a _esperando verificación_ y queda como lo que el sistema
  pide y conserva. No tocar la frase del verificador distinto del ejecutor, ni el
  escalamiento de +3 y +7 días, ni la naturaleza append-only de cada transición. Comprobar
  §7 etapa 5, que declara «R3 completo», y anotarla contra ADR-016.

## 2. Contratos

- [x] 2.1 En `packages/contracts/src/actions.ts`, quitar `requires: ['after_evidence']` de la
  fila `in_progress → awaiting_verification` de `TRANSITIONS` y retirar `'after_evidence'` de
  `TRANSITION_REQUIREMENTS`, que queda en `['not_executor', 'reason']`. Reescribir el docblock
  de `TRANSITION_REQUIREMENTS` y el de `TRANSITIONS` que lo citan.
- [x] 2.2 Retirar de `transitionRequestSchema` el `.refine` de la evidencia `after`,
  conservando el objeto estricto, el `max(10)` de `evidence` y el comentario que explica por
  qué el `reason` del rechazo no se puede exigir acá. Reescribir el docblock que anuncia «los
  dos `refine`».
- [x] 2.3 Reformular en `packages/contracts/src/actions.test.ts` la afirmación de que la
  transición a `awaiting_verification` exige `after_evidence`: pasa a comprobar que ninguna
  fila de `TRANSITIONS` declara ese requisito y que el request sin evidencia parsea.

## 3. API

- [x] 3.1 Eliminar de `ActionsService.transition` el bloque
  `if (transition.requires.includes('after_evidence'))` y su `evidenceRequired()`,
  conservando intactos el chequeo del `reason`, el de `not_executor` y el de
  `foreignEvidenceKeys`. Actualizar el docblock de cabecera del servicio, que enumera lo que
  garantiza el motor y nombra `HS006`.
- [x] 3.2 Retirar de `apps/api/src/actions/actions.errors.ts` el código `evidence_required` de
  `ActionErrorCode`, su constructor y el `case 'HS006'` del mapeo de `DatabaseError`,
  comprobando que ningún otro módulo lo importa.

## 4. Persistencia

- [x] 4.1 Añadir `apps/api/drizzle/0039_optional_completion_evidence.sql` y su entrada de
  journal, posterior a `0038`: `DROP TRIGGER corrective_action_evidence_required ON
  corrective_action_event` y `DROP FUNCTION hs_action_evidence_required()`. **Sin ningún
  GRANT, REVOKE ni política nueva**, y la cabecera del archivo lo declara: la tabla
  `corrective_action_event` y `corrective_action_evidence` conservan su `hs_make_immutable` y
  su `hs_apply_site_isolation`, ninguna fila se escribe ni se borra, y lo único que se retira
  es la compuerta del commit. No reescribir `0011`.
- [x] 4.2 Comprobar sobre una base migrada desde cero que el trigger y la función no existen,
  que `corrective_action_evidence_key_uq`, el índice por `event_id`, el trigger de auditoría
  `corrective_action_evidence_audit` y las políticas RLS de las tres tablas siguen en pie, y
  que `hs_action_verifier_not_executor` —la otra mitad de R3— sigue rechazando con `HS005`.

## 5. Web

- [x] 5.1 En `apps/web/src/components/ActionProgressPanel.tsx`, cambiar la condición del
  selector de evidencia: deja de preguntar si alguna transición disponible **exige**
  `after_evidence` y pasa a preguntar si alguna lleva a `awaiting_verification`. Sin esto el
  selector desaparecería al retirarse el requisito.
- [x] 5.2 En `apps/web/src/components/EvidencePicker.tsx`, corregir el pie de la carga
  `after`: «Required to complete the work» deja de ser cierto. La de `before` sigue siendo
  contexto opcional.

## 6. Tests

- [x] 6.1 En `apps/api/test/corrective-actions.int-spec.ts`, retirar los dos casos de la
  compuerta —el rechazo del endpoint sin evidencia y el `HS006` al commitear— y escribir sus
  contrarios: el completado sin evidencia llega a `awaiting_verification` por el endpoint, y
  un insert directo de un evento `awaiting_verification` sin evidencia commitea. Conservar el
  caso del prefijo ajeno (`invalid_evidence`), el de `before` y `after` juntos, y el del
  verificador que es el ejecutor. Actualizar el índice de casos del docblock de cabecera.
- [x] 6.2 Comprobar que `apps/api/test/incidents.int-spec.ts` sigue pasando sin cambios: sus
  transiciones ya mandan evidencia `after` y este change no se la quita.
- [x] 6.3 Ajustar los tests web que dan por supuesto que el selector de evidencia aparece por
  el requisito, en `ActionRoute` y en `InspectionFindingsRoute`.

## 7. Validación

- [x] 7.1 Ejecutar `pnpm -r build` antes de `pnpm typecheck`, y después `pnpm lint`,
  `pnpm test` y `pnpm --filter api test:int`.
- [x] 7.2 Buscar referencias residuales a `after_evidence`, `evidence_required`, `HS006` y
  `hs_action_evidence_required`, y aceptar como válidas únicamente las del historial de
  migraciones (`0011`), los ADR anteriores, los changes archivados y los payloads históricos
  de auditoría.
- [x] 7.3 Ejecutar `openspec validate evidencia-de-cierre-opcional --strict`.
