import type { TemplateItem } from '@hs/forms';
import { describe, expect, it } from 'vitest';

import { answerText, photoCountText } from './presentation';

function item(overrides: Record<string, unknown>): TemplateItem {
  return {
    item_key: 'general.question',
    prompt: 'A question',
    position: 1,
    required: true,
    ...overrides,
  } as TemplateItem;
}

describe('answerText', () => {
  /**
   * El caso que importa: un ítem escondido por su condición nunca se contestó, y decir
   * "No" ahí sería afirmar que el inspector lo dejó pasar.
   */
  it('sin respuesta lo dice, y no la inventa', () => {
    expect(answerText(item({ response_type: 'yes_no' }), undefined)).toBe('Not answered');
    expect(answerText(item({ response_type: 'text' }), undefined)).toBe('Not answered');
  });

  it('yes_no se lee en palabras', () => {
    expect(answerText(item({ response_type: 'yes_no' }), true)).toBe('Yes');
    expect(answerText(item({ response_type: 'yes_no' }), false)).toBe('No');
  });

  /** "No aplica" no es "no": colapsarlos borraría por qué no hay hallazgo. */
  it('yes_no_na distingue el no del no aplica', () => {
    expect(answerText(item({ response_type: 'yes_no_na' }), 'yes')).toBe('Yes');
    expect(answerText(item({ response_type: 'yes_no_na' }), 'no')).toBe('No');
    expect(answerText(item({ response_type: 'yes_no_na' }), 'na')).toBe('Not applicable');
  });

  it('una opción se lee por su etiqueta, no por su clave', () => {
    const choice = item({
      response_type: 'single_choice',
      options: [
        { value: 'lvl-1', label: 'Elimination' },
        { value: 'lvl-2', label: 'Engineering control' },
      ],
    });

    expect(answerText(choice, 'lvl-2')).toBe('Engineering control');
  });

  it('varias opciones se leen por sus etiquetas, en el orden en que se guardaron', () => {
    const choice = item({
      response_type: 'multi_choice',
      options: [
        { value: 'loose', label: 'Loose fitting' },
        { value: 'bent', label: 'Bent frame' },
      ],
      min_selected: 0,
      max_selected: 2,
    });

    expect(answerText(choice, ['bent', 'loose'])).toBe('Bent frame, Loose fitting');
  });

  /** Una opción que ya no está en el documento congelado: la clave cruda antes que un hueco. */
  it('cae al valor crudo si la opción no está en el documento', () => {
    const choice = item({
      response_type: 'single_choice',
      options: [{ value: 'lvl-1', label: 'Elimination' }],
    });

    expect(answerText(choice, 'lvl-9')).toBe('lvl-9');
  });

  /**
   * Las fotos no se pueden ver todavía, así que el conteo ES la evidencia de que existen.
   * Sin él, un registro con tres fotos se lee igual que uno sin ninguna.
   */
  it('una respuesta de foto dice cuántas hay, y nunca una imagen', () => {
    const photo = item({ response_type: 'photo', min_count: 1, max_count: 3 });

    expect(answerText(photo, ['a/b/one.jpg'])).toBe('1 photo');
    expect(answerText(photo, ['a/b/one.jpg', 'a/b/two.jpg'])).toBe('2 photos');
  });

  it('la firma se reporta como firmada, sin su imagen', () => {
    const signature = item({ response_type: 'signature' });

    expect(
      answerText(signature, { object_key: 'a/b/sig.png', signed_at: '2027-07-29T18:00:00.000Z' }),
    ).toBe('Signed');
  });

  it('escala, número y texto se leen tal cual', () => {
    expect(answerText(item({ response_type: 'scale', min: 1, max: 5 }), 4)).toBe('4');
    expect(answerText(item({ response_type: 'number', min: 0, max: 9, decimals: 0 }), 7)).toBe('7');
    expect(answerText(item({ response_type: 'text', max_length: 200 }), 'Refitted')).toBe(
      'Refitted',
    );
  });
});

describe('photoCountText', () => {
  it('nombra la ausencia en vez de callarla', () => {
    expect(photoCountText(0)).toBe('No photos');
    expect(photoCountText(1)).toBe('1 photo');
    expect(photoCountText(3)).toBe('3 photos');
  });
});
