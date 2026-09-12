import { describe, expect, it } from 'vitest';
import {
  ESCALATION_DAYS,
  ESCALATION_LEVELS,
  ESCALATION_RECIPIENT_ROLE,
  escalationLevelsDue,
} from '@hs/contracts';

import { NOTIFICATION_KIND } from './escalation.service';

const DUE = new Date('2026-08-10T13:00:00.000Z');

function at(days: number): Date {
  return new Date(DUE.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Los umbrales, con el reloj inyectado.
 *
 * La regla vive en `@hs/contracts` y la consulta del cron la reproduce en SQL —
 * `due_at < now - N days`— porque una barrida de miles de filas no se hace trayéndolas
 * a memoria. Esto afirma el lado puro; que el SQL diga lo mismo lo afirma
 * `corrective-actions.int-spec.ts` corriendo el trabajo de verdad.
 */
describe('los umbrales del escalamiento', () => {
  it('dos días de atraso no escalan a nadie', () => {
    expect(escalationLevelsDue(DUE, at(2))).toEqual([]);
  });

  it('cuatro días escalan al coordinador y solo al coordinador', () => {
    expect(escalationLevelsDue(DUE, at(4))).toEqual(['hs_coordinator']);
  });

  it('ocho días escalan a los dos niveles', () => {
    expect(escalationLevelsDue(DUE, at(8))).toEqual(['hs_coordinator', 'management']);
  });

  it('dentro del plazo no escala', () => {
    expect(escalationLevelsDue(DUE, at(-3))).toEqual([]);
  });

  it('los umbrales son los +3 y +7 que R3 fija', () => {
    expect(ESCALATION_DAYS.hs_coordinator).toBe(3);
    expect(ESCALATION_DAYS.management).toBe(7);
  });
});

/**
 * A quién le llega cada nivel. §4, tabla de roles: "Gerencia recibe escalamientos".
 *
 * Que cada nivel tenga su `kind` propio —y no uno solo con un campo `level`— es lo que
 * hace que la bandeja del coordinador y la de gerencia se distingan por el destinatario
 * y no por el contenido.
 */
describe('los destinatarios', () => {
  it('el escalón del coordinador va a coordinadores, el de gerencia a gerencia', () => {
    expect(ESCALATION_RECIPIENT_ROLE.hs_coordinator).toBe('hs_coordinator');
    expect(ESCALATION_RECIPIENT_ROLE.management).toBe('management');
  });

  it('cada nivel tiene su propio tipo de notificación', () => {
    expect(NOTIFICATION_KIND.hs_coordinator).toBe('corrective_action_overdue_coordinator');
    expect(NOTIFICATION_KIND.management).toBe('corrective_action_overdue_management');
  });

  it('los dos niveles están cubiertos y no hay un tercero', () => {
    expect(ESCALATION_LEVELS).toEqual(['hs_coordinator', 'management']);
    expect(Object.keys(NOTIFICATION_KIND)).toEqual([...ESCALATION_LEVELS]);
    expect(Object.keys(ESCALATION_RECIPIENT_ROLE)).toEqual([...ESCALATION_LEVELS]);
  });
});
