import { describe, expect, it } from 'vitest';

import { OfflineRoute } from '../routes/OfflineRoute';
import { router } from './router';

describe('router', () => {
  it('registra el índice y el detalle del historial', () => {
    expect('/historical' in router.routesByPath).toBe(true);
    expect('/historical/$templateId' in router.routesByPath).toBe(true);
  });

  it('separa el índice, el tipo y el envío individual de hallazgos', () => {
    expect('/findings' in router.routesByPath).toBe(true);
    expect('/findings/types/$templateId' in router.routesByPath).toBe(true);
    expect('/findings/$id' in router.routesByPath).toBe(true);
  });

  it('/recurrence no tiene ruta y conserva el fallback global', () => {
    expect('/recurrence' in router.routesByPath).toBe(false);
    expect(router.routeTree.options.notFoundComponent).toBe(OfflineRoute);
  });

  it('las rutas independientes de acciones caen al fallback global', () => {
    expect('/actions' in router.routesByPath).toBe(false);
    expect('/actions/inspection/$inspectionId' in router.routesByPath).toBe(false);
    expect('/actions/$id' in router.routesByPath).toBe(false);
    expect(router.routeTree.options.notFoundComponent).toBe(OfflineRoute);
  });
});
