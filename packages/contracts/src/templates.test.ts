import { describe, expect, it } from 'vitest';

import {
  publishedTemplateSchema,
  publishedTemplateSummarySchema,
  publishedTemplateVersionSchema,
} from './templates.js';

const document = {
  sections: [
    {
      section_key: 'guarding',
      section_title: 'Machine guarding',
      position: 1,
      items: [
        {
          item_key: 'guarding.installed',
          prompt: 'Are all guards installed?',
          position: 1,
          required: true,
          response_type: 'yes_no' as const,
        },
      ],
    },
  ],
};

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

describe('publishedTemplateVersionSchema', () => {
  it('acepta una versión completa con su identidad y documento', () => {
    expect(
      publishedTemplateVersionSchema.parse({
        template_id: '11111111-1111-4111-8111-111111111111',
        template_version_id: '22222222-2222-4222-8222-222222222222',
        key: 'machine-guarding',
        name: 'Machine guarding',
        version: 1,
        published_at: '2026-08-22 10:00:00+00',
        document,
      }),
    ).toMatchObject({ key: 'machine-guarding', document });
  });

  it.each([
    ['document without sections', { document: { sections: [] } }],
    ['version zero', { version: 0 }],
    ['an extra key', { extra: true }],
  ])('rechaza %s', (_label, override) => {
    const result = publishedTemplateVersionSchema.safeParse({
      template_id: '11111111-1111-4111-8111-111111111111',
      template_version_id: '22222222-2222-4222-8222-222222222222',
      key: 'machine-guarding',
      name: 'Machine guarding',
      version: 1,
      published_at: '2026-08-22 10:00:00+00',
      document,
      ...override,
    });

    expect(result.success).toBe(false);
  });
});

describe('publishedTemplateSummarySchema', () => {
  it('acepta las marcas de retiro y archivo', () => {
    expect(
      publishedTemplateSummarySchema.parse({
        id: '11111111-1111-4111-8111-111111111111',
        key: 'machine-guarding',
        name: 'Machine guarding',
        latest_version: 1,
        latest_version_id: '22222222-2222-4222-8222-222222222222',
        latest_published_at: '2026-08-22 10:00:00+00',
        deactivated_at: '2026-08-23T10:00:00.000Z',
        archived_at: '2026-08-24T10:00:00.000Z',
      }),
    ).toMatchObject({ archived_at: '2026-08-24T10:00:00.000Z' });
  });
});
