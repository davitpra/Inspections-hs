import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import { findActiveInspection } from './active-inspection';

const INSPECTION_ID = '11111111-1111-4111-8111-111111111111';
const SITE_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';

/**
 * El doble devuelve lo que la política RLS haría devolver: las filas que la transacción
 * VE. Una inspección de la otra planta no es una fila filtrada por la consulta — es una
 * fila que la consulta no trae, y el doble modela exactamente eso.
 */
function clientReturning(rows: unknown[]) {
  const query = vi.fn(async () => ({ rows }));

  return { client: { query } as unknown as PoolClient, query };
}

describe('findActiveInspection', () => {
  it('devuelve la inspección visible con su planta y su versión congelada', async () => {
    const { client } = clientReturning([
      { id: INSPECTION_ID, site_id: SITE_ID, template_version_id: VERSION_ID },
    ]);

    expect(await findActiveInspection(client, INSPECTION_ID)).toEqual({
      id: INSPECTION_ID,
      site_id: SITE_ID,
      template_version_id: VERSION_ID,
    });
  });

  /** Fuera del alcance: la transacción no la ve y la consulta vuelve vacía. */
  it('devuelve null cuando la transacción no ve la inspección', async () => {
    const { client } = clientReturning([]);

    expect(await findActiveInspection(client, INSPECTION_ID)).toBeNull();
  });

  it('excluye las canceladas en la propia consulta', async () => {
    const { client, query } = clientReturning([]);

    await findActiveInspection(client, INSPECTION_ID);

    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).toContain('cancelled_at IS NULL');
  });

  /**
   * ADR-002 — el recorte por planta lo hace la política, no la consulta. Un `WHERE
   * site_id` acá sería una segunda copia de una regla que el motor ya aplica, y la copia
   * es la que envejece.
   */
  it('no lleva un WHERE site_id: el aislamiento es de la política RLS', async () => {
    const { client, query } = clientReturning([]);

    await findActiveInspection(client, INSPECTION_ID);

    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).not.toContain('site_id =');
    expect(params).toEqual([INSPECTION_ID]);
  });
});
