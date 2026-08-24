import type { TemplateDraftSummary, TemplateOption } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  draftKindLabel,
  publishedCountLabel,
  publishedVersionLabel,
  sortPublishedTemplates,
} from './presentation';

const VERSION_ID = '22222222-2222-4222-8222-222222222222';

function template(name: string): TemplateOption {
  return {
    id: name === 'Alpha' ? '11111111-1111-4111-8111-111111111111' : '33333333-3333-4333-8333-333333333333',
    key: name.toLowerCase(),
    name,
    latest_version: 2,
    latest_version_id: VERSION_ID,
    latest_published_at: '2026-08-22 10:00:00+00',
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
