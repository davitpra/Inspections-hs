import { describe, expect, it } from 'vitest';
import type { Incident } from '@hs/contracts';

import { valueOf } from './presentation';

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    classification: 'critical_injury',
    subject_person_id: '11111111-1111-4111-8111-111111111111',
    site_id: '22222222-2222-4222-8222-222222222222',
    location_id: '33333333-3333-4333-8333-333333333333',
    occurred_at: '2026-08-17T13:00:00.000Z',
    task_performed: 'Clearing a jam on the infeed',
    equipment_involved: 'Line 3 conveyor',
    what_happened: 'The guard was open and the belt restarted',
    body_part: 'arm_or_elbow',
    on_site_treatment: 'none',
    immediate_action: 'Locked out the line',
    witnesses: [],
    fields_of_version: ['occurred_at', 'task_performed', 'body_part', 'witnesses'],
    ...overrides,
  } as unknown as Incident;
}

describe('el valor de un campo del Form 7', () => {
  it('traduce lo codificado a la etiqueta que el coordinador transcribe', () => {
    expect(valueOf(incident(), { label: 'Classification', source: 'classification' })).toBe(
      'Critical injury',
    );
    expect(valueOf(incident(), { label: 'Body part', source: 'body_part' })).toBe('Arm or elbow');
  });

  /**
   * La distinción que la pantalla existe para sostener: en un registro inmutable "no
   * aplicaba" y "no existía" no son lo mismo, y una cadena vacía las confunde.
   */
  it('deja constancia cuando el campo no existía en la versión de este incidente', () => {
    expect(valueOf(incident(), { label: 'Equipment', source: 'equipment_involved' })).toBe(
      'This field did not exist in this version of the form.',
    );
  });

  it('devuelve el valor cuando la versión sí incluía el campo', () => {
    expect(valueOf(incident(), { label: 'Task', source: 'task_performed' })).toBe(
      'Clearing a jam on the infeed',
    );
  });

  /** `classification`, `subject_person` y `site` no viven en `fields_of_version`. */
  it('no somete al versionado a los tres campos que no son del formulario', () => {
    const bare = incident({ fields_of_version: [] as unknown as Incident['fields_of_version'] });

    expect(valueOf(bare, { label: 'Site', source: 'site' })).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('un campo sin fuente —los que el sistema no guarda— no inventa un valor', () => {
    expect(valueOf(incident(), { label: 'Doctor', source: null, notStored: true })).toBe('');
  });

  it('lista los testigos con su número de legajo', () => {
    const witnessed = incident({
      witnesses: [
        { first_name: 'Ana', last_name: 'Ruiz', employee_number: 'E-1042' },
      ] as unknown as Incident['witnesses'],
    });

    expect(valueOf(witnessed, { label: 'Witnesses', source: 'witnesses' })).toBe(
      'Ana Ruiz (E-1042)',
    );
  });
});
