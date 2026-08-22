import type {
  Location,
  OrganizationLocationOption,
  Site,
  TemplateDraftDocument,
} from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  CONTROL_LEVEL_OPTIONS,
  defaultFinding,
  FAILURE_OPERATOR_LABELS,
  findingButtonLabel,
  hasUnsavedChanges,
  locationCoverage,
  offerableLocations,
  saveButtonLabel,
  saveStateLabel,
  saveErrorNotice,
  scopeOptions,
  scopeLabel,
  sectionAppliesTo,
  strandedSections,
  summaryCounts,
  totalItems,
  type DraftEdits,
} from './presentation';

function document(): TemplateDraftDocument {
  return {
    sections: [
      {
        section_key: 'a',
        section_title: 'A',
        items: [
          { item_key: 'one', prompt: 'One', required: true, response_type: 'yes_no' },
          { item_key: 'two', prompt: 'Two', required: true, response_type: 'yes_no' },
        ],
      },
      { section_key: 'b', section_title: 'B', items: [] },
    ],
  };
}

describe('totalItems', () => {
  it('cuenta las preguntas de todas las secciones', () => {
    expect(totalItems(document())).toBe(2);
  });

  it('un documento vacío no tiene ninguna', () => {
    expect(totalItems({ sections: [] })).toBe(0);
  });
});

describe('prescripciones', () => {
  it('ofrece los cinco niveles en el orden de la jerarquía', () => {
    expect(CONTROL_LEVEL_OPTIONS).toEqual([
      { value: 'elimination', label: 'Elimination' },
      { value: 'substitution', label: 'Substitution' },
      { value: 'engineering', label: 'Engineering' },
      { value: 'administrative', label: 'Administrative' },
      { value: 'ppe', label: 'PPE' },
    ]);
  });

  it('nombra los operadores en inglés', () => {
    expect(FAILURE_OPERATOR_LABELS).toEqual({
      lt: 'Less than',
      lte: 'Less than or equal to',
      gt: 'Greater than',
      gte: 'Greater than or equal to',
    });
  });

  it('agrega umbral solo a los tipos medidos', () => {
    expect(defaultFinding('yes_no')).not.toHaveProperty('fails_when');
    expect(defaultFinding('number')).toHaveProperty('fails_when');
    expect(findingButtonLabel(false)).toBe('Add finding');
    expect(findingButtonLabel(true)).toBe('Edit finding');
  });
});

describe('hasUnsavedChanges', () => {
  function edits(overrides: Partial<DraftEdits> = {}): DraftEdits {
    return { document: document(), name: 'Name', siteIds: ['st-thomas'], ...overrides };
  }

  it('no hay cambios cuando el documento, el nombre y el alcance son los mismos', () => {
    expect(hasUnsavedChanges(edits(), edits())).toBe(false);
  });

  it('detecta un cambio en el documento', () => {
    const edited = document();
    edited.sections[0]!.section_title = 'Changed';

    expect(hasUnsavedChanges(edits({ document: edited }), edits())).toBe(true);
  });

  it('detecta un cambio solo en el nombre', () => {
    expect(hasUnsavedChanges(edits({ name: 'Renamed' }), edits())).toBe(true);
  });

  it('detecta un cambio solo en el alcance', () => {
    expect(hasUnsavedChanges(edits({ siteIds: ['st-thomas', 'glencoe'] }), edits())).toBe(
      true,
    );
  });

  /** El alcance es un conjunto: el mismo par de plantas en otro orden no es un cambio. */
  it('el orden del alcance no cuenta como cambio', () => {
    const edited = edits({ siteIds: ['glencoe', 'st-thomas'] });
    const saved = edits({ siteIds: ['st-thomas', 'glencoe'] });

    expect(hasUnsavedChanges(edited, saved)).toBe(false);
  });

  /**
   * La razón de comparar en vez de llevar un flag: deshacer a mano lo que se acababa de
   * escribir tiene que volver a "guardado", y un `dirty` booleano se quedaría en `true`.
   */
  it('deshacer a mano vuelve a "sin cambios"', () => {
    const edited = document();
    edited.sections[0]!.section_title = 'Changed';
    edited.sections[0]!.section_title = 'A';

    expect(hasUnsavedChanges(edits({ document: edited }), edits())).toBe(false);
  });
});

describe('saveButtonLabel', () => {
  it('dice en qué está', () => {
    expect(saveButtonLabel(true, true)).toBe('Saving…');
    expect(saveButtonLabel(false, true)).toBe('Save draft');
    expect(saveButtonLabel(false, false)).toBe('Saved');
  });
});

