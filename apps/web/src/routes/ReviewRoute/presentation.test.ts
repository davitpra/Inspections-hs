import { FINDING_DESCRIPTION_MIN } from '@hs/contracts';
import type { TemplateDocument, Violation } from '@hs/forms';
import { describe, expect, it } from 'vitest';

import { IncompleteFindingsError } from '../../offline/drafts';
import { andList, blockers, findingReason, signFailure, violationReason } from './presentation';

/**
 * Dos secciones y tres ítems, con las `position` desordenadas a propósito: el orden que
 * la lista tiene que respetar es el del documento, no el de llegada de las violaciones.
 */
const DOCUMENT: TemplateDocument = {
  sections: [
    {
      section_key: 'housekeeping',
      section_title: 'Housekeeping',
      position: 2,
      items: [
        {
          item_key: 'housekeeping.floors-clear',
          prompt: 'Are walkways clear of obstructions?',
          position: 1,
          required: true,
          response_type: 'yes_no',
          fails_on: 'no',
        },
      ],
    },
    {
      section_key: 'emergency',
      section_title: 'Emergency preparedness',
      position: 1,
      items: [
        {
          item_key: 'emergency.exits-unobstructed',
          prompt: 'Are emergency exits unobstructed?',
          position: 1,
          required: true,
          response_type: 'yes_no',
          fails_on: 'no',
        },
        {
          item_key: 'emergency.extinguisher-photo',
          prompt: 'Photograph the extinguisher tag',
          position: 2,
          required: true,
          response_type: 'photo',
          min_count: 1,
          max_count: 3,
        },
      ],
    },
  ],
};

/**
 * EL CASO QUE ESTE ARCHIVO EXISTE PARA EVITAR. La pantalla mostraba, literalmente:
 *
 *     emergency.exits-unobstructed: missing description, missing location, missing photo
 *
 * Una clave de máquina y tres etiquetas. Lo que el inspector necesita es la pregunta que
 * leyó en el recorrido y una instrucción.
 */
describe('lo que bloquea la firma', () => {
  it('nombra la pregunta y la sección, no la item_key', () => {
    const result = blockers(DOCUMENT, [], [
      { item_key: 'emergency.exits-unobstructed', missing: ['description', 'location', 'photo'] },
    ]);

    expect(result).toEqual([
      {
        item_key: 'emergency.exits-unobstructed',
        label: 'Are emergency exits unobstructed?',
        section: 'Emergency preparedness',
        reasons: [
          'This item failed, so it needs a finding. Add a description, a location and a photo.',
        ],
      },
    ]);
  });

  it('junta en una entrada lo que le falta al mismo ítem por dos motivos', () => {
    const violations: Violation[] = [
      { item_key: 'emergency.exits-unobstructed', code: 'required_missing' },
    ];

    const result = blockers(DOCUMENT, violations, [
      { item_key: 'emergency.exits-unobstructed', missing: ['photo'] },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.reasons).toHaveLength(2);
  });

  it('ordena como el documento y no como llegan las violaciones', () => {
    const violations: Violation[] = [
      { item_key: 'housekeeping.floors-clear', code: 'required_missing' },
      { item_key: 'emergency.extinguisher-photo', code: 'required_missing' },
      { item_key: 'emergency.exits-unobstructed', code: 'required_missing' },
    ];

    expect(blockers(DOCUMENT, violations, []).map((entry) => entry.item_key)).toEqual([
      'emergency.exits-unobstructed',
      'emergency.extinguisher-photo',
      'housekeeping.floors-clear',
    ]);
  });

  /**
   * `unknown_item` habla de una respuesta que el documento no contiene: no hay pregunta
   * que mostrar y la clave es lo único que nombra la fila. Va al final porque no es una
   * parada del recorrido.
   */
  it('cae en la item_key cuando el documento no tiene el ítem, y la manda al final', () => {
    const violations: Violation[] = [
      { item_key: 'ghost.item', code: 'unknown_item' },
      { item_key: 'housekeeping.floors-clear', code: 'required_missing' },
    ];

    const result = blockers(DOCUMENT, violations, []);

    expect(result.map((entry) => entry.item_key)).toEqual([
      'housekeeping.floors-clear',
      'ghost.item',
    ]);
    expect(result[1]?.label).toBe('ghost.item');
    expect(result[1]?.section).toBeNull();
  });
});

describe('el texto de una violación', () => {
  it('pide una acción en vez de nombrar el código', () => {
    expect(violationReason({ item_key: 'x', code: 'required_missing' })).toBe(
      'Answer this question.',
    );
  });

  it('mete los límites del ítem en el texto', () => {
    expect(
      violationReason({
        item_key: 'x',
        code: 'photo_count_out_of_range',
        detail: { min_count: 1, max_count: 3 },
      }),
    ).toBe('Attach between 1 and 3 photos.');

    expect(
      violationReason({ item_key: 'x', code: 'too_long', detail: { max_length: 200 } }),
    ).toBe('Shorten the answer to 200 characters or fewer.');
  });

  it('concuerda el singular con el límite que se lee al lado', () => {
    expect(
      violationReason({
        item_key: 'x',
        code: 'photo_count_out_of_range',
        detail: { min_count: 1, max_count: 1 },
      }),
    ).toBe('Attach 1 photo.');
  });

  /**
   * `detail` es `Record<string, unknown>`: el motor no sabe quién lo lee. Un texto sin
   * el límite adentro es peor que ideal; "between undefined and undefined" es una
   * pantalla rota.
   */
  it('sigue diciendo algo útil cuando el detalle no vino', () => {
    expect(violationReason({ item_key: 'x', code: 'out_of_range' })).toBe(
      'The value entered is out of range.',
    );
  });

  it('no le pide nada al inspector cuando el problema no es suyo', () => {
    expect(violationReason({ item_key: 'x', code: 'wrong_shape' })).toMatch(/Report it/);
  });
});

describe('lo que le falta a un hallazgo', () => {
  /**
   * El caso por el que la distinción existe: "missing description" cuando el inspector
   * ya escribió "ok" lo manda a mirar un campo que para él está lleno.
   */
  it('separa el campo vacío del campo demasiado corto', () => {
    expect(findingReason(['description'])).toMatch(/Add a description\.$/);
    expect(findingReason(['description_too_short'])).toBe(
      `This item failed, so it needs a finding. Add a longer description (at least ${FINDING_DESCRIPTION_MIN} characters).`,
    );
  });

  it('enumera en una sola frase', () => {
    expect(andList(['a description'])).toBe('a description');
    expect(andList(['a description', 'a photo'])).toBe('a description and a photo');
    expect(andList(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

/**
 * Firmar es el punto de no retorno (ADR-001): ante un error, lo primero que hay que
 * poder leer es si ese punto se cruzó.
 */
describe('cuando firmar falla', () => {
  it('dice qué hacer ante un hallazgo que quedó incompleto', () => {
    const error = new IncompleteFindingsError([{ item_key: 'x', missing: ['photo'] }]);

    expect(signFailure(error)).toMatch(/Go back to the walkthrough/);
  });

  it('nunca muestra el mensaje interno del error', () => {
    const error = new IncompleteFindingsError([
      { item_key: 'emergency.exits-unobstructed', missing: ['photo'] },
    ]);

    expect(signFailure(error)).not.toContain('emergency.exits-unobstructed');
    expect(signFailure(new Error('DatabaseClosedError'))).not.toContain('DatabaseClosedError');
  });

  it('ante cualquier otro error confirma que no se envió nada', () => {
    expect(signFailure(new Error('boom'))).toMatch(/Nothing was saved and nothing was sent/);
  });
});
