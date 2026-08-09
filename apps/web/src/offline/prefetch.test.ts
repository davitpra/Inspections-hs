import { afterEach, describe, expect, it } from 'vitest';

import {
  fail,
  fakeSessionClient,
  locationPackage,
  ok,
  rosterPackage,
  templateVersionPackage,
} from '../test/fixtures';
import { freshDatabase, reopen } from '../test/database';
import type { OfflineDatabase } from './db';
import {
  isFieldReady,
  missingForField,
  prefetchInspection,
  storedLocations,
  storedRoster,
  storedTemplateVersion,
} from './prefetch';

const INSPECTION_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_2 = '22222222-2222-4222-8222-222222222222';
const VERSION_3 = '33333333-3333-4333-8333-333333333333';

let database: OfflineDatabase;

afterEach(() => {
  database?.close();
});

/**
 * El servidor completo: las tres piezas responden, y las tres se construyen desde el
 * contrato compartido. Si `apps/api` cambia una forma, este doble deja de compilar en
 * vez de seguir en verde con la forma vieja.
 */
function fullServer(version = 2, versionId = VERSION_2) {
  return fakeSessionClient({
    respond: (path) => {
      if (path.endsWith('/template-version')) {
        return ok(templateVersionPackage({ template_version_id: versionId, version }));
      }
      if (path.endsWith('/locations')) return ok(locationPackage());
      if (path.endsWith('/roster')) return ok(rosterPackage());

      return fail('inspection_not_found');
    },
  });
}

describe('prefetchInspection', () => {
  it('guarda las tres piezas y deja la inspección lista para el campo', async () => {
    database = freshDatabase();

    const result = await prefetchInspection(INSPECTION_ID, {
      database,
      client: fullServer(),
    });

    expect(result.stored).toEqual(['template_version', 'locations', 'roster']);
    expect(result.missing).toEqual([]);
    expect(await isFieldReady(INSPECTION_ID, database)).toBe(true);
    expect((await storedTemplateVersion(INSPECTION_ID, database))?.version).toBe(2);
    expect(await storedLocations(INSPECTION_ID, database)).toHaveLength(1);
    expect(await storedRoster(INSPECTION_ID, database)).toHaveLength(1);
  });

  /**
   * Spec: "A partial download does not report field-ready". Lo que falta se NOMBRA, y
   * se nombra con red todavía disponible: es el único momento en que se puede arreglar.
   */
  it('un roster que falla deja la inspección no lista y nombra qué falta', async () => {
    database = freshDatabase();

    const partial = fakeSessionClient({
      respond: (path) => {
        if (path.endsWith('/template-version')) {
          return ok(templateVersionPackage({ template_version_id: VERSION_2 }));
        }
        if (path.endsWith('/locations')) return ok(locationPackage());

        return fail('inspection_not_found', 'el roster no bajó');
      },
    });

    const result = await prefetchInspection(INSPECTION_ID, { database, client: partial });

    expect(result.missing).toEqual(['roster']);
    expect(result.errors.roster).toContain('el roster no bajó');
    expect(await isFieldReady(INSPECTION_ID, database)).toBe(false);

    // Y volver a correrla con red la completa, sin re-bajar lo que ya estaba.
    await prefetchInspection(INSPECTION_ID, { database, client: fullServer() });

    expect(await missingForField(INSPECTION_ID, database)).toEqual([]);
    expect(await isFieldReady(INSPECTION_ID, database)).toBe(true);
  });

  it('lo descargado sobrevive a cerrar y reabrir la aplicación', async () => {
    database = freshDatabase();
    await prefetchInspection(INSPECTION_ID, { database, client: fullServer() });

    database = await reopen(database);

    expect(await isFieldReady(INSPECTION_ID, database)).toBe(true);
  });

  /**
   * Spec: "The stored template version is the one the inspection is bound to".
   *
   * Publicar la versión 3 y reconectar NO cambia el documento local de una inspección
   * atada a la 2. El endpoint devuelve la congelada; el dispositivo la guarda tal cual
   * y no consulta "la última publicada" en ningún lado.
   */
  it('publicar una versión más alta no cambia el documento de una inspección atada a la 2', async () => {
    database = freshDatabase();
    await prefetchInspection(INSPECTION_ID, { database, client: fullServer(2, VERSION_2) });

    // Reconectar: el servidor sigue devolviendo la CONGELADA para esta inspección.
    await prefetchInspection(INSPECTION_ID, { database, client: fullServer(2, VERSION_2) });

    const stored = await storedTemplateVersion(INSPECTION_ID, database);
    expect(stored?.version).toBe(2);
    expect(stored?.template_version_id).toBe(VERSION_2);
    expect(stored?.template_version_id).not.toBe(VERSION_3);
  });
});
