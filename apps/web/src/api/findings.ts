import { findingListSchema, personOptionSchema, type Finding, type PersonOption } from '@hs/contracts';
import { z } from 'zod';

import { get } from './request';

/** Los hallazgos visibles dentro del alcance de sitios de la sesión. */
export async function listFindings(): Promise<Finding[]> {
  return get('/findings', (value) => findingListSchema.parse(value));
}

/**
 * El subconjunto activo del roster de la planta de este hallazgo (ADR-017).
 *
 * Mismo criterio que el paquete de campo: cuatro columnas y ni una más, §4 dice que se
 * elige a una persona sin poder ver su perfil. Sirve al formulario de creación de una
 * acción para CUALQUIER rol que lo abra, no solo para el coordinador.
 */
export async function listFindingRoster(findingId: string): Promise<PersonOption[]> {
  return get(`/findings/${findingId}/roster`, (value) =>
    z.array(personOptionSchema).parse(value),
  );
}
