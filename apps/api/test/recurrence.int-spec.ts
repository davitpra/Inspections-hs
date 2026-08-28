import type { InspectionSubmission, TemplateDocument, TemplateSection } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { ReportingService } from '../src/reporting/reporting.service';
import { SubmissionsService } from '../src/inspections/submissions.service';
import { createLocation, registerSite } from './helpers/catalog';
import { createAccount } from './helpers/identity';
import { scheduleInspection } from './helpers/inspections';
import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createSchedulingStack, type SchedulingStack } from './helpers/scheduling';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';

/**
 * Requisitos §5 riesgo A, §6-bis pregunta 11 y §7 etapa 7 — LA RECURRENCIA.
 *
 * ESTE ARCHIVO EXISTE POR UN MOTIVO Y CONVIENE LEERLO ANTES DE TOCARLO. §5 riesgo A dice
 * que la detección de recurrencia es la feature más valiosa del sistema y también el
 * riesgo más peligroso, porque **agrupar mal no produce ningún error**: los IDs existen,
 * los joins funcionan, la consulta devuelve filas y el dashboard renderiza una pantalla
 * que dice que no hay hallazgos recurrentes. Nadie duda de esa pantalla.
 *
 * La única defensa posible es una aserción sobre un número exacto, con datos construidos
 * por el camino real de la aplicación. Eso es `la prueba de aceptación del riesgo A` de
 * abajo, y el requisito la declaraba **obligatoria antes de la primera migración**. Llega
 * tarde —llega en la etapa 7 y no en la 1— pero llega con algo mejor de lo que habría
 * tenido entonces: las cinco etapas construidas y el endpoint de ingesta real.
 *
 * SI ESE TEST FALLA, NO SE AJUSTA EL TEST. El esquema o la consulta están mal.
 */

const SITE_A = 'fec00000-0000-4000-8000-000000000001';
const SITE_B = 'fec00000-0000-4000-8000-000000000002';

const ITEM = 'rec.guards';
const OTHER_ITEM = 'rec.eyewash';

let db: TestDatabase;
let stack: SchedulingStack;
let submissions: SubmissionsService;
let reporting: ReportingService;

let templateId: string;
let versionV1: string;
let versionV2: string;
let versionV3: string;

/** `pack-line-3` y `shipping-bay` de los escenarios, más el espejo en la otra planta. */
let packLine3: string;
let shippingBay: string;
let locationB: string;

let inspector: { accountId: string };
let inspectorB: { accountId: string };
let coordinator: { accountId: string };
let supervisor: { accountId: string };

// ---------------------------------------------------------------------------
// Las tres versiones, con las ediciones realistas que §5 riesgo A enumera.

/** v1 — el ítem tal como nació. */
function documentV1(): TemplateDocument {
  return {
    sections: [
      section('general', 'General', [
        item(ITEM, 'Machine guards in place', 1, 'yes_no'),
        item(OTHER_ITEM, 'Eyewash flushed', 2, 'yes_no'),
      ]),
    ],
  };
}

/**
 * v2 — las tres ediciones que el coordinador hace en un builder visual: reescribe la
 * redacción, mueve el ítem a otra sección y lo reordena.
 *
 * Ninguna de las tres toca `item_key`, y esa es exactamente la garantía que el change
 * `template-versioning-item-identity` puso en el motor y que esta serie verifica de
 * punta a punta.
 */
function documentV2(): TemplateDocument {
  return {
    sections: [
      section('general', 'General', [item(OTHER_ITEM, 'Eyewash flushed', 1, 'yes_no')]),
      section('machinery', 'Machinery', [
        item(ITEM, 'Are all machine guards fitted and secured?', 1, 'yes_no'),
      ]),
    ],
  };
}

