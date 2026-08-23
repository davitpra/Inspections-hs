import type { TemplateOption } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
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
