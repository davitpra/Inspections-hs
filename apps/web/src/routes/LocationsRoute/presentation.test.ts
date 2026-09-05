import type { Location, OrganizationLocation, Site } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  assignedLocation,
  canCreate,
  reusableLocation,
  sortShared,
  suggestCode,
  togglePlant,
  unmappedLocations,
  visibleLocations,
  visibleSites,
} from './presentation';

const ST_THOMAS = '11111111-1111-4111-8111-111111111111';
const GLENCOE = '22222222-2222-4222-8222-222222222222';

let counter = 0;

function shared(code: string, name = code): OrganizationLocation {
  counter += 1;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(counter).padStart(12, '0')}`,
    code,
    name,
    deactivated_at: null,
  };
}

function location(overrides: Partial<Location> = {}): Location {
  counter += 1;
  return {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(counter).padStart(12, '0')}`,
    site_id: ST_THOMAS,
    code: 'dock',
    name: 'Dock',
    deactivated_at: null,
    organization_location_code: null,
    ...overrides,
  };
}

describe('assignedLocation', () => {
  it('encuentra la física de ESTA planta que representa a la compartida', () => {
    const dock = shared('loading-dock', 'Loading dock');
    const here = location({ name: 'Dock east', organization_location_code: 'loading-dock' });
    const there = location({
      site_id: GLENCOE,
      name: 'Dock west',
      organization_location_code: 'loading-dock',
    });

    expect(assignedLocation(dock, [there, here], ST_THOMAS)?.id).toBe(here.id);
  });

  it('no encuentra nada cuando la compartida no tiene lugar en esta planta', () => {
    const dock = shared('loading-dock');
    const other = location({ organization_location_code: 'cold-storage' });

    expect(assignedLocation(dock, [other], ST_THOMAS)).toBeUndefined();
  });
});

describe('reusableLocation', () => {
  /**
   * Destildar suelta el mapeo pero no borra la fila (ADR-002). Sin esto, volver a tildar
   * crearía una segunda física con el mismo código y el único `(site_id, code)` la rechaza.
   */
  it('recupera la física huérfana que lleva el código de la compartida', () => {
    const dock = shared('loading-dock');
    const dropped = location({ code: 'loading-dock', name: 'Loading dock' });

    expect(reusableLocation(dock, [dropped], ST_THOMAS)?.id).toBe(dropped.id);
  });

  it('no toca una que ya representa a otra compartida', () => {
    const dock = shared('loading-dock');
    const taken = location({ code: 'loading-dock', organization_location_code: 'cold-storage' });

    expect(reusableLocation(dock, [taken], ST_THOMAS)).toBeUndefined();
  });

  it('no cruza de planta', () => {
    const dock = shared('loading-dock');
    const elsewhere = location({ site_id: GLENCOE, code: 'loading-dock' });

    expect(reusableLocation(dock, [elsewhere], ST_THOMAS)).toBeUndefined();
  });

  /** «Dock east» representa al muelle pero no se llama como él: crear es lo correcto. */
  it('ignora una huérfana con otro código', () => {
    const dock = shared('loading-dock');
    const other = location({ code: 'dock-east' });

    expect(reusableLocation(dock, [other], ST_THOMAS)).toBeUndefined();
  });
});

describe('togglePlant', () => {
  it('prende y apaga sueltas', () => {
    expect(togglePlant([], GLENCOE)).toEqual([GLENCOE]);
    expect(togglePlant([GLENCOE], ST_THOMAS)).toEqual([GLENCOE, ST_THOMAS]);
    expect(togglePlant([GLENCOE, ST_THOMAS], GLENCOE)).toEqual([ST_THOMAS]);
  });

  /** Apagar la última no deja la grilla sin columnas: la lista vacía es «todas». */
  it('apagar la última vuelve a la lista vacía', () => {
    expect(togglePlant([GLENCOE], GLENCOE)).toEqual([]);
  });
});