describe('saveStateLabel', () => {
  it('dice Saved o Unsaved changes sin numerar el estado', () => {
    expect(saveStateLabel(false)).toBe('Saved');
    expect(saveStateLabel(true)).toBe('Unsaved changes');
  });
});

describe('saveErrorNotice', () => {
  it('conserva el mensaje del servidor y agrega que nada se perdió', () => {
    const notice = saveErrorNotice('This draft was changed somewhere else.');

    expect(notice).toContain('This draft was changed somewhere else.');
    expect(notice).toContain('has been lost');
  });
});

// ---------------------------------------------------------------------------
// El alcance y la cobertura del catálogo.

const ST_THOMAS = 'site-st-thomas';
const GLENCOE = 'site-glencoe';

const SITES: Site[] = [
  { id: ST_THOMAS, code: 'st-thomas', name: 'St. Thomas', deactivated_at: null },
  { id: GLENCOE, code: 'glencoe', name: 'Glencoe', deactivated_at: null },
];

const SHARED: OrganizationLocationOption[] = [
  { id: 'ol-dock', code: 'dock', name: 'Loading dock' },
  { id: 'ol-boiler', code: 'boiler', name: 'Boiler room' },
  { id: 'ol-yard', code: 'yard', name: 'Yard' },
];

function physical(overrides: Partial<Location> & Pick<Location, 'id' | 'site_id'>): Location {
  return {
    code: 'code',
    name: 'Name',
    deactivated_at: null,
    organization_location_code: null,
    ...overrides,
  };
}

/** `dock` está en las dos plantas, `boiler` solo en St. Thomas, `yard` en ninguna. */
const LOCATIONS: Location[] = [
  physical({
    id: 'l-1',
    site_id: ST_THOMAS,
    name: 'Shipping dock',
    organization_location_code: 'dock',
  }),
  physical({
    id: 'l-2',
    site_id: GLENCOE,
    name: 'Receiving dock',
    organization_location_code: 'dock',
  }),
  physical({
    id: 'l-3',
    site_id: ST_THOMAS,
    name: 'Boiler room',
    organization_location_code: 'boiler',
  }),
];

describe('locationCoverage', () => {
  it('resuelve el lugar físico de cada planta del alcance', () => {
    const coverage = locationCoverage('dock', LOCATIONS, [ST_THOMAS, GLENCOE]);

    expect(coverage.get(ST_THOMAS)?.name).toBe('Shipping dock');
    expect(coverage.get(GLENCOE)?.name).toBe('Receiving dock');
  });

  it('deja el hueco visible donde no hay mapeo, en vez de omitir la planta', () => {
    const coverage = locationCoverage('boiler', LOCATIONS, [ST_THOMAS, GLENCOE]);

    expect(coverage.has(GLENCOE)).toBe(true);
    expect(coverage.get(GLENCOE)).toBeUndefined();
  });

  it('una física desactivada no resuelve', () => {
    const retired = [
      physical({
        id: 'l-4',
        site_id: GLENCOE,
        organization_location_code: 'boiler',
        deactivated_at: '2026-01-01T00:00:00.000Z',
      }),
      ...LOCATIONS,
    ];

    expect(locationCoverage('boiler', retired, [GLENCOE]).get(GLENCOE)).toBeUndefined();
  });

  it('sin ubicación elegida no hay nada que resolver', () => {
    const coverage = locationCoverage(undefined, LOCATIONS, [ST_THOMAS, GLENCOE]);

    expect([...coverage.values()]).toEqual([undefined, undefined]);
  });
});

describe('offerableLocations', () => {
  it('ofrece solo las mapeadas en las dos plantas cuando el alcance son las dos', () => {
    const offered = offerableLocations(SHARED, LOCATIONS, [ST_THOMAS, GLENCOE]);

    expect(offered.map((each) => each.code)).toEqual(['dock']);
  });

  it('la misma ubicación aparece cuando el alcance se achica a su planta', () => {
    const offered = offerableLocations(SHARED, LOCATIONS, [ST_THOMAS]);

    expect(offered.map((each) => each.code)).toEqual(['dock', 'boiler']);
  });

  it('conserva la que la sección ya tiene aunque el recorte la dejaría afuera', () => {
    const offered = offerableLocations(SHARED, LOCATIONS, [ST_THOMAS, GLENCOE], 'boiler');

    expect(offered.map((each) => each.code)).toEqual(['dock', 'boiler']);
  });
});

