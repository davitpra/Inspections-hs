import { describe, expect, it } from 'vitest';

import { OfflineRoute } from '../routes/OfflineRoute';
import { router } from './router';

describe('router', () => {
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
