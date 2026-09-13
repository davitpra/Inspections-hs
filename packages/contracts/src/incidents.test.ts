import { describe, expect, it } from 'vitest';

import {
  BODY_PARTS,
  CURRENT_INCIDENT_FORM_VERSION,
  INCIDENT_CLASSIFICATIONS,
  INCIDENT_FIELDS,
  INCIDENT_FORM_VERSIONS,
  INCIDENT_STATES,
  INCIDENT_TRANSITIONS,
  INVESTIGATION_REQUIRED_CLASSIFICATIONS,
  ON_SITE_TREATMENTS,
  type IncidentClassification,
  type IncidentState,
  fieldsOfVersion,
  incidentClassificationSchema,
  incidentTransitionFor,
  incidentTransitionsAvailable,
  incidentTransitionsFrom,
  form7MappingOf,
  incidentTransitionRequestSchema,
  reportIncidentRequestSchema,
  requiresInvestigation,
} from './index.js';

/**
 * La tabla de casos de la máquina de estados del incidente.
 *
 * Los 9 pares ordenados de los tres estados más los 3 que salen de `null`, cada
 * uno afirmado a mano. No se genera de `INCIDENT_TRANSITIONS` a propósito: una
 * tabla derivada de la implementación no prueba nada, solo se copia el error.
 */
const ACCEPTED: ReadonlyArray<[IncidentState | null, IncidentState]> = [
  [null, 'reported'],
  ['reported', 'under_investigation'],
  ['reported', 'closed'],
  ['under_investigation', 'closed'],
  ['closed', 'under_investigation'],
];

function isAccepted(from: IncidentState | null, to: IncidentState): boolean {
  return ACCEPTED.some(([f, t]) => f === from && t === to);
}

describe('la máquina de estados del incidente', () => {
  const froms: ReadonlyArray<IncidentState | null> = [null, ...INCIDENT_STATES];

  for (const from of froms) {
    for (const to of INCIDENT_STATES) {
      const label = `${from ?? '(reporte)'} → ${to}`;

      it(`${isAccepted(from, to) ? 'acepta' : 'rechaza'} ${label}`, () => {
        expect(incidentTransitionFor(from, to) !== undefined).toBe(isAccepted(from, to));
      });
    }
  }

  it('cubre los 9 pares ordenados de los tres estados más los 3 de la creación', () => {
    expect(froms.length * INCIDENT_STATES.length).toBe(12);
    expect(INCIDENT_TRANSITIONS).toHaveLength(ACCEPTED.length);
  });

  it('`closed` NO es terminal: la reapertura de §4 sale de ahí', () => {
    expect(incidentTransitionsFrom('closed')).toHaveLength(1);
    expect(incidentTransitionsFrom('closed')[0]?.to).toBe('under_investigation');
  });

  it('la reapertura exige un motivo', () => {
    expect(incidentTransitionFor('closed', 'under_investigation')?.requires).toContain('reason');
  });

  it('abrir la investigación exige declarar el método', () => {
    expect(incidentTransitionFor('reported', 'under_investigation')?.requires).toContain('method');
  });

  it('solo el coordinador investiga, cierra y reabre', () => {
    for (const transition of INCIDENT_TRANSITIONS) {
      if (transition.from === null) continue;

      expect(transition.roles).toEqual(['coordinator']);
    }
  });

  it('el reporte lo hacen gerencia y coordinador, nunca el JHSC', () => {
    const report = incidentTransitionFor(null, 'reported');

    expect(report?.roles).toEqual(['management', 'coordinator']);
    expect(report?.roles).not.toContain('inspector');
  });

  it('los dos caminos al cierre exigen que no queden acciones abiertas', () => {
    for (const to of ['closed'] as const) {
      const transitions = INCIDENT_TRANSITIONS.filter((transition) => transition.to === to);

      expect(transitions).toHaveLength(2);
      for (const transition of transitions) {
        expect(transition.requires).toContain('no_open_actions');
      }
    }
  });

  it('el cierre desde `under_investigation` exige causa raíz', () => {
    expect(incidentTransitionFor('under_investigation', 'closed')?.requires).toContain(
      'root_cause',
    );
  });
});