describe('strandedSections', () => {
  const withLocations: TemplateDraftDocument = {
    sections: [
      { section_key: 'a', section_title: 'A', organization_location_code: 'dock', items: [] },
      { section_key: 'b', section_title: 'B', organization_location_code: 'boiler', items: [] },
      { section_key: 'c', section_title: 'C', items: [] },
    ],
  };

  it('nombra la sección que el alcance deja sin resolver', () => {
    expect(strandedSections(withLocations, LOCATIONS, [ST_THOMAS, GLENCOE])).toEqual([1]);
  });

  it('ninguna queda huérfana cuando el alcance es la planta que las tiene', () => {
    expect(strandedSections(withLocations, LOCATIONS, [ST_THOMAS])).toEqual([]);
  });

  it('una sección sin ubicación no cuenta: eso ya lo dice draftIssues', () => {
    expect(strandedSections(withLocations, LOCATIONS, [ST_THOMAS, GLENCOE])).not.toContain(2);
  });
});

describe('scopeLabel', () => {
  it('las dos plantas se leen como una sola cosa', () => {
    expect(scopeLabel([ST_THOMAS, GLENCOE], SITES)).toBe('Both plants');
  });

  it('una sola planta lleva "only", porque hay otra donde no vale', () => {
    expect(scopeLabel([GLENCOE], SITES)).toBe('Glencoe only');
  });

  it('con una sola planta configurada no dice "only": no hay otra', () => {
    expect(scopeLabel([ST_THOMAS], [SITES[0]!])).toBe('St. Thomas');
  });

  it('un alcance vacío se dice, no se esconde', () => {
    expect(scopeLabel([], SITES)).toBe('No plants');
  });
});

describe('scopeOptions', () => {
  it('ofrece solo la planta activa y la nombra sin "only"', () => {
    const options = scopeOptions([
      SITES[0]!,
      { ...SITES[1]!, deactivated_at: '2026-08-21T00:00:00.000Z' },
    ]);

    expect(options).toEqual([{ label: 'St. Thomas', siteIds: [ST_THOMAS] }]);
  });
});

describe('sectionAppliesTo', () => {
  it('deriva las dos plantas de una ubicación mapeada en las dos', () => {
    const section = {
      section_key: 'a',
      section_title: 'A',
      organization_location_code: 'dock',
      items: [],
    };

    expect(sectionAppliesTo(section, LOCATIONS, [ST_THOMAS, GLENCOE], SITES)).toBe('Both plants');
  });

  it('deriva una sola planta de una ubicación mapeada en una sola', () => {
    const section = {
      section_key: 'b',
      section_title: 'B',
      organization_location_code: 'boiler',
      items: [],
    };

    expect(sectionAppliesTo(section, LOCATIONS, [ST_THOMAS, GLENCOE], SITES)).toBe(
      'St. Thomas only',
    );
  });

  it('lo dice cuando ninguna planta tiene esa ubicación', () => {
    const section = {
      section_key: 'c',
      section_title: 'C',
      organization_location_code: 'yard',
      items: [],
    };

    expect(sectionAppliesTo(section, LOCATIONS, [ST_THOMAS, GLENCOE], SITES)).toBe(
      'No plant has this location',
    );
  });

  it('una sección sin ubicación lo dice sin inventar un alcance', () => {
    const section = { section_key: 'd', section_title: '', items: [] };

    expect(sectionAppliesTo(section, LOCATIONS, [ST_THOMAS, GLENCOE], SITES)).toBe(
      'No location yet',
    );
  });
});

describe('summaryCounts', () => {
  it('cuenta secciones, preguntas y ubicaciones que resuelven en todo el alcance', () => {
    const doc: TemplateDraftDocument = {
      sections: [
        {
          section_key: 'a',
          section_title: 'A',
          organization_location_code: 'dock',
          items: [{ item_key: 'one', prompt: 'One', required: true, response_type: 'yes_no' }],
        },
        { section_key: 'b', section_title: 'B', organization_location_code: 'boiler', items: [] },
      ],
    };

    expect(summaryCounts(doc, LOCATIONS, [ST_THOMAS, GLENCOE])).toEqual({
      sections: 2,
      questions: 1,
      locationsLinked: 1,
    });
  });

  it('no cuenta dos veces la misma ubicación usada por dos secciones', () => {
    const doc: TemplateDraftDocument = {
      sections: [
        { section_key: 'a', section_title: 'A', organization_location_code: 'dock', items: [] },
        { section_key: 'b', section_title: 'B', organization_location_code: 'dock', items: [] },
      ],
    };

    expect(summaryCounts(doc, LOCATIONS, [ST_THOMAS, GLENCOE]).locationsLinked).toBe(1);
  });
});
