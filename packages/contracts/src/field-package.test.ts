import { describe, expect, it } from 'vitest';

import {
  locationPackageSchema,
  rosterPackageSchema,
  templateVersionPackageSchema,
} from './field-package.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const PERSON_ID = '44444444-4444-4444-8444-444444444444';

function validDocument() {
  return {
    sections: [
      {
        section_key: 'guarding',
        section_title: 'Machine guarding',
        position: 1,
        items: [
          {
            item_key: 'guarding.installed',
            prompt: 'Are all guards installed?',
            position: 1,
            required: true,
            response_type: 'yes_no',
          },
        ],
      },
    ],
  };
}

function validTemplateVersion() {
  return {
    site_id: SITE_ID,
    template_version_id: VERSION_ID,
    version: 2,
    document: validDocument(),
  };
}

describe('templateVersionPackageSchema', () => {
  it('acepta la versión congelada con su documento', () => {
    expect(templateVersionPackageSchema.safeParse(validTemplateVersion()).success).toBe(true);
  });

  /**
   * El documento es la entrada del motor de formularios: si no parsea acá, el
   * dispositivo no lo puede renderizar y el servidor no lo puede re-validar. Falla en el
   * borde y no en la planta.
   */
  it('rechaza un documento que no parsea como TemplateDocument', () => {
    const result = templateVersionPackageSchema.safeParse({
      ...validTemplateVersion(),
      document: { sections: [] },
    });

    expect(result.success).toBe(false);
  });

  it('rechaza un documento con un ítem de un response_type inexistente', () => {
    const document = validDocument();
    document.sections[0]!.items[0]!.response_type = 'freeform';

    const result = templateVersionPackageSchema.safeParse({
      ...validTemplateVersion(),
      document,
    });

    expect(result.success).toBe(false);
  });

  it('rechaza una version que no es un entero positivo', () => {
    for (const version of [0, -1, 1.5]) {
      expect(
        templateVersionPackageSchema.safeParse({ ...validTemplateVersion(), version }).success,
      ).toBe(false);
    }
  });

  /** Sin `site_id` el dispositivo no sabe de qué planta es el borrador que va a crear. */
  it('rechaza una respuesta sin site_id', () => {
    const { site_id: _omitted, ...withoutSite } = validTemplateVersion();

    expect(templateVersionPackageSchema.safeParse(withoutSite).success).toBe(false);
  });
});

describe('locationPackageSchema', () => {
  it('acepta la lista de opciones del catálogo', () => {
    const result = locationPackageSchema.safeParse([
      { id: LOCATION_ID, code: 'packaging-line-3', name: 'Packaging line 3' },
    ]);

    expect(result.success).toBe(true);
  });

  /**
   * Una lista vacía es una respuesta válida: una planta puede no tener ubicaciones
   * activas todavía, y eso no es un error de la ruta.
   */
  it('acepta una lista vacía', () => {
    expect(locationPackageSchema.safeParse([]).success).toBe(true);
  });

  it('rechaza una ubicación con deactivated_at: solo se sirven las activas', () => {
    const result = locationPackageSchema.safeParse([
      { id: LOCATION_ID, code: 'line-3', name: 'Line 3', deactivated_at: null },
    ]);

    expect(result.success).toBe(false);
  });
});

describe('rosterPackageSchema', () => {
  it('acepta las opciones de persona', () => {
    const result = rosterPackageSchema.safeParse([
      { id: PERSON_ID, employee_number: 'E-1042', first_name: 'Dana', last_name: 'Okafor' },
    ]);

    expect(result.success).toBe(true);
  });

  /**
   * §4 — el operador elige a una persona **sin poder ver su perfil**. Un campo de más no
   * es un extra, es una filtración, y el contrato es donde se corta.
   */
  it('rechaza una entrada con un campo de más', () => {
    const result = rosterPackageSchema.safeParse([
      {
        id: PERSON_ID,
        employee_number: 'E-1042',
        first_name: 'Dana',
        last_name: 'Okafor',
        job_title: 'Millwright',
      },
    ]);

    expect(result.success).toBe(false);
  });

  it('rechaza una entrada sin employee_number: el nombre no identifica', () => {
    const result = rosterPackageSchema.safeParse([
      { id: PERSON_ID, first_name: 'Dana', last_name: 'Okafor' },
    ]);

    expect(result.success).toBe(false);
  });
});
