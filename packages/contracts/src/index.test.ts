import { describe, expect, it } from 'vitest';

import { healthResponseSchema } from './index.js';

describe('healthResponseSchema', () => {
  it('acepta una respuesta válida', () => {
    expect(healthResponseSchema.parse({ status: 'ok', service: 'api' })).toEqual({
      status: 'ok',
      service: 'api',
    });
  });

  it('rechaza un status distinto de "ok"', () => {
    expect(healthResponseSchema.safeParse({ status: 'down', service: 'api' }).success).toBe(false);
  });
});
