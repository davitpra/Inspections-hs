import { describe, expect, it } from 'vitest';

import { publishedTemplateSchema } from './templates.js';

describe('publishedTemplateSchema', () => {
  it('acepta la identidad de la versión publicada', () => {
    expect(
      publishedTemplateSchema.parse({
        template_id: '11111111-1111-4111-8111-111111111111',
        template_version_id: '22222222-2222-4222-8222-222222222222',
        version: 1,
      }),
    ).toEqual({
      template_id: '11111111-1111-4111-8111-111111111111',
      template_version_id: '22222222-2222-4222-8222-222222222222',
      version: 1,
    });
  });

  it('rechaza una respuesta con campos extra o una versión no positiva', () => {
    expect(
      publishedTemplateSchema.safeParse({
        template_id: '11111111-1111-4111-8111-111111111111',
        template_version_id: '22222222-2222-4222-8222-222222222222',
        version: 0,
        name: 'Unexpected',
      }).success,
    ).toBe(false);
  });
});
