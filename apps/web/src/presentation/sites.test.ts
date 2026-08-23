import type { Site } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import { activeSites, resolveSiteId } from './sites';

const GLENCOE = '11111111-1111-4111-8111-111111111111';
const ST_THOMAS = '22222222-2222-4222-8222-222222222222';

function site(id: string, name: string, deactivated_at: string | null = null): Site {
  return { id, code: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, deactivated_at };
}

const glencoe = site(GLENCOE, 'Glencoe');
const stThomas = site(ST_THOMAS, 'St. Thomas');
const scope = [ST_THOMAS, GLENCOE];

describe('las plantas que se pueden elegir', () => {
  it('deja afuera las dadas de baja', () => {
    const closed = site(ST_THOMAS, 'St. Thomas', '2026-08-21T12:00:00.000Z');

    expect(activeSites([glencoe, closed]).map((each) => each.id)).toEqual([GLENCOE]);
  });

  it('van en orden alfabético, no en el que vino la respuesta', () => {
    expect(activeSites([stThomas, glencoe]).map((each) => each.name)).toEqual([
      'Glencoe',
      'St. Thomas',
    ]);
  });
});

describe('la planta que mira la consola', () => {
  it('respeta la elegida mientras siga activa', () => {
    expect(resolveSiteId([glencoe, stThomas], scope, ST_THOMAS)).toBe(ST_THOMAS);
  });

  it('sin elección abre en la primera del alcance, no en la primera alfabética', () => {
    // El selector ordena alfabéticamente —Glencoe antes que St. Thomas—, pero la planta por
    // defecto es la de la cuenta: ordenar acá movería la consola sin que nadie la toque.
    expect(resolveSiteId([glencoe, stThomas], scope, null)).toBe(ST_THOMAS);
  });

  it('salta la primera del alcance cuando está dada de baja', () => {
    // El alcance empieza por St. Thomas y St. Thomas está cerrada: sin este filtro la
    // consola abría justo en el calendario vacío.
    const closed = site(ST_THOMAS, 'St. Thomas', '2026-08-21T12:00:00.000Z');

    expect(resolveSiteId([closed, glencoe], scope, null)).toBe(GLENCOE);
  });

  it('si dan de baja la elegida, cae a una activa', () => {
    const closed = site(ST_THOMAS, 'St. Thomas', '2026-08-21T12:00:00.000Z');

    expect(resolveSiteId([closed, glencoe], scope, ST_THOMAS)).toBe(GLENCOE);
  });

  it('ignora una planta activa que no está en el alcance de la cuenta', () => {
    expect(resolveSiteId([glencoe, stThomas], [ST_THOMAS], null)).toBe(ST_THOMAS);
  });

  it('sin ninguna activa no devuelve una cerrada: devuelve vacío', () => {
    const closed = site(ST_THOMAS, 'St. Thomas', '2026-08-21T12:00:00.000Z');

    expect(resolveSiteId([closed], scope, ST_THOMAS)).toBe('');
  });
});
