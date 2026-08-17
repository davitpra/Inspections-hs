import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InspectionReportRoute } from './index';

const getSubmittedInspection = vi.hoisted(() => vi.fn());

vi.mock('../../api/inspections', () => ({ getSubmittedInspection }));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: INSPECTION }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

const INSPECTION = '11111111-1111-4111-8111-111111111111';

/**
 * El documento trae un ítem condicional (`general.spill-cleanup`), que solo se pregunta
 * cuando hubo derrame. Las respuestas dicen que no lo hubo, así que ese ítem NO se
 * preguntó — es el caso que separa esta pantalla de la vista previa.
 */
function report(overrides: Record<string, unknown> = {}) {
  return {
    scheduled_inspection_id: INSPECTION,
    inspection_id: '22222222-2222-4222-8222-222222222222',
    site_id: '33333333-3333-4333-8333-333333333333',
    period_start: '2027-07-01',
    template_name: 'Monthly general workplace inspection',
    template_version_id: '44444444-4444-4444-8444-444444444444',
    template_version: 2,
    document: {
      sections: [
        {
          section_key: 'general',
          section_title: 'Work areas and housekeeping',
          position: 1,
          items: [
            {
              item_key: 'general.guards',
              prompt: 'Machine guards in place',
              position: 1,
              required: true,
              response_type: 'yes_no',
            },
            {
              item_key: 'general.spill',
              prompt: 'Spill present',
              position: 2,
              required: true,
              response_type: 'yes_no_na',
            },
            {
              item_key: 'general.spill-cleanup',
              prompt: 'Spill cleaned up',
              position: 3,
              required: true,
              response_type: 'yes_no',
              visible_when: { item_key: 'general.spill', operator: 'equals', value: 'yes' },
            },
            {
              item_key: 'general.photo',
              prompt: 'Photo of the dock',
              position: 4,
              required: true,
              response_type: 'photo',
              min_count: 1,
              max_count: 3,
            },
          ],
        },
      ],
    },
    answers: {
      'general.guards': false,
      'general.spill': 'na',
      'general.photo': ['site/a.jpg', 'site/b.jpg'],
    },
    findings: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        site_id: '33333333-3333-4333-8333-333333333333',
        origin: 'inspection',
        inspection_id: '22222222-2222-4222-8222-222222222222',
        template_version_item_id: '66666666-6666-4666-8666-666666666666',
        item_key: 'general.guards',
        location_id: '77777777-7777-4777-8777-777777777777',
        description: 'Guard missing on the infeed of packaging line 3',
        photo_object_keys: ['site/finding.jpg'],
        reported_by: '88888888-8888-4888-8888-888888888888',
        occurred_at: '2027-07-29T18:00:00.000Z',
        recorded_at: '2027-07-29T18:05:00.000Z',
        assessment: null,
        recurrence: null,
      },
    ],
    submitted_by: '88888888-8888-4888-8888-888888888888',
    submitted_by_name: 'Marie Tremblay',
    signed_at: '2027-07-29T18:00:00.000Z',
    received_at: '2027-08-02T13:00:00.000Z',
    answer_count: 3,
    ...overrides,
  };
}

function renderRoute(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <InspectionReportRoute />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InspectionReportRoute', () => {
  it('lee las respuestas registradas, con quién firmó y cuándo', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    expect(await screen.findByText('Machine guards in place')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
    expect(screen.getByText('Not applicable')).toBeTruthy();
    expect(screen.getByText('Marie Tremblay')).toBeTruthy();
    expect(screen.getByText('Jul 29, 2027')).toBeTruthy();
  });

  /**
   * Las dos fechas, y la de la firma es la que encabeza: los cuatro días de diferencia son
   * lo que el dispositivo estuvo sin señal, y el registro se fecha por cuándo se caminó.
   */
  it('muestra la recepción sin dejar que desplace a la firma', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    expect(await screen.findByText('Received Aug 2, 2027')).toBeTruthy();
  });

  /**
   * LA aserción de esta pantalla. `general.spill-cleanup` solo se pregunta si hubo
   * derrame, y no lo hubo. Dibujarlo como "Not answered" leería como una inspección
   * incompleta en vez de una pregunta que nunca correspondió.
   */
  it('no muestra la pregunta que la condición escondió durante el recorrido', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    await screen.findByText('Machine guards in place');
    expect(screen.queryByText('Spill cleaned up')).toBeNull();
    expect(screen.queryByText('Not answered')).toBeNull();
  });

  it('muestra el hallazgo junto a la respuesta que lo abrió', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    expect(
      await screen.findByText('Guard missing on the infeed of packaging line 3'),
    ).toBeTruthy();
    expect(screen.getByText('1 photo')).toBeTruthy();
  });

  /**
   * Las fotos no se pueden ver todavía. Que el conteo se lea es lo que impide que el
   * registro declare menos evidencia de la que tiene.
   */
  it('cuenta las fotos que no puede mostrar, y lo dice', async () => {
    getSubmittedInspection.mockResolvedValue(report());

    renderRoute();

    expect(await screen.findByText('2 photos')).toBeTruthy();
    expect(screen.getByText(/cannot be viewed yet/)).toBeTruthy();
  });

  it('sin red lo dice, y no dibuja un reporte a medias', async () => {
    getSubmittedInspection.mockRejectedValue(new Error('offline'));

    renderRoute();

    expect(await screen.findByText(/needs a connection/)).toBeTruthy();
    expect(screen.queryByText('Machine guards in place')).toBeNull();
  });
});