/**
 * v3 — cambia el TIPO DE RESPUESTA del ítem.
 *
 * **DESVÍO DECLARADO respecto de la letra de §5 riesgo A**, que pedía pasar de sí/no a
 * `scale`. No se puede: el change `findings-and-risk-classification` fijó que ningún ítem
 * `scale` deriva hallazgo —sin umbral en el documento, cualquier corte sería inventado—,
 * así que un v3 con `scale` no podría generar el cuarto hallazgo y la prueba entera se
 * quedaría sin su cuarto elemento.
 *
 * `yes_no_na` es un cambio de tipo de respuesta igual de real —cambia el dominio de la
 * respuesta y la fila publicada— y sí deriva. La propiedad que el riesgo A quiere probar
 * —que cambiar el tipo no parte la serie— queda probada igual.
 */
function documentV3(): TemplateDocument {
  return {
    sections: [
      section('general', 'General', [item(OTHER_ITEM, 'Eyewash flushed', 1, 'yes_no')]),
      section('machinery', 'Machinery', [
        item(ITEM, 'Are all machine guards fitted and secured?', 1, 'yes_no_na'),
      ]),
    ],
  };
}

function section(
  key: string,
  title: string,
  items: TemplateSection['items'],
): TemplateSection {
  return {
    section_key: key,
    section_title: title,
    position: key === 'general' ? 1 : 2,
    items,
  };
}

function item(
  itemKey: string,
  prompt: string,
  position: number,
  responseType: 'yes_no' | 'yes_no_na',
): TemplateSection['items'][number] {
  const base = { item_key: itemKey, prompt, position, required: true, fails_on: 'no' as const };

  return responseType === 'yes_no'
    ? { ...base, response_type: 'yes_no' }
    : { ...base, response_type: 'yes_no_na' };
}

// ---------------------------------------------------------------------------
// Ingesta: los hallazgos se generan por el endpoint real y nunca por INSERT.

const sessionFor = (accountId: string, siteIds: string[], role = 'jhsc_member') => ({
  userId: accountId,
  role,
  siteIds,
});

let periodCursor = 0;

