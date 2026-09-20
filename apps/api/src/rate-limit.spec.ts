import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { RATE_LIMITED_ROUTES } from './rate-limit';

/**
 * El límite se monta por RUTA LITERAL en `main.ts`, lejos del controller que la declara.
 * Si alguien renombra `sign-in`, el middleware sigue montado sobre una ruta que ya no
 * existe y el login queda sin límite, sin que ningún test ni ningún log lo diga. Por eso se
 * lee el fuente del controller, igual que `cors.spec.ts` hace con los verbos.
 */
const authController = readFileSync(join(__dirname, 'auth', 'auth.controller.ts'), 'utf8');

describe('RATE_LIMITED_ROUTES', () => {
  it('toda ruta limitada existe como POST en AuthController', () => {
    expect(authController).toContain("@Controller('auth')");

    for (const { path } of RATE_LIMITED_ROUTES) {
      const route = path.replace(/^\/auth\//, '');

      expect(path).toMatch(/^\/auth\//);
      expect(authController).toContain(`@Post('${route}')`);
    }
  });

  it('no limita el refresh: un 429 ahí desloguea al dispositivo (session-client.ts)', () => {
    expect(RATE_LIMITED_ROUTES.map(({ path }) => path)).not.toContain('/auth/refresh');
  });
});
