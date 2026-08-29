import type { Finding } from '@hs/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FindingReadout } from './FindingReadout';

const FINDING = {
  id: '11111111-1111-4111-8111-111111111111',
  site_id: '22222222-2222-4222-8222-222222222222',
  origin: 'inspection',
  inspection_id: '33333333-3333-4333-8333-333333333333',
  template_version_item_id: '44444444-4444-4444-8444-444444444444',
  item_key: 'guard-in-place',
  location_id: null,
  description: 'The guard was removed and left on the bench next to the press.',
  photo_object_keys: ['sites/a/findings/1.jpg', 'sites/a/findings/2.jpg'],
  reported_by: '55555555-5555-4555-8555-555555555555',
  occurred_at: '2026-07-30T14:00:00-04:00',
  recorded_at: '2026-07-30T18:02:00-04:00',
} satisfies Finding;

afterEach(() => {
  cleanup();
});

describe('FindingReadout', () => {
  it('lee lo prescrito por la plantilla arriba de lo que observó el inspector', () => {
    render(
      <FindingReadout
        correctiveAction="Refit the machine guard before the press is used again."
        finding={FINDING}
      />,
    );

    expect(screen.getByText('Corrective action')).toBeTruthy();
    expect(
      screen.getByText('Refit the machine guard before the press is used again.'),
    ).toBeTruthy();
    expect(screen.getByText(FINDING.description)).toBeTruthy();
    expect(screen.getByText('2 photos')).toBeTruthy();
  });

  /*
    Lo que importa es que NO APAREZCA EL ENCABEZADO. Un ítem sin prescripción es un ítem
    sobre el que la plantilla no decidió nada, y dibujar «Corrective action» con el hueco
    debajo lo leería como una plantilla que decidió no hacer nada.
  */
  it('no anuncia una acción correctiva cuando el ítem no prescribe ninguna', () => {
    render(<FindingReadout correctiveAction={undefined} finding={FINDING} />);

    expect(screen.queryByText('Corrective action')).toBeNull();
    expect(screen.getByText(FINDING.description)).toBeTruthy();
  });
});
