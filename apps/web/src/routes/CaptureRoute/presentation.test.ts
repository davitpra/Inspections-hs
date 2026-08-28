import { describe, expect, it } from 'vitest';

import { answeredLabel } from './presentation';

describe('answeredLabel', () => {
  it('escribe el conteo tal como lo da el motor', () => {
    expect(answeredLabel(0)).toBe('0 answered');
    expect(answeredLabel(2)).toBe('2 answered');
  });
});
