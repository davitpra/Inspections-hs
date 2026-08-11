import { COMPLIANCE_PAYLOAD_SCHEMA_VERSION, type CompliancePayload } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import { complianceFooterTemplate, renderComplianceHtml } from './report-document';

const HASH = 'b'.repeat(64);
const REPORT_ID = '33333333-3333-4333-8333-333333333333';

function payload(overrides: Partial<CompliancePayload> = {}): CompliancePayload {
  return {
    schema_version: COMPLIANCE_PAYLOAD_SCHEMA_VERSION,
    site: { id: '11111111-1111-4111-8111-111111111111', name: 'St. Thomas' },
    range: { start: '2026-01-01', end: '2026-12-31' },
    generated_at: '2027-01-05T15:00:00.000Z',
    coverage: {
      required_count: 12,
      completed_count: 11,
      missed_count: 1,
      cancelled_count: 0,
      open_count: 0,
    },
    periods: [
      {
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        status: 'missed',
        scheduled_inspection_id: null,
        template_id: null,
        template_version_id: null,
        inspection_id: null,
        submitted_by: null,
        occurred_at: null,
        cancellation_reason: null,
      },
    ],
    findings: [],
    recurrence_series: [],
    excluded_manual_count: 0,
    open_actions: [],
    ...overrides,
  };
}

function input(overrides: Partial<CompliancePayload> = {}) {
  return { payload: payload(overrides), reportId: REPORT_ID, payloadHash: HASH };
}

/**
 * El documento sin su hoja de estilos.
 *
 * Las aserciones sobre porcentajes miran lo que el documento DICE, y el CSS de impresión
 * está lleno de `width: 100%` que no son afirmaciones sobre cumplimiento.
 */
function body(overrides: Partial<CompliancePayload> = {}): string {
  return renderComplianceHtml(input(overrides)).replace(/<style>[\s\S]*?<\/style>/, '');
}

describe('el documento', () => {
  it('muestra la cobertura como fracción y NO como porcentaje', () => {
    expect(body()).toContain('11 of 12 required periods completed');
    // §5 riesgo E: el scoring salió de v1 y el documento no lo reintroduce por la
    // ventana. Un porcentaje en un documento regulatorio es un número que hay que
    // defender.
    expect(body()).not.toContain('%');
  });

  it('dice que el digest cubre el payload y no el archivo', () => {
    // Sin este párrafo, alguien compararía el SHA-256 del PDF contra el número impreso,
    // no coincidiría, y concluiría exactamente lo contrario de lo que pasa.
    const html = renderComplianceHtml(input());

    expect(html).toContain('canonical JSON');
    expect(html).toContain('RFC 8785');
    expect(html).toMatch(/not<\/strong> over the bytes of this PDF/);
  });

  it('distingue el mes que nunca se planificó del que se planificó y no se hizo', () => {
    const html = renderComplianceHtml(input());

    expect(html).toContain('never scheduled');
  });

  it('declara cuántos hallazgos quedaron fuera de toda serie', () => {
    const html = renderComplianceHtml(input({ excluded_manual_count: 3 }));

    expect(html).toContain('3 finding(s) in this period were entered manually');
  });

  it('escapa el texto que escribieron personas en el campo', () => {
    const html = renderComplianceHtml(
      input({
        findings: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            occurred_at: '2026-04-10T12:00:00.000Z',
            location_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            item_key: null,
            description: '<script>alert("x")</script> guard <missing>',
            risk_level: null,
          },
        ],
      }),
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;missing&gt;');
  });

  it('muestra "unclassified" y "manual entry" en vez de celdas vacías', () => {
    const html = renderComplianceHtml(
      input({
        findings: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            occurred_at: '2026-04-10T12:00:00.000Z',
            location_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            item_key: null,
            description: 'Spill by the dock',
            risk_level: null,
          },
        ],
      }),
    );

    expect(html).toContain('unclassified');
    expect(html).toContain('manual entry');
  });

  it('no imprime ningún número que no esté en el payload', () => {
    // El documento no suma, no promedia y no redondea: si lo hiciera, diría cosas que su
    // propio digest no cubre.
    expect(body()).not.toMatch(/\d+(\.\d+)?\s*%/);
  });
});

describe('el pie de página', () => {
  it('lleva el digest, el reporte, el sitio, el rango y la fecha', () => {
    const footer = complianceFooterTemplate(input());

    expect(footer).toContain(HASH);
    expect(footer).toContain(REPORT_ID);
    expect(footer).toContain('St. Thomas');
    expect(footer).toContain('2026-01-01');
    expect(footer).toContain('2027-01-05T15:00:00.000Z');
  });

  it('usa los tokens de página de Chromium, que es lo que lo pone en TODAS las páginas', () => {
    // La aserción de que el pie sale en las cuatro páginas de un documento de cuatro no
    // se puede hacer sobre el PDF: Chromium comprime los flujos de texto y el digest no
    // aparece literal en los bytes. Lo que sí se puede fijar es que el pie usa el
    // mecanismo que Chromium repite por página, en vez de un div al final del cuerpo.
    const footer = complianceFooterTemplate(input());

    expect(footer).toContain('class="pageNumber"');
    expect(footer).toContain('class="totalPages"');
  });

  it('escapa también en el pie', () => {
    const footer = complianceFooterTemplate(
      input({ site: { id: '11111111-1111-4111-8111-111111111111', name: 'Plant <b>A</b>' } }),
    );

    expect(footer).not.toContain('<b>');
    expect(footer).toContain('&lt;b&gt;');
  });
});
