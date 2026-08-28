import type { TemplateDocument, TemplateItem, VisibleWhen } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  failureThresholdLabel,
  findingConfiguration,
  responseConfiguration,
  responseTypeLabel,
  totalItems,
  visibilityLabel,
} from './presentation';

const document: TemplateDocument = {
  sections: [
    {
      section_key: 'guarding',
      section_title: 'Machine guarding',
      position: 2,
      items: [
        {
          item_key: 'guarding.installed',
          prompt: 'Are all guards installed?',
          position: 2,
          required: true,
          response_type: 'yes_no',
          fails_on: 'no',
        },
        {
          item_key: 'guarding.reason',
          prompt: 'Why is a guard missing?',
          position: 1,
          required: false,
          response_type: 'text',
          max_length: 200,
        },
      ],
    },
    {
      section_key: 'closing',
      section_title: 'Closing',
      position: 1,
      items: [
        {
          item_key: 'closing.signature',
          prompt: 'Inspector signature',
          position: 1,
          required: true,
          response_type: 'signature',
        },
      ],
    },
  ],
};

describe('PublishedTemplateRoute presentation', () => {
  it('cuenta las preguntas y usa el orden del motor', () => {
    expect(totalItems(document)).toBe(3);
  });

  it('traduce condiciones simples, all_of y any_of', () => {
    expect(
      visibilityLabel(
        { item_key: 'guarding.installed', operator: 'equals', value: false },
        document,
      ),
    ).toBe('Shown when Are all guards installed? is false');
    expect(
      visibilityLabel(
        {
          all_of: [
            { item_key: 'guarding.installed', operator: 'equals', value: false },
            { item_key: 'guarding.reason', operator: 'answered' },
          ],
        },
        document,
      ),
    ).toBe('Shown when Are all guards installed? is false and Why is a guard missing? has an answer');
    expect(
      visibilityLabel(
        {
          any_of: [
            { item_key: 'guarding.installed', operator: 'equals', value: false },
            { item_key: 'guarding.reason', operator: 'unanswered' },
          ],
        },
        document,
      ),
    ).toContain(' or ');
  });

  it('cae al item_key si una referencia no resuelve', () => {
    expect(
      visibilityLabel(
        { item_key: 'missing.item', operator: 'answered' } as VisibleWhen,
        document,
      ),
    ).toBe('Shown when missing.item has an answer');
  });

  it('presenta la configuración concreta de cada tipo', () => {
    const items: TemplateItem[] = [
      { ...document.sections[0]!.items[0]!, response_type: 'yes_no', fails_on: 'no' },
      { ...document.sections[0]!.items[0]!, response_type: 'yes_no_na', fails_on: 'no' },
      { ...document.sections[0]!.items[0]!, response_type: 'scale', min: 1, max: 5 },
      { ...document.sections[0]!.items[1]!, response_type: 'text', max_length: 200 },
      {
        ...document.sections[0]!.items[0]!,
        response_type: 'number',
        min: 0,
        max: 100,
        decimals: 1,
      },
      {
        ...document.sections[0]!.items[0]!,
        response_type: 'single_choice',
        options: [{ label: 'Yes', value: 'yes' }],
      },
      {
        ...document.sections[0]!.items[0]!,
        response_type: 'multi_choice',
        options: [{ label: 'Yes', value: 'yes' }],
        min_selected: 0,
        max_selected: 1,
      },
      { ...document.sections[0]!.items[0]!, response_type: 'photo', min_count: 1, max_count: 3 },
      { ...document.sections[0]!.items[0]!, response_type: 'signature' },
    ];

    expect(items.map(responseTypeLabel)).toHaveLength(9);
    expect(items.map((item) => responseConfiguration(item))).toEqual([
      ['Fails on: No'],
      ['Fails on: No'],
      ['Range: 1 to 5'],
      ['Maximum length: 200 characters'],
      ['Range: 0 to 100', 'Decimal places: 1'],
      ['Options: Yes (yes)'],
      ['Options: Yes (yes)', 'Selections: 0 to 1'],
      ['Photos: 1 to 3'],
      ['No additional settings'],
    ]);
  });

  it('presenta los cinco modos de fallo de yes_no_na', () => {
    const modes = ['no', 'yes', 'no_na', 'na', 'yes_na'] as const;
    const items: TemplateItem[] = modes.map((fails_on) => ({
      ...document.sections[0]!.items[0]!,
      response_type: 'yes_no_na',
      fails_on,
    }));

    expect(items.map((item) => responseConfiguration(item))).toEqual([
      ['Fails on: No'],
      ['Fails on: Yes'],
      ['Fails on: No or N/A'],
      ['Fails on: N/A only'],
      ['Fails on: Yes or N/A'],
    ]);
  });

  it('presenta la prescripción completa y el umbral', () => {
    const item = {
      ...document.sections[0]!.items[0]!,
      finding: {
        corrective_action: 'Stop the machine and investigate.',
        fails_when: { operator: 'gt' as const, value: 80 },
      },
    };

    expect(findingConfiguration(item)).toEqual([
      'Corrective action: Stop the machine and investigate.',
      'Fails above 80',
    ]);
    expect(failureThresholdLabel({ operator: 'lte', value: 10 })).toBe('Fails at or below 10');
  });
});