describe('visibleSites', () => {
  const sites: Site[] = [
    { id: GLENCOE, code: 'glencoe', name: 'Glencoe', deactivated_at: null },
    { id: ST_THOMAS, code: 'st-thomas', name: 'St. Thomas', deactivated_at: null },
  ];

  it('sin ninguna seleccionada las dibuja todas', () => {
    expect(visibleSites(sites, []).map((site) => site.name)).toEqual(['Glencoe', 'St. Thomas']);
  });

  it('deja solo las seleccionadas', () => {
    expect(visibleSites(sites, [GLENCOE]).map((site) => site.name)).toEqual(['Glencoe']);
  });

  /** Prender en otro orden no reordena la grilla. */
  it('conserva el orden de las plantas, no el de la selección', () => {
    expect(visibleSites(sites, [ST_THOMAS, GLENCOE]).map((site) => site.name)).toEqual([
      'Glencoe',
      'St. Thomas',
    ]);
  });
});

describe('visibleLocations', () => {
  const view = (over: Partial<Parameters<typeof visibleLocations>[1]> = {}) => ({
    query: '',
    direction: 'asc' as const,
    ...over,
  });

  it('busca por nombre y por código, sin distinguir mayúsculas', () => {
    const dock = shared('loading-dock', 'Loading dock');
    const cold = shared('cold-storage', 'Cold storage');
    const rows = [dock, cold];

    expect(visibleLocations(rows, view({ query: 'LOAD' })).map((s) => s.name)).toEqual([
      'Loading dock',
    ]);
    expect(visibleLocations(rows, view({ query: 'cold-st' })).map((s) => s.name)).toEqual([
      'Cold storage',
    ]);
  });

  it('devuelve el resultado ordenado por nombre', () => {
    const rows = [shared('z', 'Zulu'), shared('a', 'Alpha')];

    expect(visibleLocations(rows, view()).map((s) => s.name)).toEqual(['Alpha', 'Zulu']);
  });

  /** El orden se aplica sobre lo que quedó, no sobre el catálogo entero. */
  it('ordena al revés lo que pasó la búsqueda', () => {
    const rows = [shared('g', 'Grading area'), shared('z', 'Zulu'), shared('a', 'Alpha')];

    expect(
      visibleLocations(rows, view({ direction: 'desc', query: 'l' })).map((s) => s.name),
    ).toEqual(['Zulu', 'Alpha']);
  });
});

describe('unmappedLocations', () => {
  it('devuelve las físicas de esta planta que ninguna compartida usa', () => {
    const orphan = location({ name: 'Orphan' });
    const used = location({ name: 'Used', organization_location_code: 'a' });
    const elsewhere = location({ site_id: GLENCOE, name: 'Elsewhere' });

    expect(unmappedLocations([orphan, used, elsewhere], ST_THOMAS).map((l) => l.name)).toEqual([
      'Orphan',
    ]);
  });
});

describe('sortShared', () => {
  it('ordena por nombre sin mutar la entrada', () => {
    const input = [shared('z', 'Zulu'), shared('a', 'Alpha')];
    const sorted = sortShared(input);

    expect(sorted.map((s) => s.name)).toEqual(['Alpha', 'Zulu']);
    expect(input.map((s) => s.name)).toEqual(['Zulu', 'Alpha']);
  });

  it('invierte con "desc", y tampoco muta', () => {
    const input = [shared('a', 'Alpha'), shared('z', 'Zulu')];

    expect(sortShared(input, 'desc').map((s) => s.name)).toEqual(['Zulu', 'Alpha']);
    expect(input.map((s) => s.name)).toEqual(['Alpha', 'Zulu']);
  });

  /** Los nombres los escribe una persona: el orden de puntos de código deja «Área» al final. */
  it('ordena con acentos donde una persona los buscaría', () => {
    const input = [shared('zona', 'Zona de carga'), shared('area', 'Área de bombas')];

    expect(sortShared(input).map((s) => s.name)).toEqual(['Área de bombas', 'Zona de carga']);
  });
});

describe('suggestCode', () => {
  it('propone un code que el catálogo acepta', () => {
    expect(suggestCode('Loading dock — east')).toBe('loading-dock-east');
  });

  it('saca acentos', () => {
    expect(suggestCode('Depósito')).toBe('deposito');
  });

  it('devuelve vacío cuando no queda nada utilizable', () => {
    expect(suggestCode('   ')).toBe('');
    expect(suggestCode('???')).toBe('');
  });
});

describe('canCreate', () => {
  it('exige nombre y un code válido', () => {
    expect(canCreate('Loading dock', 'loading-dock')).toBe(true);
    expect(canCreate('   ', 'loading-dock')).toBe(false);
    expect(canCreate('Loading dock', '')).toBe(false);
    expect(canCreate('Loading dock', 'Loading Dock')).toBe(false);
  });
});
