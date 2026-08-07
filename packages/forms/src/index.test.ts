import { describe, expect, it } from 'vitest';

import { isAnswered } from './index.js';

describe('isAnswered', () => {
  it('trata null, undefined, string vacío y array vacío como sin contestar', () => {
    expect(isAnswered(null)).toBe(false);
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered('   ')).toBe(false);
    expect(isAnswered([])).toBe(false);
  });

  it('trata false y 0 como respuestas válidas', () => {
    expect(isAnswered(false)).toBe(true);
    expect(isAnswered(0)).toBe(true);
  });
});
