import { describe, expect, it } from 'vitest';
import {
  INCIDENT_CLASSIFICATIONS,
  INCIDENT_STATES,
  type Incident,
  type IncidentState,
  type RegulatoryClockDto,
  type Session,
} from '@hs/contracts';

import {
  BODY_PART_LABELS,
  CLASSIFICATION_LABELS,
  INCIDENT_STATE_LABELS,
  OBLIGATION_LABELS,
  TREATMENT_LABELS,
  availableTransitions,
  clockOrigin,
  clockStatus,
  hadField,
  incidentTransitionLabel,
} from './incident-presentation';

const PERSON = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function session(role: Session['role']): Session {
  return {
    userId: USER,
    personId: PERSON,
    role,
    siteScope: ['33333333-3333-4333-8333-333333333333'],
    purpose: 'full',
    recordsFrom: null,
    recordsTo: null,
  };
}

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    site_id: '33333333-3333-4333-8333-333333333333',
    form_version: 1,
    classification: 'first_aid',
    subject_person_id: PERSON,
    reported_by: USER,
    occurred_at: '2026-03-02T13:00:00.000Z',
    reported_at: '2026-03-02T14:00:00.000Z',
    location_id: '55555555-5555-4555-8555-555555555555',
    task_performed: 'Moving pallets',
    equipment_involved: 'Forklift #4',
    what_happened: 'The load shifted',
    body_part: 'hand_or_finger',
    on_site_treatment: 'first_aid_on_site',
    immediate_action: 'Area cordoned off',
    narrative_language: 'en',
    created_at: '2026-03-02T14:00:00.000Z',
    state: 'reported',
    clocks: [],
    fields_of_version: [
      'occurred_at',
      'location_id',
      'task_performed',
      'equipment_involved',
      'what_happened',
      'body_part',
      'on_site_treatment',
      'witnesses',
      'immediate_action',
    ],
    witnesses: [],
    events: [],
    investigation: null,
    ...overrides,
  };
}

describe('qué botones ofrece la pantalla', () => {
  it('el supervisor que reportó no puede investigar ni cerrar', () => {
    expect(availableTransitions(incident(), session('supervisor'))).toEqual([]);
  });

  it('gerencia tampoco: §4 dice que investigar y cerrar son del coordinador', () => {
    expect(availableTransitions(incident(), session('management'))).toEqual([]);
  });

  it('el coordinador puede investigar y cerrar un primeros auxilios', () => {
    const available = availableTransitions(incident(), session('hs_coordinator'));

    expect(available.map((transition) => transition.to).sort()).toEqual([
      'closed',
      'under_investigation',
    ]);
  });

  /**
   * La mitad de la regla que SÍ se puede resolver sin la base: la clasificación decide si
   * el cierre directo existe siquiera. Las otras dos —causa raíz y acciones abiertas—
   * dependen de otras filas y las contesta el servidor.
   */
  it('una lesión crítica no ofrece el cierre directo, ni siquiera al coordinador', () => {
    const available = availableTransitions(
      incident({ classification: 'critical_injury' }),
      session('hs_coordinator'),
    );

    expect(available.map((transition) => transition.to)).toEqual(['under_investigation']);
  });

  it('sin sesión no se ofrece nada', () => {
    expect(availableTransitions(incident(), null)).toEqual([]);
  });

  it('un incidente cerrado ofrece reabrir al coordinador y nada a los demás', () => {
    const closed = incident({ state: 'closed' });

    expect(
      availableTransitions(closed, session('hs_coordinator')).map((transition) => transition.to),
    ).toEqual(['under_investigation']);
    expect(availableTransitions(closed, session('supervisor'))).toEqual([]);
  });
});

describe('cómo se nombran las cosas', () => {
  it('hay una etiqueta por estado y por clasificación', () => {
    for (const state of INCIDENT_STATES) expect(INCIDENT_STATE_LABELS[state]).toBeTruthy();
    for (const classification of INCIDENT_CLASSIFICATIONS) {
      expect(CLASSIFICATION_LABELS[classification]).toBeTruthy();
    }
  });

  it('todas las partes del cuerpo y los tratamientos tienen etiqueta', () => {
    expect(Object.values(BODY_PART_LABELS).every(Boolean)).toBe(true);
    expect(Object.values(TREATMENT_LABELS).every(Boolean)).toBe(true);
  });

  it('ninguna etiqueta de parte del cuerpo nombra una lesión', () => {
    const text = Object.values(BODY_PART_LABELS).join(' ').toLowerCase();

    for (const clinical of ['fracture', 'burn', 'cut', 'sprain', 'concussion']) {
      expect(text).not.toContain(clinical);
    }
  });

  it('el botón se nombra por PAR y no por destino', () => {
    // Los dos llegan a `closed` y son cosas distintas.
    expect(incidentTransitionLabel('reported', 'closed')).not.toBe(
      incidentTransitionLabel('under_investigation', 'closed'),
    );
  });

  it('cada obligación dice qué hay que hacer, no solo cómo se llama', () => {
    for (const label of Object.values(OBLIGATION_LABELS)) {
      expect(label.length).toBeGreaterThan(15);
    }
  });
});

describe('cómo se lee un reloj', () => {
  function clock(overrides: Partial<RegulatoryClockDto> = {}): RegulatoryClockDto {
    return {
      authority: 'wsib',
      obligation: 'wsib_form7',
      counts_from: 'report',
      from: '2026-03-02T14:00:00.000Z',
      due_at: '2026-03-05T14:00:00.000Z',
      immediate: false,
      overdue: false,
      citation: 'WSIA s. 21(2)',
      ...overrides,
    };
  }

  it('el aviso inmediato se lee como inmediato y no como vencido', () => {
    expect(clockStatus(clock({ immediate: true, due_at: null }))).toBe('Immediately');
  });

  it('un reloj vencido se dice vencido y no se esconde', () => {
    expect(clockStatus(clock({ overdue: true }))).toContain('Was due');
  });

  it('un reloj vigente dice cuándo vence', () => {
    expect(clockStatus(clock())).toContain('Due');
  });

  it('dice de qué instante cuenta, porque los dos no cuentan de lo mismo', () => {
    expect(clockOrigin(clock({ counts_from: 'occurrence' }))).toContain('happened');
    expect(clockOrigin(clock({ counts_from: 'report' }))).toContain('reported');
  });
});

describe('los campos de la versión de este incidente', () => {
  it('un campo de la versión se muestra', () => {
    expect(hadField(incident(), 'what_happened')).toBe(true);
  });

  /**
   * Sin esto, "vacío porque no aplicaba" y "vacío porque el campo no existía" se ven
   * idénticos, y en un registro inmutable esa diferencia no se reconstruye después.
   */
  it('un campo que no existía en esa versión se distingue de uno vacío', () => {
    const older = incident({ form_version: 0, fields_of_version: ['what_happened'] });

    expect(hadField(older, 'what_happened')).toBe(true);
    expect(hadField(older, 'body_part')).toBe(false);
  });
});

describe('los estados que la pantalla sabe mostrar', () => {
  it('cubre los tres del contrato y ninguno de más', () => {
    const known = Object.keys(INCIDENT_STATE_LABELS) as IncidentState[];

    expect([...known].sort()).toEqual([...INCIDENT_STATES].sort());
  });
});
