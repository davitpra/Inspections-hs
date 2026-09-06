import { describe, expect, it } from 'vitest';

import { DiscardRefusedError } from '../offline/drafts';
import {
  discardRefusalMessage,
  draftStatusLabel,
  draftStatusPill,
  draftSubtitle,
} from './drafts';

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

describe('draftSubtitle', () => {
  it('nombra la plantilla y el día en que se empezó', () => {
    expect(draftSubtitle('Monthly workplace inspection', '2026-08-26T14:42:00.000Z')).toBe(
      'Monthly workplace inspection • Started Aug 26, 2026',
    );
  });

  /**
   * La fecha se resuelve en la zona de la planta y no se recorta: un borrador empezado a las
   * 21:00 de Ontario llega como el día siguiente en UTC, y fecharlo un día tarde es
   * exactamente el error que `formatCivilDay` existe para evitar.
   */
  it('fecha en la zona de la planta, no en UTC', () => {
    expect(draftSubtitle('Quarterly walkaround', '2026-08-27T01:00:00.000Z')).toBe(
      'Quarterly walkaround • Started Aug 26, 2026',
    );
  });

  /**
   * Un paquete descargado antes de que el nombre existiera en el contrato. Se degrada a la
   * fecha sola: lo que no puede pasar es que el encabezado diga «undefined».
   */
  it('deja solo la fecha cuando el paquete guardado no trae nombre', () => {
    expect(draftSubtitle(undefined, '2026-08-26T14:42:00.000Z')).toBe('Started Aug 26, 2026');
  });
});

describe('discardRefusalMessage', () => {
  it('explica que un descarte rechazado conserva el borrador', () => {
    expect(discardRefusalMessage(new DiscardRefusedError('not_owner'))).toMatch(/another account/);
    expect(discardRefusalMessage(new DiscardRefusedError('already_queued'))).toMatch(/on its way/);
    expect(discardRefusalMessage(new Error('boom'))).toMatch(/still on this device/);
  });

  /**
   * Las dos negativas del envío dicen lo mismo a propósito: son dos comprobaciones —la
   * columna y la fila de cola— sobre una sola conclusión para el inspector.
   */
  it('no distingue lo firmado de lo encolado', () => {
    expect(discardRefusalMessage(new DiscardRefusedError('already_signed'))).toBe(
      discardRefusalMessage(new DiscardRefusedError('already_queued')),
    );
  });
});
