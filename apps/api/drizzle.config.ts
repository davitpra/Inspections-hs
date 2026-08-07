import { defineConfig } from 'drizzle-kit';

/**
 * ADR-004 — Las migraciones se escriben a mano.
 *
 * `drizzle-kit generate` está PROHIBIDO en este proyecto. Una migración generada
 * a partir del esquema TypeScript contiene `CREATE TABLE` y nada más: no lleva
 * los `REVOKE UPDATE, DELETE`, ni los triggers de inmutabilidad, ni las políticas
 * RLS por sitio. Regenerar una migración existente las borraría sin avisar, y la
 * inmutabilidad que ADR-002 exige del motor dejaría de existir en silencio.
 *
 * Por eso `apps/api/package.json` expone `db:migrate` (aplicar) y ningún script
 * de `generate`. Los `.sql` de `drizzle/` se escriben a mano, en orden, y
 * `drizzle/meta/_journal.json` se mantiene a mano: una entrada por archivo, con
 * el mismo `tag` que el nombre del `.sql` sin extensión.
 *
 * `src/db/schema/` es un espejo declarado del SQL —existe para tipar consultas—,
 * nunca su fuente de verdad.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema',
  out: './drizzle',
  // Rol hs_migrator: es el único que puede cambiar el esquema (ADR-002).
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? '',
  },
});