describe('la investigación obligatoria', () => {
  const CASES: ReadonlyArray<[IncidentClassification, boolean]> = [
    ['first_aid', false],
    ['health_care', false],
    ['lost_time_or_modified_work', true],
    ['critical_injury', true],
    ['occupational_illness', true],
  ];

  for (const [classification, required] of CASES) {
    it(`${classification} ${required ? 'obliga' : 'no obliga'} a investigar`, () => {
      expect(requiresInvestigation(classification)).toBe(required);
    });

    it(`${classification} ${required ? 'no ofrece' : 'ofrece'} el cierre directo desde el reporte`, () => {
      const available = incidentTransitionsAvailable('reported', classification);

      expect(available.some((transition) => transition.to === 'closed')).toBe(!required);
      expect(available.some((transition) => transition.to === 'under_investigation')).toBe(true);
    });
  }

  it('cubre las cinco clasificaciones', () => {
    expect(CASES.map(([classification]) => classification)).toEqual([...INCIDENT_CLASSIFICATIONS]);
  });

  it('las tres obligadas son exactamente las de §4', () => {
    expect([...INVESTIGATION_REQUIRED_CLASSIFICATIONS].sort()).toEqual(
      ['critical_injury', 'lost_time_or_modified_work', 'occupational_illness'].sort(),
    );
  });
});

describe('las clasificaciones', () => {
  it('son cinco', () => {
    expect(INCIDENT_CLASSIFICATIONS).toHaveLength(5);
  });

  it('no incluyen `near_miss`, y esa ausencia es el requisito', () => {
    expect(INCIDENT_CLASSIFICATIONS).not.toContain('near_miss');
    expect(incidentClassificationSchema.safeParse('near_miss').success).toBe(false);
  });

  it('rechazan cualquier valor fuera de la lista', () => {
    expect(incidentClassificationSchema.safeParse('fatality').success).toBe(false);
    expect(incidentClassificationSchema.safeParse('').success).toBe(false);
  });
});

describe('las selecciones cerradas del cuerpo del formulario', () => {
  it('la parte del cuerpo es una categoría gruesa, no un diagnóstico', () => {
    for (const forbidden of ['fracture', 'laceration', 'burn', 'concussion', 'sprain']) {
      expect(BODY_PARTS).not.toContain(forbidden);
    }
  });

  it('el tratamiento en sitio describe lo que pasó en la planta, no lo que concluyó un clínico', () => {
    for (const forbidden of ['diagnosis', 'prognosis', 'work_restriction', 'medical_report']) {
      expect(ON_SITE_TREATMENTS).not.toContain(forbidden);
    }
  });
});

describe('el versionado del formulario', () => {
  it('la versión corriente tiene los nueve campos guiados de §4', () => {
    expect(fieldsOfVersion(CURRENT_INCIDENT_FORM_VERSION)).toEqual([...INCIDENT_FIELDS]);
    expect(INCIDENT_FIELDS).toHaveLength(9);
  });

  it('una versión desconocida devuelve una lista vacía y no los campos de hoy', () => {
    expect(fieldsOfVersion(99)).toEqual([]);
  });

  it('toda versión registrada usa nombres de campo que existen', () => {
    for (const fields of Object.values(INCIDENT_FORM_VERSIONS)) {
      for (const field of fields) {
        expect(INCIDENT_FIELDS).toContain(field);
      }
    }
  });

  it('no hay un campo de narrativa única: los nueve son campos cortos e independientes', () => {
    expect(INCIDENT_FIELDS).not.toContain('description');
    expect(INCIDENT_FIELDS).not.toContain('narrative');
  });
});

