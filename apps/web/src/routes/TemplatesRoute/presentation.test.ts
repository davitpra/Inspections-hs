import type { PublishedTemplateSummary, TemplateDraftSummary } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  draftKindLabel,
  isTemplateActive,
  isTemplateArchived,
  publishedCountLabel,
  publishedVersionLabel,
  sortPublishedTemplates,
  splitPublishedTemplates,
  templateStatusClass,
  templateStatusLabel,
} from './presentation';

const VERSION_ID = '22222222-2222-4222-8222-222222222222';

function template(
  name: string,
  deactivatedAt: string | null = null,
  archivedAt: string | null = null,
): PublishedTemplateSummary {
  return {
    id: name === 'Alpha' ? '11111111-1111-4111-8111-111111111111' : '33333333-3333-4333-8333-333333333333',
    key: name.toLowerCase(),
    name,
    latest_version: 2,
    latest_version_id: VERSION_ID,
    latest_published_at: '2026-08-22 10:00:00+00',
    deactivated_at: deactivatedAt,
    archived_at: archivedAt,
  };
}

describe('plantillas publicadas', () => {
  it('las ordena por nombre', () => {
    expect(sortPublishedTemplates([template('Zeta'), template('Alpha')]).map((item) => item.name)).toEqual([
      'Alpha',
      'Zeta',
    ]);
  });

  it('etiqueta la versión', () => {
    expect(publishedVersionLabel(3)).toBe('Version 3');
  });

  it('etiqueta el conteo en singular y plural', () => {
    expect(publishedCountLabel(1)).toBe('1 template');
    expect(publishedCountLabel(2)).toBe('2 templates');
  });

  /**
   * Una retirada NO se va al fondo ni se filtra: se la busca por su nombre igual que a
   * cualquier otra, y más a menudo, porque se la busca para reactivarla.
   */
  it('ordena por nombre sin separar las retiradas', () => {
    expect(
      sortPublishedTemplates([
        template('Zeta'),
        template('Alpha', '2026-08-23T10:00:00.000Z'),
      ]).map((item) => item.name),
    ).toEqual(['Alpha', 'Zeta']);
  });

  it('distingue la activa de la retirada', () => {
    expect(isTemplateActive(template('Alpha'))).toBe(true);
    expect(isTemplateActive(template('Alpha', '2026-08-23T10:00:00.000Z'))).toBe(false);
  });

  it('separa las archivadas y las identifica', () => {
    const result = splitPublishedTemplates([
      template('Archived', '2026-08-23T10:00:00.000Z', '2026-08-24T10:00:00.000Z'),
      template('Visible'),
    ]);

    expect(result.visible.map((item) => item.name)).toEqual(['Visible']);
    expect(result.archived.map((item) => item.name)).toEqual(['Archived']);
    expect(isTemplateArchived(result.archived[0]!)).toBe(true);
  });

  it('dice el estado en palabras', () => {
    expect(templateStatusLabel(template('Alpha'))).toBe('Active');
    expect(templateStatusLabel(template('Alpha', '2026-08-23T10:00:00.000Z'))).toBe('Deactivated');
    expect(templateStatusLabel(template('Alpha', '2026-08-23T10:00:00.000Z', '2026-08-24T10:00:00.000Z'))).toBe('Archived');
  });

  /** Las mismas clases que la tabla de requisitos: el mismo hecho no se pinta de dos formas. */
  it('pinta el pill del estado', () => {
    expect(templateStatusClass(template('Alpha'))).toBe('status-pill status-pill--open');
    expect(templateStatusClass(template('Alpha', '2026-08-23T10:00:00.000Z'))).toBe(
      'status-pill status-pill--cancelled',
    );
  });
});

describe('qué es cada borrador del listado', () => {
  function summary(overrides: Partial<TemplateDraftSummary> = {}): TemplateDraftSummary {
    return {
      id: '44444444-4444-4444-8444-444444444444',
      key: 'monthly-electrical',
      name: 'Monthly electrical inspection',
      updated_at: '2026-08-22T10:00:00.000Z',
      publishable: true,
      site_ids: ['55555555-5555-4555-8555-555555555555'],
      template_id: null,
      next_version: 1,
      ...overrides,
    };
  }

  it('un borrador sin plantilla va a crear una', () => {
    expect(draftKindLabel(summary())).toBe('New template');
  });

  /**
   * Sin esto los dos renglones se ven idénticos: una revisión lleva a propósito la misma clave
   * y el mismo nombre que la plantilla que corrige.
   */
  it('uno ligado a una plantilla la corrige, y dice con qué número', () => {
    expect(
      draftKindLabel(
        summary({ template_id: '66666666-6666-4666-8666-666666666666', next_version: 4 }),
      ),
    ).toBe('Revision · version 4');
  });
});
