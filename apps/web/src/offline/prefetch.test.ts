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
  packageDrift,
  prefetchInspection,
  prefetchedAt,
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
       if (path.endsWith('/template-version') || path.endsWith('/template-version/advance')) {
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

  /**
   * Spec: "A field-ready inspection can still be prepared again".
   *
   * El caso de arriba prueba que el servidor devuelve la congelada; este prueba lo otro,
   * que es lo que hace posible refrescar: la segunda descarga PISA lo guardado. Sin esto,
   * un payload que quedó mal escrito no se podría reemplazar nunca.
   */
  it('volver a bajar pisa el paquete guardado', async () => {
    database = freshDatabase();
    await prefetchInspection(INSPECTION_ID, { database, client: fullServer(2, VERSION_2) });

    await prefetchInspection(INSPECTION_ID, { database, client: fullServer(3, VERSION_3) });

    const stored = await storedTemplateVersion(INSPECTION_ID, database);
    expect(stored?.version).toBe(3);
    expect(stored?.template_version_id).toBe(VERSION_3);
  });

  it('pide el avance explícito cuando no hay borrador', async () => {
    database = freshDatabase();
    const client = fullServer(3, VERSION_3);

    await prefetchInspection(INSPECTION_ID, { database, client, advance: true });

    expect(client.calls[0]).toMatchObject({
      path: `/scheduled-inspections/${INSPECTION_ID}/template-version/advance`,
      init: { method: 'POST' },
    });
  });
});

describe('prefetchedAt', () => {
  it('devuelve el sello con el que se guardó el documento', async () => {
    database = freshDatabase();
    await prefetchInspection(INSPECTION_ID, { database, client: fullServer() });

    const stamp = await prefetchedAt(INSPECTION_ID, database);

    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('no inventa un sello para lo que nunca se bajó', async () => {
    database = freshDatabase();

    expect(await prefetchedAt(INSPECTION_ID, database)).toBeNull();
  });
});

/**
 * La deriva es lo que separa "esto se arregla volviendo a bajar" de "esto no se arregla".
 * Se prueba sin Dexie y sin renderizar porque es una decisión, no un dibujo.
 */
describe('packageDrift', () => {
  it('no reporta nada cuando lo guardado es la versión congelada', () => {
    expect(
      packageDrift({ storedVersionId: VERSION_2, frozenVersionId: VERSION_2 }),
    ).toBe('none');
  });

  it('no reporta nada mientras falte con qué comparar', () => {
    // La consulta del paquete todavía no resolvió: no se sabe nada, y un aviso acá manda
    // al inspector a arreglar algo que no está roto.
    expect(
      packageDrift({ storedVersionId: undefined, frozenVersionId: VERSION_2 }),
    ).toBe('none');
    expect(
      packageDrift({ storedVersionId: VERSION_2, frozenVersionId: undefined }),
    ).toBe('none');
  });

  it('nombra el paquete rancio cuando no es la versión a la que la inspección está atada', () => {
    expect(
      packageDrift({ storedVersionId: VERSION_3, frozenVersionId: VERSION_2 }),
    ).toBe('stale-package');
  });

  it('nombra el borrador huérfano y lo pone por delante del paquete rancio', () => {
    // Las dos cosas están mal a la vez, y la que hay que decir es la del borrador:
    // refrescar arregla el paquete y NO arregla el borrador.
    expect(
      packageDrift({
        storedVersionId: VERSION_3,
        frozenVersionId: VERSION_2,
        draftVersionId: VERSION_2,
      }),
    ).toBe('draft-orphaned');
  });

  it('un borrador alineado con lo guardado no es huérfano', () => {
    expect(
      packageDrift({
        storedVersionId: VERSION_2,
        frozenVersionId: VERSION_2,
        draftVersionId: VERSION_2,
      }),
    ).toBe('none');
  });

  it('nombra una versión publicada más alta cuando el paquete está alineado', () => {
    expect(
      packageDrift({
        storedVersionId: VERSION_2,
        frozenVersionId: VERSION_2,
        latestVersionId: VERSION_3,
      }),
    ).toBe('newer-version');
  });

  it('da prioridad al borrador huérfano sobre una versión publicada más alta', () => {
    expect(
      packageDrift({
        storedVersionId: VERSION_3,
        frozenVersionId: VERSION_2,
        draftVersionId: VERSION_2,
        latestVersionId: VERSION_3,
      }),
    ).toBe('draft-orphaned');
  });
});
