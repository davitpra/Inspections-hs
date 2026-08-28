import { findingListSchema, type Finding } from '@hs/contracts';

import { get } from './request';

/** Los hallazgos visibles dentro del alcance de sitios de la sesión. */
export async function listFindings(): Promise<Finding[]> {
  return get('/findings', (value) => findingListSchema.parse(value));
}
