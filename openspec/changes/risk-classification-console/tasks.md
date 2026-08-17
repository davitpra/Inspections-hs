## 1. El nombre de la ubicación en la lectura

Ninguna tarea de este grupo toca el esquema: no hay migración (design D1, Migration Plan).

- [ ] 1.1 `packages/contracts/src/findings.ts` — añadir `location_name: z.string()` a
      `findingSchema`, junto a `location_id`, con el comentario de que es una proyección del
      catálogo resuelta en la lectura y que no viaja en ningún request.
- [ ] 1.2 `apps/api/src/findings/findings.service.ts` — `FINDING_SELECT` gana
      `l.name AS location_name` y `JOIN location l ON l.id = f.location_id AND l.site_id = f.site_id`;
      `FindingRow` y `toFinding` ganan el campo. Un solo lugar: la constante ya la comparten
      `list`, `get`, `readOne` y `findingsForInspection`.
- [ ] 1.3 `apps/api/test/findings.int-spec.ts` — un caso que comprueba que el hallazgo se lee con
      el nombre de su ubicación, y otro con la ubicación desactivada después de registrarlo, que
      también lo lleva.
- [ ] 1.4 Comprobar que ninguna otra lectura se rompe: `findingsForInspection` alimenta
      `InspectionReportRoute`, y `strictObject` hace que un campo nuevo sin declarar falle el
      parse del cliente.

## 2. Las piezas transversales del cliente

- [ ] 2.1 `apps/web/src/api/findings.ts` — `listFindings()`, `getFinding(id)` y
      `classifyFinding(id, body)` con `get`/`post` de `request.ts` y `parse` obligatorio, igual
      que `api/recurrence.ts`.
- [ ] 2.2 `apps/web/src/api/query-keys.ts` — `findings: () => key('findings')` y
      `finding: (id?: string) => key('finding', id)`, con el patrón de prefijo del archivo.
- [ ] 2.3 `apps/web/src/permissions/session.ts` — `canClassifyFinding(account): account is Session`
      como quinto predicado, no reutilizando ninguno de los cuatro (design D5), más su
      `session.test.ts` al lado si no existe ya.
- [ ] 2.4 `apps/web/src/presentation/findings.ts` — `PROBABILITY_LABELS`, `SEVERITY_LABELS`,
      `RISK_LEVEL_LABELS`, `CONTROL_LEVEL_LABELS` y `ORIGIN_LABELS` como
      `Readonly<Record<Enum, string>>` sobre los enums de `@hs/contracts`. Las de control nombran
      su posición en la jerarquía; el sistema registra el nivel y no lo juzga.
- [ ] 2.5 `apps/web/src/components/RiskBadge.tsx` — `{ level: RiskLevel | null }`, `null` →
      `Unclassified`. En `components/` porque lo usan las dos rutas (design D3).
- [ ] 2.6 `apps/web/src/index.css` — las clases de la píldora de riesgo sobre los tokens
      semánticos existentes. Cero colores literales: `check-tokens.mjs` falla el build.

## 3. `/findings` — la lista

- [ ] 3.1 `routes/FindingsRoute/presentation.ts` — `isUnclassified`, `visibleFindings(findings, filter)`,
      `byUrgency` (sin clasificar primero, después `risk_level` descendente, después
      `recorded_at` descendente), `tally` y `riskPillClass`. Sin mutar la entrada.
- [ ] 3.2 `routes/FindingsRoute/presentation.test.ts` — el orden con los cuatro niveles y con
      hallazgos sin clasificar mezclados, el filtro por defecto, y que `byUrgency` no muta.
- [ ] 3.3 `routes/FindingsRoute/index.tsx` — `useQuery(queryKeys.findings(), listFindings)`,
      `useState<FindingFilter>('unclassified')`, cabecera `.scheduling__top`, `.stats-bar` con el
      `tally`, `.card > .list` con `RiskBadge`, descripción, `location_name`, origen,
      `formatCivilDay(recorded_at)`, marca de recurrencia y `<Link to="/findings/$id">`. Lista
      vacía → `.notice-card`.
- [ ] 3.4 `routes/FindingsRoute/index.test.tsx` — el filtro por defecto oculta los clasificados,
      "All" los muestra, el orden pone los sin clasificar arriba, y la lista vacía muestra el
      aviso. Molde de `PendingRoute/index.test.tsx`: `vi.hoisted`, `QueryClientProvider`,
      `cleanup()` manual.

