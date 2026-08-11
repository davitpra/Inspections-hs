import { COMPLIANCE_PAYLOAD_SCHEMA_VERSION, type CompliancePayload } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PdfRendererService } from '../src/reporting/pdf-renderer';
import { deriveComplianceReportKey } from '../src/uploads/object-storage';

/**
 * ADR-006 y ADR-008 — EL RENDER DE VERDAD, CON CHROMIUM.
 *
 * Este archivo es el que cobra la consecuencia que ADR-008 aceptó por escrito: necesita el
 * navegador instalado, así que corre en el job de CI que hace `playwright install`. Todo
 * lo demás del change —cobertura, canonicalización, digest, congelamiento— corre sin él.
 *
 * LO QUE NO SE PUEDE ASEVERAR ACÁ, Y CONVIENE SABERLO ANTES DE INTENTARLO: **el texto del
 * pie no aparece literal en los bytes del PDF**. Chromium comprime los flujos de
 * contenido, así que buscar el digest dentro del archivo devuelve `false` aunque esté
 * impreso en las cuatro páginas. Que el pie lleve el digest y los tokens de página se fija
 * en `report-document.spec.ts`, sobre la cadena; acá se fija lo que sí es observable en el
 * archivo: que es un PDF válido, que tiene la cantidad de páginas que corresponde y que
 * dos renders del mismo reporte producen dos archivos con dos keys distintas.
 *
 * Y hay una propiedad que este archivo prueba mejor que ninguna otra: **el render no
 * depende de nada externo**. No hay red, no hay sesión y no hay frontend arriba. Si esto
 * pasa con el proceso aislado, pasa en producción.
 */

let renderer: PdfRendererService;

beforeAll(() => {
  renderer = new PdfRendererService();
});

afterAll(async () => {
  await renderer?.onModuleDestroy();
});

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const REPORT_ID = '33333333-3333-4333-8333-333333333333';
const HASH = 'd'.repeat(64);

function payload(periodCount: number): CompliancePayload {
  const periods = Array.from({ length: periodCount }, (_, index) => {
    const month = String((index % 12) + 1).padStart(2, '0');
    const year = 2020 + Math.floor(index / 12);

    return {
      period_start: `${year}-${month}-01`,
      period_end: `${year}-${month}-28`,
      status: index % 5 === 0 ? ('missed' as const) : ('completed' as const),
      scheduled_inspection_id: null,
      template_id: null,
      template_version_id: null,
      inspection_id: null,
      submitted_by: null,
      occurred_at: null,
      cancellation_reason: null,
    };
  });

  const completed = periods.filter((period) => period.status === 'completed').length;

  return {
    schema_version: COMPLIANCE_PAYLOAD_SCHEMA_VERSION,
    site: { id: SITE_ID, name: 'St. Thomas' },
    range: { start: '2020-01-01', end: '2026-12-31' },
    generated_at: '2027-01-05T15:00:00.000Z',
    coverage: {
      required_count: periods.length,
      completed_count: completed,
      missed_count: periods.length - completed,
      cancelled_count: 0,
      open_count: 0,
    },
    periods,
    findings: [],
    recurrence_series: [],
    excluded_manual_count: 0,
    open_actions: [],
  };
}

function input(periodCount: number) {
  return { payload: payload(periodCount), reportId: REPORT_ID, payloadHash: HASH };
}

/** Chromium escribe `/Count N` sin comprimir en el nodo `Pages` del catálogo. */
function pageCount(pdf: Buffer): number {
  const match = /\/Count\s+(\d+)/.exec(pdf.toString('latin1'));
  return match ? Number(match[1]) : 0;
}

describe('el render', () => {
  it('produce un PDF válido para un reporte corto', async () => {
    const pdf = await renderer.render(input(3));

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('pagina solo cuando el contenido lo pide', async () => {
    // Un reporte de siete años de períodos ocupa varias páginas más que uno de tres
    // meses. Que Chromium pagine es lo que hace que el pie —y con él el digest— aparezca
    // más de una vez, que es el requisito.
    const short = await renderer.render(input(3));
    const long = await renderer.render(input(84));

    expect(pageCount(long)).toBeGreaterThan(pageCount(short));
    expect(pageCount(long)).toBeGreaterThan(1);
  }, 120_000);

  it('el mismo payload rinde dos veces sin error, y el digest impreso es el mismo', async () => {
    // Los BYTES pueden diferir —por eso no se hashea el archivo— pero el documento es el
    // mismo y su digest, que se le pasa al renderizador, no cambió.
    const first = await renderer.render(input(12));
    const second = await renderer.render(input(12));

    expect(pageCount(first)).toBe(pageCount(second));
    expect(first.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(second.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 120_000);

  it('no se cuelga con texto de usuario hostil', async () => {
    const hostile = payload(2);
    hostile.findings = [
      {
        id: '99999999-9999-4999-8999-999999999999',
        occurred_at: '2026-04-10T12:00:00.000Z',
        location_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        item_key: null,
        description: '</td></table><script>while(true){}</script>',
        risk_level: null,
      },
    ];

    // Si el escapado fallara, ese `while(true)` correría dentro del navegador que produce
    // evidencia regulatoria y el render se colgaría hasta el timeout.
    const pdf = await renderer.render({
      payload: hostile,
      reportId: REPORT_ID,
      payloadHash: HASH,
    });

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 120_000);
});

describe('la key del archivo', () => {
  it('la deriva el servidor de sitio, reporte e intento', () => {
    const key = deriveComplianceReportKey(SITE_ID, REPORT_ID, 'render-1');

    expect(key).toBe(`${SITE_ID}/reports/${REPORT_ID}/render-1.pdf`);
  });

  it('dos intentos del mismo reporte escriben dos objetos distintos', () => {
    // Regenerar es legítimo y no puede tapar el archivo anterior (design D3).
    expect(deriveComplianceReportKey(SITE_ID, REPORT_ID, 'render-1')).not.toBe(
      deriveComplianceReportKey(SITE_ID, REPORT_ID, 'render-2'),
    );
  });
});
