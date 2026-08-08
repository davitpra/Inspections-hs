/**
 * Tipos de `jobs-install.mjs`. El instalador es JavaScript plano porque
 * `db:jobs:install` lo ejecuta con `node` sin paso de compilación, igual que
 * `db:migrate` y `db:seed`. Esta declaración existe para que la suite de integración
 * —que también prepara el esquema de trabajos— lo consuma tipado en vez de con un
 * `any`.
 */

/** Algo con `query`: sirve tanto un `Pool` como un `Client` de `pg`. */
interface Queryable {
  query(sql: string): Promise<{ rows: { version?: number }[] }>;
}

export interface InstallResult {
  action: 'installed' | 'migrated' | 'up-to-date';
  version?: number;
  from?: number;
}

/**
 * Instala o actualiza el esquema `pgboss`. Idempotente.
 *
 * El cliente tiene que ser de `hs_migrator`: el esquema es suyo y `hs_app` no tiene
 * CREATE. Correrlo ANTES de la migración `0008` deja un esquema que `hs_app` no puede
 * tocar, porque los ALTER DEFAULT PRIVILEGES no son retroactivos.
 */
export declare function installJobSchema(client: Queryable): Promise<InstallResult>;
