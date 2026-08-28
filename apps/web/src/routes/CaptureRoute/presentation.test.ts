import { describe, expect, it } from 'vitest';

import { answeredLabel, captureSubtitle, draftStatusLabel, draftStatusPill } from './presentation';

describe('draftStatusLabel', () => {
  it('nombra los tres estados del borrador', () => {
    expect(draftStatusLabel('capturing')).toBe('Draft');
    expect(draftStatusLabel('signed')).toBe('Signed');
    expect(draftStatusLabel('accepted')).toBe('Accepted');
  });
});

describe('draftStatusPill', () => {
  it('da una clase distinta por estado', () => {
    expect(draftStatusPill('capturing')).toBe('status-pill status-pill--draft');
    expect(draftStatusPill('signed')).toBe('status-pill status-pill--signed');
    expect(draftStatusPill('accepted')).toBe('status-pill status-pill--completed');
  });
});

describe('captureSubtitle', () => {
  it('nombra la plantilla y el día en que se empezó', () => {
    expect(captureSubtitle('Monthly workplace inspection', '2026-08-26T14:42:00.000Z')).toBe(
      'Monthly workplace inspection • Started Aug 26, 2026',
    );
  });

  /**
   * La fecha se resuelve en la zona de la planta y no se recorta: un borrador empezado a las
   * 21:00 de Ontario llega como el día siguiente en UTC, y fecharlo un día tarde es
   * exactamente el error que `formatCivilDay` existe para evitar.
   */
  it('fecha en la zona de la planta, no en UTC', () => {
    expect(captureSubtitle('Quarterly walkaround', '2026-08-27T01:00:00.000Z')).toBe(
      'Quarterly walkaround • Started Aug 26, 2026',
    );
  });

  /**
   * Un paquete descargado antes de que el nombre existiera en el contrato. Se degrada a la
   * fecha sola: lo que no puede pasar es que el encabezado diga «undefined».
   */
  it('deja solo la fecha cuando el paquete guardado no trae nombre', () => {
    expect(captureSubtitle(undefined, '2026-08-26T14:42:00.000Z')).toBe('Started Aug 26, 2026');
  });
});

describe('answeredLabel', () => {
  it('escribe el conteo tal como lo da el motor', () => {
    expect(answeredLabel(0)).toBe('0 answered');
    expect(answeredLabel(2)).toBe('2 answered');
  });
});
