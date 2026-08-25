import { describe, expect, it } from 'vitest';

import { driftMessage } from './presentation';

describe('driftMessage', () => {
  it('sin deriva no dice nada', () => {
    expect(driftMessage('none')).toBeNull();
  });

  it('un paquete rancio manda a refrescar', () => {
    expect(driftMessage('stale-package')).toContain('Refresh it');
  });

  it('un borrador huérfano distingue si todavía puede descartarse', () => {
    expect(driftMessage('draft-orphaned', 'capturing')).toContain('Discard it');
    const signed = driftMessage('draft-orphaned', 'signed');
    expect(signed).not.toContain('Discard it');
    expect(signed).toContain('server will refuse it');
  });

  it('una versión nueva distingue el estado del borrador', () => {
    expect(driftMessage('newer-version')).toContain('Refresh the package');
    expect(driftMessage('newer-version', 'capturing')).toContain('Discard this draft');
    expect(driftMessage('newer-version', 'signed')).toContain('server will refuse it');
  });
});
