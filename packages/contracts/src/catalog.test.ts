import { describe, expect, it } from 'vitest';

import {
  createLocationSchema,
  createOrganizationLocationSchema,
  deactivateOrganizationLocationSchema,
  locationOptionSchema,
  locationSchema,
  siteSchema,
  updateLocationSchema,
} from './catalog.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const LOCATION_ID = '22222222-2222-4222-8222-222222222222';

/** Una ubicación válida. Cada test la deforma en un solo punto. */
function validLocation() {
  return {
    id: LOCATION_ID,
    site_id: SITE_ID,
    code: 'packaging-line-3',
    name: 'Packaging line 3',
    deactivated_at: null,
  };
}

describe('siteSchema', () => {
  it('acepta una planta', () => {
    const result = siteSchema.safeParse({
      id: SITE_ID,
      code: 'st-thomas',
      name: 'St. Thomas',
      deactivated_at: null,
    });

    expect(result.success).toBe(true);
  });

  it('rechaza un code con mayúsculas', () => {
    const result = siteSchema.safeParse({
      id: SITE_ID,
      code: 'St-Thomas',
      name: 'St. Thomas',
      deactivated_at: null,
    });

    expect(result.success).toBe(false);
  });
});

describe('locationSchema', () => {
  it('acepta una ubicación activa', () => {
    expect(locationSchema.safeParse(validLocation()).success).toBe(true);
  });

  it('acepta una ubicación dada de baja, con su fecha', () => {
    const result = locationSchema.safeParse({
      ...validLocation(),
      deactivated_at: '2026-08-07T14:30:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('rechaza un code con separadores al principio o al final', () => {
    expect(locationSchema.safeParse({ ...validLocation(), code: '-dock' }).success).toBe(false);
    expect(locationSchema.safeParse({ ...validLocation(), code: 'dock-' }).success).toBe(false);
  });

  it('rechaza un nombre vacío', () => {
    expect(locationSchema.safeParse({ ...validLocation(), name: '   ' }).success).toBe(false);
  });

  // El requisito central de la pregunta cerrada 1: la ubicación no es texto
  // libre. Si alguien agrega un campo suelto al contrato, `strictObject` lo
  // rechaza acá y no en la primera consulta de recurrencia.
  it('rechaza un campo de ubicación en texto libre', () => {
    const result = locationSchema.safeParse({
      ...validLocation(),
      location_text: 'somewhere near the back',
    });

    expect(result.success).toBe(false);
  });
});

describe('locationOptionSchema', () => {
  it('el desplegable incluye el mapeo conceptual además de id, code y nombre', () => {
    const result = locationOptionSchema.safeParse({
      id: LOCATION_ID,
      code: 'packaging-line-3',
      name: 'Packaging line 3',
    });

    expect(result.success).toBe(true);
    expect(Object.keys(locationOptionSchema.shape).sort()).toEqual([
      'code',
      'id',
      'name',
      'organization_location_code',
    ]);
  });
});

describe('createLocationSchema', () => {
  it('acepta code y nombre', () => {
    const result = createLocationSchema.safeParse({
      code: 'cold-storage',
      name: 'Cold storage',
    });

    expect(result.success).toBe(true);
  });

  // El sitio sale del alcance de la sesión. Si viniera en el payload, sería el
  // endpoint decidiendo el aislamiento, que es justo lo que ADR-004 no quiere.
  it('rechaza un site_id en el payload', () => {
    const result = createLocationSchema.safeParse({
      code: 'cold-storage',
      name: 'Cold storage',
      site_id: SITE_ID,
    });

    expect(result.success).toBe(false);
  });
});

describe('createOrganizationLocationSchema', () => {
  it('acepta code y nombre', () => {
    expect(
      createOrganizationLocationSchema.safeParse({ code: 'loading-dock', name: 'Loading dock' })
        .success,
    ).toBe(true);
  });

  // Una ubicación compartida no pertenece a ninguna planta: es el concepto del que cada
  // planta tiene su fila física. Un `site_id` acá sería la contradicción de la entidad.
  it('rechaza un site_id', () => {
    expect(
      createOrganizationLocationSchema.safeParse({
        code: 'loading-dock',
        name: 'Loading dock',
        site_id: SITE_ID,
      }).success,
    ).toBe(false);
  });

  it('rechaza un code que no respeta el patrón del catálogo', () => {
    expect(
      createOrganizationLocationSchema.safeParse({ code: 'Loading Dock', name: 'Loading dock' })
        .success,
    ).toBe(false);
  });

  it('rechaza un nombre en blancos', () => {
    expect(
      createOrganizationLocationSchema.safeParse({ code: 'loading-dock', name: '   ' }).success,
    ).toBe(false);
  });
});

describe('deactivateOrganizationLocationSchema', () => {
  it('acepta únicamente la baja', () => {
    expect(deactivateOrganizationLocationSchema.safeParse({ deactivated: true }).success).toBe(true);
  });

  it('rechaza la reactivación y campos adicionales', () => {
    expect(deactivateOrganizationLocationSchema.safeParse({ deactivated: false }).success).toBe(false);
    expect(
      deactivateOrganizationLocationSchema.safeParse({ deactivated: true, name: 'Other' }).success,
    ).toBe(false);
  });
});

describe('updateLocationSchema', () => {
  it('acepta un renombre', () => {
    expect(updateLocationSchema.safeParse({ name: 'Packaging line 3 (west)' }).success).toBe(true);
  });

  it('acepta una baja y una reactivación', () => {
    expect(updateLocationSchema.safeParse({ deactivated: true }).success).toBe(true);
    expect(updateLocationSchema.safeParse({ deactivated: false }).success).toBe(true);
  });

  it('rechaza un update vacío', () => {
    expect(updateLocationSchema.safeParse({}).success).toBe(false);
  });

  // Las dos columnas que el trigger `location_guard` rechaza venga de donde
  // venga. El contrato dice lo mismo que el motor.
  it('rechaza cambiar el code o el sitio', () => {
    expect(updateLocationSchema.safeParse({ code: 'otra-cosa' }).success).toBe(false);
    expect(updateLocationSchema.safeParse({ site_id: SITE_ID }).success).toBe(false);
  });
});
