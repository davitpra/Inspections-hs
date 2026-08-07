/**
 * Tipos de `seed.mjs`. El runner es JavaScript plano porque `db:seed` lo ejecuta
 * con `node` sin paso de compilación, igual que `db:migrate`. Esta declaración
 * existe para que la suite de integración —que también aplica los seeds— lo
 * consuma tipado en vez de con un `any`.
 */

/** Algo con `query`: sirve tanto un `Pool` como un `Client` de `pg`. */
interface Queryable {
  query(sql: string): Promise<unknown>;
}

export declare const SEEDS_DIR: string;

/** Los `.sql` de `seeds/`, ordenados por nombre. */
export declare function seedFiles(): Promise<string[]>;

/** Aplica todos los seeds y devuelve los nombres aplicados. */
export declare function applySeeds(client: Queryable): Promise<string[]>;
