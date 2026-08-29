import { describe, expect, it } from 'vitest';

import { OfflineRoute } from '../routes/OfflineRoute';
import { router } from './router';

describe('router', () => {
  it('/recurrence no tiene ruta y conserva el fallback global', () => {
    expect('/recurrence' in router.routesByPath).toBe(false);
    expect(router.routeTree.options.notFoundComponent).toBe(OfflineRoute);
  });
});