## 4. `/findings/$id` — detalle y clasificación

- [ ] 4.1 `routes/FindingRoute/presentation.ts` — `previewRiskLevel(probability, severity)` con
      los índices de `PROBABILITIES`/`SEVERITIES` y los cortes 4/9/14, `reasonRequired(finding)`
      y `classifyBlockers(form, isReclassification)`. Comentario obligatorio: esto pinta un
      número, el que se guarda lo calcula `hs_risk_level` (design D2).
- [ ] 4.2 `routes/FindingRoute/presentation.test.ts` — **las 25 celdas** replicadas de
      `apps/api/src/findings/risk.spec.ts`, más los bloqueos del formulario con y sin
      clasificación vigente.
- [ ] 4.3 `routes/FindingRoute/ClassifyForm.tsx` — tres `<select>` con las etiquetas de
      `presentation/findings.ts`, el `RiskBadge` de previsualización que se actualiza al cambiar
      cualquiera de los dos, y el `<textarea>` de `reason` solo cuando hay clasificación vigente,
      con el mínimo de diez caracteres del contrato. La mutación invalida
      `queryKeys.finding(id)` y `queryKeys.findings()`, y hace `reset()` antes de `mutate()`.
- [ ] 4.4 `routes/FindingRoute/ClassifyForm.tsx` — el `409 already_reclassified` se presenta como
      aviso legible más un refetch, de modo que lo que queda a la vista es la clasificación ahora
      vigente (design D6).
- [ ] 4.5 `routes/FindingRoute/index.tsx` — `useQuery(queryKeys.finding(id), …)`, `back-link` a
      `/findings`, `.facts` con descripción, ubicación, origen, `item_key` si lo hay, fechas y la
      marca de recurrencia con su `window_months`; el conteo de fotos con el aviso literal de
      `InspectionReportRoute`; la clasificación vigente si existe; y el formulario solo si
      `canClassifyFinding(account)`, con una nota en su lugar si no.
- [ ] 4.6 `routes/FindingRoute/index.test.tsx` — clasificar por primera vez sin campo de motivo,
      reclasificar con el motivo exigido, un supervisor que lee y no ve el formulario, y el 409
      que muestra el aviso.

## 5. Enganchar

- [ ] 5.1 `apps/web/src/app/router.tsx` — import, `createRoute` y `addChildren` para `/findings`
      y `/findings/$id`, la específica antes que la del parámetro.
- [ ] 5.2 `apps/web/src/app/nav-items.ts` — `'/findings'` en `NavPath`,
      `{ to: '/findings', label: 'Findings' }` en `NAV_ITEMS` **sin `visible`**, y
      `['/findings', 'Findings']` + `['/findings/*', 'Finding']` en `TITLES`.
- [ ] 5.3 `apps/web/src/app/nav-items.test.ts` — el destino nuevo se ofrece a todos los roles y
      los dos títulos resuelven, incluido el del comodín.
- [ ] 5.4 `apps/web/src/routes/InspectionReportRoute/index.tsx` — cada bloque de hallazgo gana su
      nivel de riesgo y el link a `/findings/$id`.

## 6. Verificación

- [ ] 6.1 `pnpm -r build && pnpm typecheck && pnpm lint`.
- [ ] 6.2 `pnpm test` y `pnpm --filter web build` (corre `check-tokens.mjs` y
      `check-service-worker.mjs`).
- [ ] 6.3 `pnpm --filter api test:int` — el caso de `location_name` contra Postgres real.
- [ ] 6.4 End-to-end contra el entorno local, que cierra además la tarea 10.1 que dejó abierta
      `2026-08-10-findings-and-risk-classification`: como coordinador, un hallazgo derivado
      aparece sin clasificar y con el nombre real de su ubicación; `likely` + `major` muestra
      **Critical** antes de guardar; al guardar deja de contarse como sin clasificar;
      reclasificar a `unlikely` + `minor` exige el motivo y da **Low** dejando la anterior
      superada y no editada; un supervisor ve la lista y no el formulario; y dos pestañas sobre
      el mismo hallazgo hacen que la segunda muestre el aviso de reclasificación concurrente.
