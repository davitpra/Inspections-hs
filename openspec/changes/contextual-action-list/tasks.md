## 1. Shared contract

- [x] 1.1 Add discriminated action-source and action-summary schemas with contract tests
- [x] 1.2 Change the action-list schema to contain summaries while preserving the detail schema

## 2. API projection

- [x] 2.1 Add a summary query that resolves site, nullable assignee name and all three source variants
- [x] 2.2 Keep detail reads on the full event/evidence query and update repository and integration tests

## 3. Corrective actions route

- [x] 3.1 Add pure status, source and site filtering plus display-option helpers and tests
- [x] 3.2 Replace the flat list with the operational header, filters and responsive action table
- [x] 3.3 Cover loading, connection, empty-list, empty-filter and row-navigation behavior in route tests

## 4. Verification

- [x] 4.1 Validate the OpenSpec change and run relevant contract, API and web tests
- [ ] 4.2 Run repository build before typecheck, then lint and the full unit test suite

La verificación completa ejecutó build, typecheck y lint correctamente. La suite unitaria queda
bloqueada por dos expectativas preexistentes de `ScheduleRequirementRoute/index.test.tsx` que no
contemplan `visible_early` y que consultan ambiguamente el año actual; las 882 pruebas web restantes
pasaron.