function nextPeriod(): string {
  periodCursor += 1;
  const month = ((periodCursor - 1) % 12) + 1;
  const year = 2040 + Math.floor((periodCursor - 1) / 12);

  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Un instante N meses hacia atrás desde ahora, para caer dentro o fuera de la ventana. */
function monthsAgo(months: number): string {
  const date = new Date();

  date.setMonth(date.getMonth() - months);

  return date.toISOString();
}

interface Occurrence {
  site?: string;
  version?: string;
  location: string;
  monthsAgo: number;
  itemKey?: string;
  /** Para el caso de dos hallazgos en el MISMO envío. */
  alsoOther?: boolean;
}

/**
 * Programa una inspección, la responde en negativo y la envía. Devuelve el id de la
 * inspección creada.
 *
 * **Por el servicio real de ingesta y no por `INSERT INTO finding`.** Un test que
 * insertara las filas a mano probaría que un `GROUP BY` agrupa filas, que ya sabemos.
 * Lo que hay que probar es que la fila que la aplicación escribe es la que la consulta
 * puede agrupar, y eso solo lo dice el camino completo.
 */
async function occur(options: Occurrence): Promise<string> {
  const site = options.site ?? SITE_A;
  const version = options.version ?? versionV3;
  const itemKey = options.itemKey ?? ITEM;
  const who = site === SITE_A ? inspector : inspectorB;

  const scheduled = await scheduleInspection(db.app, {
    siteId: site,
    periodStart: nextPeriod(),
    templateId,
    templateVersionId: version,
    inspectorId: who.accountId,
  });

  const responseType = version === versionV3 && itemKey === ITEM ? 'yes_no_na' : 'yes_no';
  const negative = responseType === 'yes_no_na' ? 'no' : false;

  const answers: Record<string, unknown> = {
    [ITEM]: itemKey === ITEM ? negative : version === versionV3 ? 'yes' : true,
    [OTHER_ITEM]: itemKey === OTHER_ITEM || options.alsoOther ? false : true,
  };

  const findings: Record<string, unknown> = {};

  if (itemKey === ITEM) findings[ITEM] = details(site, scheduled, options.location);
  if (itemKey === OTHER_ITEM || options.alsoOther) {
    findings[OTHER_ITEM] = details(site, scheduled, options.location);
  }

  const payload = {
    client_submission_id: randomUUID(),
    scheduled_inspection_id: scheduled,
    template_version_id: version,
    answers,
    photos: {},
    findings,
    signed_at: monthsAgo(options.monthsAgo),
  } as unknown as InspectionSubmission;

  const accepted = await submissions.ingest(sessionFor(who.accountId, [site]), payload);

  return accepted.id;
}

function details(siteId: string, scheduledId: string, locationId: string) {
  return {
    description: 'Guard missing on the infeed of the packaging line',
    location_id: locationId,
    photo_object_keys: [`${siteId}/${scheduledId}/${randomUUID()}`],
  };
}

// ---------------------------------------------------------------------------

interface MarkRow extends Record<string, unknown> {
  finding_id: string;
  item_key: string;
  location_id: string;
  window_months: number;
  prior_count: number;
  prior_count_site_wide: number;
  first_prior_occurred_at: Date | null;
  is_recurrent: boolean;
}

async function marksOf(inspectionId: string, siteIds = [SITE_A]): Promise<MarkRow[]> {
  return inScope<MarkRow>(
    db.app,
    siteIds,
    `SELECT r.* FROM finding_recurrence r
       JOIN finding f ON f.id = r.finding_id
      WHERE f.inspection_id = $1
      ORDER BY r.item_key`,
    [inspectionId],
  );
}

/**
 * Un hallazgo de entrada manual, insertado a mano con su foto.
 *
 * **En un solo `INSERT` con CTE y no en dos**, porque "al menos una foto" es una
 * restricción DIFERIDA AL COMMIT (migración 0010): un hallazgo insertado en una
 * transacción que comete sin su foto no llega a existir. Dos llamadas a `inScope` son
 * dos transacciones y la primera fallaría al cometer — que es exactamente la propiedad
 * que 0010 quería, y que acá hay que respetar en vez de esquivar.
 */
async function insertManualFinding(description: string): Promise<string> {
  const rows = await inScope<{ id: string }>(
    db.app,
    [SITE_A],
    `WITH created AS (
       INSERT INTO finding (site_id, origin, location_id, description, reported_by, occurred_at)
       VALUES ($1, 'manual', $2, $3, $4, now())
       RETURNING id, site_id
     ), photo AS (
       INSERT INTO finding_photo (finding_id, site_id, object_key)
       SELECT created.id, created.site_id, $5 FROM created
     )
     SELECT id FROM created`,
    [SITE_A, packLine3, description, supervisor.accountId, `${SITE_A}/manual/${randomUUID()}`],
  );

  return one(rows).id;
}

/** El nombre de la restricción que rechazó, para distinguir cuál de las dos FK fue. */
function constraintOf(error: unknown): string | undefined {
  return (error as { constraint?: string } | undefined)?.constraint;
}

async function markCount(findingId: string, siteIds = [SITE_A]): Promise<number> {
  const rows = await inScope<{ count: string }>(
    db.app,
    siteIds,
    'SELECT count(*)::text AS count FROM finding_recurrence WHERE finding_id = $1',
    [findingId],
  );

  return Number(one(rows).count);
}

const report = (
  session: ReturnType<typeof sessionFor>,
  windowMonths = 12,
  groupBy: 'item_location' | 'item' = 'item_location',
) => reporting.recurrence(session, { window_months: windowMonths, group_by: groupBy });

const seriesFor = (
  rows: Awaited<ReturnType<typeof report>>['series'],
  itemKey = ITEM,
  locationId?: string | null,
) =>
  rows.filter(
    (row) =>
      row.item_key === itemKey &&
      (locationId === undefined || row.location_id === locationId),
  );

beforeAll(async () => {
  db = await startTestDatabase();
  stack = createSchedulingStack(db.appUrl);
  submissions = new SubmissionsService(stack.db);
  reporting = new ReportingService(stack.db);

  await registerSite(db.migrator, SITE_A, 'rec-a');
  await registerSite(db.migrator, SITE_B, 'rec-b');

  packLine3 = await createLocation(db.app, SITE_A, 'pack-line-3', 'Packaging line 3');
  shippingBay = await createLocation(db.app, SITE_A, 'shipping-bay', 'Shipping bay');
  locationB = await createLocation(db.app, SITE_B, 'pack-line-3', 'Packaging line 3');

  templateId = await createTemplate(db.migrator, 'rec-template', 'Monthly walkthrough');
  await registerItems(db.migrator, templateId, [ITEM, OTHER_ITEM]);

  versionV1 = await publishVersion(db.migrator, templateId, 1, documentV1());
  versionV2 = await publishVersion(db.migrator, templateId, 2, documentV2());
  versionV3 = await publishVersion(db.migrator, templateId, 3, documentV3());

  inspector = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
  inspectorB = await createAccount(db.app, { siteIds: [SITE_B], role: 'jhsc_member' });
  coordinator = await createAccount(db.app, {
    siteIds: [SITE_A, SITE_B],
    role: 'hs_coordinator',
  });
  supervisor = await createAccount(db.app, { siteIds: [SITE_A], role: 'supervisor' });
}, 180_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

// ---------------------------------------------------------------------------

describe('la prueba de aceptación del riesgo A', () => {
  /**
   * §5 riesgo A, textual: tres versiones sucesivas con ediciones realistas —v1 crea el
   * ítem y un hallazgo; v2 le cambia la redacción, lo mueve de sección y lo reordena, y
   * genera dos; v3 le cambia el tipo de respuesta y genera uno—.
   *
   * ASERCIÓN: la consulta de recurrencia devuelve UNA SERIE DE 4.
   *
   * Si devuelve 1 + 2 + 1, el esquema está mal y la feature más valiosa del sistema
   * estaría mostrando "no hay patrón" sobre datos que sí tienen uno.
   */
  it('devuelve UNA serie de 4 a través de tres versiones de plantilla', async () => {
    await occur({ version: versionV1, location: packLine3, monthsAgo: 8 });
    await occur({ version: versionV2, location: packLine3, monthsAgo: 7 });
    await occur({ version: versionV2, location: packLine3, monthsAgo: 6 });
    await occur({ version: versionV3, location: packLine3, monthsAgo: 5 });

    const result = await report(sessionFor(coordinator.accountId, [SITE_A], 'hs_coordinator'));
    const series = seriesFor(result.series, ITEM, packLine3);

    expect(series).toHaveLength(1);
    expect(one(series).occurrence_count).toBe(4);

    // Y cruzó las tres versiones: el número que hace auditable que agrupó por el
    // concepto y no por la fila publicada.
    expect(one(series).template_version_item_count).toBe(3);
  });

  it('muestra la redacción de la versión más reciente, no la de v1', async () => {
    const result = await report(sessionFor(coordinator.accountId, [SITE_A], 'hs_coordinator'));
    const series = one(seriesFor(result.series, ITEM, packLine3));

    expect(series.item_prompt).toBe('Are all machine guards fitted and secured?');
  });

  /**
   * El test hermano: ningún camino agrupa por `template_version_item_id`. Los cuatro
   * hallazgos de arriba tienen tres `template_version_item_id` distintos y caen en la
   * misma serie en los dos modos.
   */
  it('no parte la serie por la fila publicada, en ninguno de los dos modos', async () => {
    const session = sessionFor(coordinator.accountId, [SITE_A], 'hs_coordinator');

    const byLocation = seriesFor((await report(session, 12, 'item_location')).series, ITEM);
    const byItem = seriesFor((await report(session, 12, 'item')).series, ITEM);

    // Una sola serie en cada modo: si agrupara por la fila publicada, habría tres.
    expect(byLocation).toHaveLength(1);
    expect(byItem).toHaveLength(1);
    expect(one(byItem).occurrence_count).toBe(4);
  });
});

describe('la marca del hallazgo', () => {
  it('la cuarta ocurrencia sabe que es la cuarta', async () => {
    // Las tres primeras ya existen del bloque anterior, en `pack-line-3`.
    const inspectionId = await occur({ location: packLine3, monthsAgo: 4 });
    const mark = one(await marksOf(inspectionId));

    expect(mark.prior_count).toBe(4);
    expect(mark.is_recurrent).toBe(true);
    expect(mark.window_months).toBe(12);
    expect(mark.first_prior_occurred_at).not.toBeNull();
  });

  it('la primera ocurrencia se marca como NO recurrente, no se deja sin marcar', async () => {
    const inspectionId = await occur({
      itemKey: OTHER_ITEM,
      location: shippingBay,
      monthsAgo: 6,
    });
    const mark = one(await marksOf(inspectionId));

    expect(mark.prior_count).toBe(0);
    expect(mark.is_recurrent).toBe(false);
    expect(mark.first_prior_occurred_at).toBeNull();
  });

  it('el mismo ítem en una ubicación nueva es recurrente solo a nivel sitio', async () => {
    const inspectionId = await occur({ location: shippingBay, monthsAgo: 3 });
    const mark = one(await marksOf(inspectionId));

    expect(mark.prior_count).toBe(0);
    expect(mark.prior_count_site_wide).toBeGreaterThanOrEqual(4);
  });

  /**
   * Dos guardas faltantes encontradas en la MISMA caminata son un hallazgo cada una, no
   * una recurrencia de la otra. Sin la línea que excluye el propio envío, el segundo
   * hallazgo se marcaría recurrente por una recurrencia de cero meses (design D7).
   */
  it('dos hallazgos del mismo envío no se cuentan entre sí', async () => {
    const inspectionId = await occur({
      site: SITE_B,
      location: locationB,
      monthsAgo: 5,
      alsoOther: true,
    });

    const marks = await marksOf(inspectionId, [SITE_B]);

    expect(marks).toHaveLength(2);
    for (const mark of marks) expect(mark.prior_count).toBe(0);
  });

  it('el conteo no ve los hallazgos de la otra planta', async () => {
    // SITE_A tiene cinco de `rec.guards`; el primero de SITE_B tiene que nacer en cero.
    const inspectionId = await occur({ site: SITE_B, location: locationB, monthsAgo: 4 });
    const mark = one(await marksOf(inspectionId, [SITE_B]));

    expect(mark.prior_count_site_wide).toBe(1);
  });

  it('un hallazgo manual no recibe marca', async () => {
    const manual = await insertManualFinding('Hazard seen while walking past the dock');

    expect(await markCount(manual)).toBe(0);
  });

  /**
   * La barrera del motor, no del servicio: sin `item_key` no hay destino para la FK
   * compuesta contra `finding (id, item_key)`, así que la marca no llega a existir.
   */
  it('el motor rechaza una marca sobre un hallazgo sin item_key', async () => {
    const manual = await insertManualFinding('Another hazard seen outside an inspection');

    const error = await inScope(
      db.app,
      [SITE_A],
      `INSERT INTO finding_recurrence (finding_id, site_id, item_key, location_id,
                                       window_months, prior_count, prior_count_site_wide)
       VALUES ($1, $2, $3, $4, 12, 0, 0)`,
      [manual, SITE_A, ITEM, packLine3],
    ).catch((caught: unknown) => caught);

    // 23503: violación de clave foránea, y la del par (id, item_key) en particular —
    // el sitio es el correcto, así que la otra FK compuesta no tiene nada que objetar.
    expect(sqlstate(error)).toBe('23503');
    expect(constraintOf(error)).toBe('finding_recurrence_finding_item_fk');
  });

  it('un hallazgo no puede llevar dos marcas', async () => {
    const existing = one(
      await inScope<{ finding_id: string; site_id: string; item_key: string; location_id: string }>(
        db.app,
        [SITE_A],
        'SELECT finding_id, site_id, item_key, location_id FROM finding_recurrence LIMIT 1',
      ),
    );

    const error = await inScope(
      db.app,
      [SITE_A],
      `INSERT INTO finding_recurrence (finding_id, site_id, item_key, location_id,
                                       window_months, prior_count, prior_count_site_wide)
       VALUES ($1, $2, $3, $4, 12, 0, 0)`,
      [existing.finding_id, existing.site_id, existing.item_key, existing.location_id],
    ).catch((caught: unknown) => caught);

    // 23505: violación de único.
    expect(sqlstate(error)).toBe('23505');
  });
});

describe('la marca es un hecho del momento y no se recalcula', () => {
  it('un hallazgo posterior no cambia la marca de uno anterior', async () => {
    const first = await occur({ itemKey: OTHER_ITEM, location: packLine3, monthsAgo: 9 });
    const before = one(await marksOf(first)).prior_count;

    await occur({ itemKey: OTHER_ITEM, location: packLine3, monthsAgo: 2 });
    await occur({ itemKey: OTHER_ITEM, location: packLine3, monthsAgo: 1 });

    expect(one(await marksOf(first)).prior_count).toBe(before);
  });

  /**
   * Design D2 — la serie NO se construye desde `prior_count`. Si lo hiciera, un reporte a
   * 24 meses quedaría limitado por marcas calculadas a 12.
   */
  it('un reporte a 24 meses no queda capado por marcas calculadas a 12', async () => {
    await occur({ location: shippingBay, monthsAgo: 20 });
    await occur({ location: shippingBay, monthsAgo: 18 });

    const session = sessionFor(coordinator.accountId, [SITE_A], 'hs_coordinator');
    const wide = one(seriesFor((await report(session, 24)).series, ITEM, shippingBay));
    const narrow = seriesFor((await report(session, 12)).series, ITEM, shippingBay);

    // Todas las marcas de este spec se escribieron con `window_months` 12, y sin
    // embargo la ventana de 24 ve más ocurrencias que la de 12.
    expect(wide.occurrence_count).toBeGreaterThan(
      narrow.length === 0 ? 0 : one(narrow).occurrence_count,
    );
  });
});

describe('la ventana', () => {
  it('cuenta sobre occurred_at y no sobre recorded_at', async () => {
    // `occurred_at` es el `signed_at` del envío —13 meses atrás— y `recorded_at` es
    // ahora. Con ventana de 12 el hallazgo NO cuenta; con 24 sí. Si la ventana mirara
    // `recorded_at`, contaría en las dos.
    const session = sessionFor(coordinator.accountId, [SITE_A], 'hs_coordinator');
    const location = await createLocation(db.app, SITE_A, 'old-bay', 'Old bay');

    await occur({ location, monthsAgo: 13 });
    await occur({ location, monthsAgo: 14 });

    expect(seriesFor((await report(session, 12)).series, ITEM, location)).toHaveLength(0);
    expect(seriesFor((await report(session, 24)).series, ITEM, location)).toHaveLength(1);
  });

  it('una sola ocurrencia no es una serie', async () => {
    const session = sessionFor(coordinator.accountId, [SITE_A], 'hs_coordinator');
    const location = await createLocation(db.app, SITE_A, 'lone-bay', 'Lone bay');

    await occur({ location, monthsAgo: 2 });

    expect(seriesFor((await report(session, 12)).series, ITEM, location)).toHaveLength(0);
  });
});

describe('los dos modos de agrupación', () => {
  it('la misma clave en dos ubicaciones son dos series por defecto y una en modo item', async () => {
    const session = sessionFor(coordinator.accountId, [SITE_A], 'hs_coordinator');

    // Ventana de 24: dentro de 12, `shipping-bay` tiene una sola ocurrencia y no forma
    // serie, así que no habría dos ubicaciones que comparar.
    const byLocation = seriesFor((await report(session, 24, 'item_location')).series, ITEM);
    const byItem = seriesFor((await report(session, 24, 'item')).series, ITEM);

    // Por defecto, una serie por ubicación con recurrencia.
    expect(byLocation.length).toBeGreaterThan(1);
    for (const series of byLocation) {
      expect(series.location_id).not.toBeNull();
      expect(series.location_count).toBe(1);
    }

    // En modo sistémico, una sola serie sin ubicación.
    expect(byItem).toHaveLength(1);
    expect(one(byItem).location_id).toBeNull();
    expect(one(byItem).location_count).toBeGreaterThan(1);

    // Y suma al menos lo que suman las series por ubicación. `>=` y no `===` a
    // propósito: una ubicación con UNA sola ocurrencia no forma serie propia —el umbral
    // es dos— pero sí cuenta en el total del sitio. Exigir igualdad sería exigir que el
    // umbral se aplique dos veces, que es justo lo que no tiene que pasar.
    const sumByLocation = byLocation.reduce(
      (total, series) => total + series.occurrence_count,
      0,
    );

    expect(one(byItem).occurrence_count).toBeGreaterThanOrEqual(sumByLocation);
  });

  it('las series vienen ordenadas por conteo descendente', async () => {
    const session = sessionFor(coordinator.accountId, [SITE_A], 'hs_coordinator');
    const counts = (await report(session, 24)).series.map((series) => series.occurrence_count);

    expect(counts).toEqual([...counts].sort((left, right) => right - left));
  });
});

describe('el aislamiento por sitio', () => {
  it('un miembro del JHSC de una planta no ve los patrones de la otra', async () => {
    const result = await report(sessionFor(inspectorB.accountId, [SITE_B]));

    for (const series of result.series) expect(series.site_id).toBe(SITE_B);
  });

  /**
   * §5 pregunta 5 — el lector con alcance a las dos plantas recibe DOS series y no una
   * que las mezcle. `site_id` está en el `GROUP BY` por esto.
   */
  it('un lector de las dos plantas recibe dos series, no una fusionada', async () => {
    const session = sessionFor(coordinator.accountId, [SITE_A, SITE_B], 'hs_coordinator');

    // SITE_B necesita una segunda ocurrencia para que su serie exista.
    await occur({ site: SITE_B, location: locationB, monthsAgo: 3 });

    const byItem = seriesFor((await report(session, 12, 'item')).series, ITEM);
    const sites = byItem.map((series) => series.site_id).sort();

    expect(sites).toEqual([SITE_A, SITE_B].sort());
  });
});

describe('los hallazgos manuales, que quedan fuera de toda serie', () => {
  it('no entran a la serie y se cuentan aparte', async () => {
    const session = sessionFor(coordinator.accountId, [SITE_A], 'hs_coordinator');
    const before = await report(session, 12);

    await insertManualFinding('Same hazard, reported by hand outside an inspection');

    const after = await report(session, 12);
    const beforeSeries = seriesFor(before.series, ITEM, packLine3);
    const afterSeries = seriesFor(after.series, ITEM, packLine3);

    // El conteo de la serie NO se movió...
    expect(one(afterSeries).occurrence_count).toBe(one(beforeSeries).occurrence_count);
    // ...y el hallazgo no desapareció del reporte: está en el número que dice cuántos
    // quedaron fuera. Sin él, "no hay patrones" sería indistinguible de "no se miró".
    expect(after.excluded_manual_count).toBe(before.excluded_manual_count + 1);
  });

  it('el conteo de excluidos viaja también cuando no hay ninguna serie', async () => {
    const result = await report(sessionFor(inspectorB.accountId, [SITE_B]), 1);

    expect(result.series).toEqual([]);
    expect(result.excluded_manual_count).toBe(0);
  });
});

describe('la inmutabilidad de la marca', () => {
  async function anyMark(): Promise<string> {
    const rows = await inScope<{ finding_id: string }>(
      db.app,
      [SITE_A],
      'SELECT finding_id FROM finding_recurrence LIMIT 1',
    );

    return one(rows).finding_id;
  }

  it('el rol de la aplicación no puede reescribir un conteo', async () => {
    const error = await inScope(
      db.app,
      [SITE_A],
      'UPDATE finding_recurrence SET prior_count = 0 WHERE finding_id = $1',
      [await anyMark()],
    ).catch((caught: unknown) => caught);

    // 42501: privilegio insuficiente. Nunca se otorgó UPDATE.
    expect(sqlstate(error)).toBe('42501');
  });

  it('al dueño de la tabla lo frena el trigger, no el privilegio', async () => {
    const error = await inScope(
      db.migrator,
      [SITE_A],
      'UPDATE finding_recurrence SET prior_count = 0 WHERE finding_id = $1',
      [await anyMark()],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('HS001');
  });

  it('ningún rol borra ni trunca una marca', async () => {
    const findingId = await anyMark();

    const deleted = await inScope(
      db.app,
      [SITE_A],
      'DELETE FROM finding_recurrence WHERE finding_id = $1',
      [findingId],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(deleted)).toBe('42501');

    const truncated = await inScope(db.app, [SITE_A], 'TRUNCATE finding_recurrence').catch(
      (caught: unknown) => caught,
    );

    expect(sqlstate(truncated)).toBe('42501');
  });

  it('is_recurrent no se puede escribir: la calcula el motor', async () => {
    const error = await inScope(
      db.app,
      [SITE_A],
      `INSERT INTO finding_recurrence (finding_id, site_id, item_key, location_id,
                                       window_months, prior_count, prior_count_site_wide,
                                       is_recurrent)
       VALUES ($1, $2, $3, $4, 12, 0, 0, true)`,
      [randomUUID(), SITE_A, ITEM, packLine3],
    ).catch((caught: unknown) => caught);

    // 428C9: no se puede insertar en una columna generada.
    expect(sqlstate(error)).toBe('428C9');
  });

  /**
   * Se prueba sobre un hallazgo SIN marca —uno manual— y no sobre uno derivado: los
   * derivados ya tienen la suya, así que el único de `finding_id` saltaría primero y el
   * test estaría probando el único en vez de la FK que dice probar.
   */
  it('una marca no puede reclamar el sitio de la otra planta', async () => {
    const manual = await insertManualFinding('Hazard used to probe the site foreign key');

    const error = await inScope(
      db.app,
      [SITE_A, SITE_B],
      `INSERT INTO finding_recurrence (finding_id, site_id, item_key, location_id,
                                       window_months, prior_count, prior_count_site_wide)
       VALUES ($1, $2, $3, $4, 12, 0, 0)`,
      [manual, SITE_B, ITEM, locationB],
    ).catch((caught: unknown) => caught);

    // La FK compuesta contra `finding (id, site_id)` no encuentra destino: el hallazgo
    // existe, pero no en la planta que la marca declara.
    expect(sqlstate(error)).toBe('23503');
    expect(constraintOf(error)).toBe('finding_recurrence_finding_site_fk');
  });

  it('el alcance de una planta no ve las marcas de la otra', async () => {
    const inA = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*)::text AS count FROM finding_recurrence WHERE site_id = $1`,
      [SITE_B],
    );

    expect(Number(one(inA).count)).toBe(0);
  });
});

describe('los parámetros vuelven en la respuesta', () => {
  it('el cliente que no mandó ninguno sabe con cuáles se calculó', async () => {
    const result = await report(sessionFor(coordinator.accountId, [SITE_A], 'hs_coordinator'));

    expect(result.window_months).toBe(12);
    expect(result.group_by).toBe('item_location');
  });
});