describe('el request de reporte', () => {
  const VALID = {
    subject_person_id: '11111111-1111-4111-8111-111111111111',
    classification: 'health_care',
    occurred_at: '2026-03-02T08:00:00-05:00',
    location_id: '22222222-2222-4222-8222-222222222222',
    task_performed: 'Moving pallets with the forklift',
    equipment_involved: 'Forklift #4',
    what_happened: 'The load shifted and struck the worker on the hand',
    body_part: 'hand_or_finger',
    on_site_treatment: 'first_aid_on_site',
    immediate_action: 'Area cordoned off and the forklift tagged out',
    narrative_language: 'en',
    witness_person_ids: [],
  };

  it('acepta los nueve campos guiados', () => {
    expect(reportIncidentRequestSchema.parse(VALID).classification).toBe('health_care');
  });

  it('acepta un incidente sin testigos', () => {
    expect(reportIncidentRequestSchema.parse({ ...VALID, witness_person_ids: [] })).toBeTruthy();
  });

  it('rechaza `reported_by`: el reportante sale de la sesión', () => {
    const withReporter = { ...VALID, reported_by: '33333333-3333-4333-8333-333333333333' };

    expect(reportIncidentRequestSchema.safeParse(withReporter).success).toBe(false);
  });

  it('rechaza `reported_at` y `form_version`: los pone el servidor', () => {
    expect(
      reportIncidentRequestSchema.safeParse({ ...VALID, reported_at: '2026-03-02T09:00:00-05:00' })
        .success,
    ).toBe(false);
    expect(reportIncidentRequestSchema.safeParse({ ...VALID, form_version: 1 }).success).toBe(
      false,
    );
  });

  it('rechaza cualquier campo de detalle clínico', () => {
    for (const clinical of ['diagnosis', 'medical_report', 'work_restriction', 'injury_nature']) {
      expect(reportIncidentRequestSchema.safeParse({ ...VALID, [clinical]: 'x' }).success).toBe(
        false,
      );
    }
  });

  it('rechaza fotos y adjuntos: la foto de una persona accidentada es detalle clínico', () => {
    expect(
      reportIncidentRequestSchema.safeParse({ ...VALID, photo_object_keys: ['a/b.jpg'] }).success,
    ).toBe(false);
  });

  it('rechaza una parte del cuerpo fuera de la selección cerrada', () => {
    expect(reportIncidentRequestSchema.safeParse({ ...VALID, body_part: 'spleen' }).success).toBe(
      false,
    );
  });

  it('rechaza `near_miss` como clasificación', () => {
    expect(
      reportIncidentRequestSchema.safeParse({ ...VALID, classification: 'near_miss' }).success,
    ).toBe(false);
  });

  it('rechaza una narrativa de dos caracteres', () => {
    expect(reportIncidentRequestSchema.safeParse({ ...VALID, what_happened: 'ok' }).success).toBe(
      false,
    );
  });
});

describe('el request de transición', () => {
  it('exige el método al abrir la investigación', () => {
    expect(
      incidentTransitionRequestSchema.safeParse({ to: 'under_investigation' }).success,
    ).toBe(false);
    expect(
      incidentTransitionRequestSchema.safeParse({ to: 'under_investigation', method: 'five_whys' })
        .success,
    ).toBe(true);
  });

  it('rechaza un método que no es de los dos', () => {
    expect(
      incidentTransitionRequestSchema.safeParse({ to: 'under_investigation', method: 'fishbone' })
        .success,
    ).toBe(false);
  });

  it('no acepta `from`: el servidor ya sabe cuál es el estado vigente', () => {
    expect(
      incidentTransitionRequestSchema.safeParse({ to: 'closed', from: 'reported' }).success,
    ).toBe(false);
  });
});

describe('el mapeo al Form 7', () => {
  it('mapea la versión de la fila, no la del código', () => {
    expect(form7MappingOf(1).length).toBeGreaterThan(0);
    expect(form7MappingOf(99)).toEqual([]);
  });

  it('marca como no almacenado todo lo clínico, en vez de dejarlo vacío', () => {
    const notStored = form7MappingOf(1).filter((field) => field.notStored);

    expect(notStored.length).toBeGreaterThan(0);
    for (const field of notStored) {
      expect(field.source).toBeNull();
      expect(field.note).toBeTruthy();
    }
  });

  it('ningún campo mapeado apunta a una fuente que el incidente no tiene', () => {
    const known: readonly string[] = [
      ...INCIDENT_FIELDS,
      'classification',
      'subject_person',
      'site',
    ];

    for (const field of form7MappingOf(1)) {
      if (field.source === null) continue;
      expect(known).toContain(field.source);
    }
  });

  it('no hay ruta a un PDF: el mapeo es datos para la pantalla', () => {
    for (const field of form7MappingOf(1)) {
      expect(field).not.toHaveProperty('pdfField');
    }
  });
});
