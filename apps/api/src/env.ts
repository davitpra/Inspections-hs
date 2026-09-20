import { z } from 'zod';

/**
 * La configuración del proceso, validada ENTERA antes de construir un solo módulo.
 *
 * Aparte de `main.ts` por la misma razón que `cors.ts`: `main.ts` arranca la aplicación
 * al importarse, y `env.spec.ts` tiene que poder probar las reglas sin abrir la base.
 *
 * Los módulos siguen leyendo `process.env` y siguen fallando solos (`DbService`,
 * `requireSecret`, `readConfig` de uploads). No es duplicación ociosa: los tests de
 * integración levantan la app con `Test.createTestingModule` y no pasan por acá. Lo que
 * agrega esta capa es el orden y el conjunto:
 *
 *   - **Todos los errores de una vez.** Sin esto, un despliegue con tres variables mal
 *     puestas se descubre en tres reinicios, uno por módulo que se cae.
 *   - **Lo que hoy no falla nunca.** `WEB_ORIGINS` con una barra al final, `JOBS_ENABLED=0`
 *     o `S3_UPLOAD_TTL_SECONDS=cinco` no rompen nada al arrancar: dejan una PWA sin CORS,
 *     un planificador encendido o una URL firmada con vida `NaN`. Acá se rechazan.
 *   - **Las reglas de producción.** Los defaults que sirven en la máquina del desarrollador
 *     —orígenes de Vite, conexión sin TLS, `request.ip` sin proxy— son exactamente los que
 *     no pueden llegar a producción sin que nadie lo note.
 *
 * Los mensajes nombran la variable y el problema, NUNCA el valor: la mitad de estas
 * variables son secretos y el log de arranque termina en la consola de la plataforma.
 */

/** Una variable vacía (`S3_ENDPOINT=`) es una variable ausente, no una URL inválida. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const flag = z.enum(['true', 'false'], { error: "Tiene que ser 'true' o 'false'" });

const required = () => z.string({ error: 'Obligatoria' }).min(1, 'Obligatoria');

/**
 * Los dos únicos `sslmode` que producción acepta.
 *
 * `verify-full` es el camino normal contra una base gestionada. `disable` existe para la
 * red privada de la plataforma (Fly `.internal`, Railway privado), donde el tráfico no sale
 * del proveedor y la base no ofrece TLS; tiene que estar ESCRITO, y `main.ts` lo avisa.
 *
 * `require`, `prefer` y `verify-ca` se rechazan aunque parezcan seguros: `pg` 8 los trata
 * hoy como alias de `verify-full` (con un aviso) y anuncia que en la próxima mayor pasan a
 * significar lo de libpq —cifrar sin verificar el certificado—. Un `require` que hoy
 * protege y mañana no, sin cambiar una letra de la configuración, no es una opción.
 */
const PRODUCTION_SSL_MODES = ['verify-full', 'disable'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: 'Tiene que ser una URL postgres://' }),

  BETTER_AUTH_SECRET: required().min(32, 'Tiene que tener al menos 32 caracteres'),
  BETTER_AUTH_URL: optional(z.url()),

  JOBS_ENABLED: flag.default('true'),

  S3_BUCKET: required(),
  S3_ACCESS_KEY_ID: required(),
  S3_SECRET_ACCESS_KEY: required(),
  S3_ENDPOINT: optional(z.url()),
  S3_REGION: optional(z.string()),
  S3_FORCE_PATH_STYLE: optional(flag),
  S3_UPLOAD_TTL_SECONDS: optional(z.coerce.number().int().positive()),

  WEB_ORIGINS: optional(z.string()),

  /**
   * Cuántos proxies hay entre internet y este proceso. Es lo que decide qué valor toma
   * `request.ip`, y de `request.ip` dependen el límite de intentos y la IP que queda
   * guardada en la sesión.
   *
   * Un número y no `true`: `true` confía en TODO `X-Forwarded-For`, y cualquier cliente
   * podría inventarse una IP distinta en cada intento de login y no toparse nunca con el
   * límite.
   */
  TRUST_PROXY: optional(z.coerce.number().int().min(0).max(10)),

  /**
   * Cuánto espera el apagado a que terminen los requests en vuelo antes de cortarlos.
   * Tiene que ser MENOR que la gracia de la plataforma entre SIGTERM y SIGKILL, o la
   * plataforma corta primero y el cierre ordenado de la base no llega a correr.
   */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(8_000),
});

type RawEnv = z.infer<typeof envSchema>;

export interface AppEnv {
  production: boolean;
  port: number;
  /** `undefined` cuando la URL no lo declara, que fuera de producción es lo normal. */
  databaseSslMode: string | undefined;
  /** `false` = no hay proxy delante; un número = cuántos saltos se confían. */
  trustProxy: number | false;
  shutdownGraceMs: number;
}

export function validateEnv(source: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  const env = parsed.data;
  const production = env.NODE_ENV === 'production';
  const problems = [...originProblems(env, production)];

  const databaseSslMode = new URL(env.DATABASE_URL).searchParams.get('sslmode') ?? undefined;

  if (production) {
    if (!databaseSslMode || !isProductionSslMode(databaseSslMode)) {
      problems.push(
        `DATABASE_URL: en producción tiene que declarar sslmode=${PRODUCTION_SSL_MODES.join(' o sslmode=')}`,
      );
    }

    if (env.TRUST_PROXY === undefined) {
      problems.push(
        'TRUST_PROXY: obligatoria en producción (0 si nada va delante de la API; si no, cuántos proxies hay)',
      );
    }

    if (!env.BETTER_AUTH_URL) {
      problems.push('BETTER_AUTH_URL: obligatoria en producción');
    }

    if (env.S3_ENDPOINT && new URL(env.S3_ENDPOINT).protocol !== 'https:') {
      problems.push('S3_ENDPOINT: en producción tiene que ser https');
    }
  }

  if (problems.length > 0) throw new EnvError(problems);

  return {
    production,
    port: env.PORT,
    databaseSslMode,
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY : false,
    shutdownGraceMs: env.SHUTDOWN_GRACE_MS,
  };
}

/**
 * `WEB_ORIGINS` se compara byte a byte contra el header `Origin` del navegador, que
 * nunca trae barra final ni ruta. `https://app.example.com/` no coincide con nada, y el
 * síntoma no es un error de arranque sino una PWA que muere con «Failed to fetch» en
 * todas las pantallas (ver `cors.ts`). Por eso se valida la FORMA en todo entorno, y la
 * presencia y el `https` solo en producción.
 */
function originProblems(env: RawEnv, production: boolean): string[] {
  if (!env.WEB_ORIGINS) {
    return production
      ? ['WEB_ORIGINS: obligatoria en producción (el default de desarrollo solo admite a Vite)']
      : [];
  }

  const problems: string[] = [];

  for (const origin of env.WEB_ORIGINS.split(',').map((entry) => entry.trim())) {
    const url = URL.canParse(origin) ? new URL(origin) : null;

    if (!url || url.origin !== origin) {
      problems.push(
        'WEB_ORIGINS: cada entrada tiene que ser un origen pelado como https://app.example.com (sin ruta, sin barra final, sin comodín)',
      );
    } else if (production && url.protocol !== 'https:') {
      problems.push('WEB_ORIGINS: en producción todos los orígenes tienen que ser https');
    }
  }

  return [...new Set(problems)];
}

function isProductionSslMode(mode: string): mode is (typeof PRODUCTION_SSL_MODES)[number] {
  return (PRODUCTION_SSL_MODES as readonly string[]).includes(mode);
}

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Entorno inválido. Ver .env.example.\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvError';
  }
}
