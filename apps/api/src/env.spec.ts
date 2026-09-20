import { describe, expect, it } from 'vitest';

import { EnvError, validateEnv } from './env';

/** Un entorno de desarrollo completo, como el de `.env.example`. */
const DEVELOPMENT: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://hs_app:hs_app_dev@localhost:5432/hs_platform',
  BETTER_AUTH_SECRET: 'dev-only-secret-change-me-0123456789abcdef',
  S3_BUCKET: 'hs-platform-dev',
  S3_ACCESS_KEY_ID: 'hs_uploads_dev',
  S3_SECRET_ACCESS_KEY: 'hs_uploads_dev_secret',
  S3_ENDPOINT: 'http://localhost:9000',
  WEB_ORIGINS: 'http://localhost:5173,http://localhost:4173',
};

/** Lo mínimo que producción acepta. */
const PRODUCTION: NodeJS.ProcessEnv = {
  ...DEVELOPMENT,
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://hs_app:secret@db.example.com:5432/hs_platform?sslmode=verify-full',
  BETTER_AUTH_URL: 'https://api.example.com',
  S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  WEB_ORIGINS: 'https://app.example.com',
  TRUST_PROXY: '1',
};

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    validateEnv(env);
    return [];
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
}

describe('validateEnv', () => {
  it('acepta el entorno de desarrollo del .env.example', () => {
    expect(validateEnv(DEVELOPMENT)).toEqual({
      production: false,
      port: 3000,
      databaseSslMode: undefined,
      trustProxy: false,
      shutdownGraceMs: 8000,
    });
  });

  it('acepta un entorno de producción completo', () => {
    expect(validateEnv(PRODUCTION)).toMatchObject({
      production: true,
      databaseSslMode: 'verify-full',
      trustProxy: 1,
    });
  });

  it('junta todos los problemas en un solo error, en vez de uno por reinicio', () => {
    const problems = problemsOf({ ...DEVELOPMENT, S3_BUCKET: undefined, JOBS_ENABLED: '0' });

    expect(problems.map((problem) => problem.split(':')[0])).toEqual(
      expect.arrayContaining(['S3_BUCKET', 'JOBS_ENABLED']),
    );
  });

  it('nunca repite el valor de un secreto en el mensaje', () => {
    const secret = 'short-secret';
    const error = (() => {
      try {
        validateEnv({ ...DEVELOPMENT, BETTER_AUTH_SECRET: secret });
      } catch (caught) {
        return caught as Error;
      }
    })();

    expect(error?.message).toContain('BETTER_AUTH_SECRET');
    expect(error?.message).not.toContain(secret);
  });

  it('trata una variable vacía como ausente', () => {
    expect(problemsOf({ ...DEVELOPMENT, S3_ENDPOINT: '' })).toEqual([]);
  });

  it('rechaza un TTL de subida que no es un número', () => {
    expect(problemsOf({ ...DEVELOPMENT, S3_UPLOAD_TTL_SECONDS: 'cinco' })).toHaveLength(1);
  });

  describe('WEB_ORIGINS', () => {
    it.each([
      ['barra final', 'http://localhost:5173/'],
      ['ruta', 'https://app.example.com/pwa'],
      ['comodín', '*'],
    ])('rechaza en cualquier entorno un origen con %s', (_, origin) => {
      expect(problemsOf({ ...DEVELOPMENT, WEB_ORIGINS: origin })).toHaveLength(1);
    });

    it('sin configurar vale en desarrollo y no en producción', () => {
      expect(problemsOf({ ...DEVELOPMENT, WEB_ORIGINS: undefined })).toEqual([]);
      expect(problemsOf({ ...PRODUCTION, WEB_ORIGINS: undefined })).toHaveLength(1);
    });

    it('exige https en producción', () => {
      expect(problemsOf({ ...PRODUCTION, WEB_ORIGINS: 'http://app.example.com' })).toHaveLength(1);
    });
  });

  describe('sslmode en producción', () => {
    const withSslMode = (mode: string | null): NodeJS.ProcessEnv => {
      const url = new URL(PRODUCTION.DATABASE_URL as string);
      if (mode === null) url.searchParams.delete('sslmode');
      else url.searchParams.set('sslmode', mode);

      return { ...PRODUCTION, DATABASE_URL: url.toString() };
    };

    it('rechaza una URL que no lo declara: sin TLS por omisión', () => {
      expect(problemsOf(withSslMode(null))).toHaveLength(1);
    });

    it.each(['require', 'prefer', 'verify-ca'])(
      'rechaza %s, cuyo significado cambia en la próxima mayor de pg',
      (mode) => {
        expect(problemsOf(withSslMode(mode))).toHaveLength(1);
      },
    );

    it('acepta disable escrito a propósito', () => {
      expect(validateEnv(withSslMode('disable')).databaseSslMode).toBe('disable');
    });

    it('no lo exige fuera de producción', () => {
      expect(problemsOf(DEVELOPMENT)).toEqual([]);
    });
  });

  it('exige TRUST_PROXY en producción, y 0 significa sin proxy', () => {
    expect(problemsOf({ ...PRODUCTION, TRUST_PROXY: undefined })).toHaveLength(1);
    expect(validateEnv({ ...PRODUCTION, TRUST_PROXY: '0' }).trustProxy).toBe(false);
  });

  it('exige https en S3_ENDPOINT en producción', () => {
    expect(problemsOf({ ...PRODUCTION, S3_ENDPOINT: 'http://minio:9000' })).toHaveLength(1);
  });
});
