## Why

La etapa 8 dejó al coordinador revisar una plantilla publicada sin depender del
desarrollador, y con eso apareció un caso que hasta entonces no existía: se corrige una
pregunta mal redactada, se publica la versión 3, y la obligación de este mes sigue atada a
la 2. El inspector pulsa **Refresh field package** —el control que el change
`2026-08-24-refrescar-paquete-de-campo` puso ahí justamente para volver a bajar el
paquete— y vuelve a bajar la versión vieja, sin decir que hay otra. La única salida que el
sistema ofrece hoy es que el coordinador cancele el mes y lo programe de nuevo: una
cancelación con motivo obligatorio en el registro permanente por un cambio de redacción,
más una inspección con otro `id`, más el paquete del dispositivo apuntando a una fila que
ya no es la suya.

Ese precio se paga porque `scheduled_inspection.template_version_id` es inmutable sin
matices: sin `GRANT UPDATE` y dentro del array `frozen` de `hs_scheduling_guard()`
(`0008_inspection_scheduling.sql` §5, redefinido en `0029_inspection_frequency.sql` §3). La
inmutabilidad se escribió para proteger algo real —que nadie reescriba con qué formulario
se inspeccionó—, pero ese algo real vive en `inspection.template_version_id`, la fila del
envío firmado, que este change **no toca**. Sobre un período que todavía no se envió no hay
ningún hecho que proteger: hay una obligación pendiente atada a un formulario que el
coordinador ya declaró equivocado.

No abre etapa nueva de §7. Cierra el hueco que la etapa 8 abrió sobre la etapa 7
(recurrencia) y la etapa 3 (paquete de campo offline).

## What Changes

- `scheduled_inspection.template_version_id` deja de ser inmutable y pasa a ser
  **monótona**: puede AVANZAR a una versión publicada más alta de la misma plantilla, y
  nada más. Las tres condiciones las fuerza el motor, no el endpoint:
  1. solo hacia adelante — misma plantilla y `version` estrictamente mayor;
  2. solo antes del envío — se rechaza si ya existe la fila de `inspection`;
  3. solo sobre un período vivo — se rechaza si `cancelled_at` no es nulo.
- Publicar una versión sigue **sin efecto por sí solo**. Avanzar es un acto explícito de
  una persona, con su entrada de auditoría (`inspection.version_advanced`). El trabajo de
  apertura de período no avanza nada, y el escenario "Publishing a newer version leaves an
  open inspection untouched" sigue siendo verdadero.
- Endpoint nuevo `POST /scheduled-inspections/:id/template-version/advance`, idempotente,
  que devuelve el mismo paquete que el `GET` de hoy. El `GET` no cambia: una lectura no
  muta.
- **Refresh field package** lo usa **solo cuando el dispositivo no tiene borrador**. Con un
  borrador en curso, avanzar lo dejaría huérfano y con uno firmado el servidor rechazaría
  el envío después del recorrido: en ese caso el paquete se refresca como hoy y la pantalla
  nombra la versión nueva y la única salida real, que es descartar.
- La lista de pendientes dice qué versión hay publicada además de a cuál está atada la
  inspección, para que la asignación pueda ofrecer el avance con red y nombrarlo sin ella.
- La consola de programación muestra la versión congelada de cada período y avisa cuando
  hay una más alta publicada.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `inspections`: el requisito "The template version of a scheduled inspection is frozen by
  the engine" hoy dice que la columna no se puede cambiar por ningún medio y que corregirla
  es cancelar y reprogramar. Pasa a decir que avanza —solo hacia adelante, solo antes del
  envío, solo sobre un período vivo— y se agrega el requisito que describe el avance, quién
  lo puede pedir y cómo se audita.
- `offline-capture`: el requisito "An inspection is prepared for the field before signal is
  lost" hoy garantiza que volver a preparar devuelve la MISMA versión. Pasa a exigir que
  vuelva a preparar contra la última publicada cuando no hay borrador en el dispositivo, y
  que con borrador no avance y lo nombre. El requisito "A stored package that is not the
  inspection's frozen version is named" gana el caso de la versión publicada más nueva.

## Impact

- **Esquema** — `apps/api/drizzle/0030_advance_template_version.sql`: `GRANT UPDATE` de una
  columna, y las dos funciones de trigger de `scheduled_inspection` reescritas
  (`hs_scheduling_guard`, `hs_scheduled_inspection_audit`). Toca una tabla inmutable; ver
  `design.md`.
- `apps/api` — `inspections.service.ts` (`advanceTemplateVersion`, `pendingFor`),
  `inspections.controller.ts`, `inspections.errors.ts`, `db/schema/inspections.ts`.
- `packages/contracts` — `pendingInspectionSchema` gana tres campos.
- `apps/web` — `offline/prefetch.ts`, `components/FieldPackage.tsx`, `InspectorHomeRoute/`,
  `SchedulingRoute/PeriodRow.tsx`.
- Sin cambios en `packages/forms`: el motor interpreta el documento que le dan y no elige
  versión.
