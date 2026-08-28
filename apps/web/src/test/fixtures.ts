import type {
  LocationPackage,
  RosterPackage,
  TemplateVersionPackage,
} from '@hs/contracts';
import type { TemplateDocument } from '@hs/forms';

import type { AuthedResult, SessionClient } from '../auth/session-client';

/**
 * El documento con el que corre casi toda la suite: los nueve tipos de ítem y una
 * condición que oculta un ítem según una respuesta anterior.
 */
export const TEST_DOCUMENT: TemplateDocument = {
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
          fails_on: 'no',
        },
        {
          item_key: 'guarding.applies',
          prompt: 'Does guarding apply on this line?',
          position: 2,
          required: false,
          response_type: 'yes_no_na',
          fails_on: 'no',
        },
        {
          item_key: 'guarding.rating',
          prompt: 'Condition rating',
          position: 3,
          required: false,
          response_type: 'scale',
          min: 1,
          max: 5,
        },
        {
          item_key: 'guarding.gap',
          prompt: 'Largest gap in millimetres',
          position: 4,
          required: false,
          response_type: 'number',
          min: 0,
          max: 500,
          decimals: 1,
        },
        {
          item_key: 'guarding.photo',
          prompt: 'Photo of the guard',
          position: 5,
          required: false,
          response_type: 'photo',
          min_count: 0,
          max_count: 5,
        },
        {
          /** El ítem condicional: solo se muestra cuando el anterior dice que NO. */
          item_key: 'guarding.reason',
          prompt: 'Why is a guard missing?',
          position: 6,
          required: true,
          response_type: 'text',
          max_length: 500,
          visible_when: { item_key: 'guarding.installed', operator: 'equals', value: false },
        },
        {
          item_key: 'guarding.hazards',
          prompt: 'Hazards observed',
          position: 8,
          required: false,
          response_type: 'multi_choice',
          options: [
            { value: 'pinch', label: 'Pinch point' },
            { value: 'noise', label: 'Noise' },
          ],
          min_selected: 0,
          max_selected: 2,
        },
      ],
    },
    {
      section_key: 'closing',
      section_title: 'Closing',
      position: 2,
      items: [
        {
          item_key: 'closing.signature',
          prompt: 'Inspector signature',
          position: 1,
          required: true,
          response_type: 'signature',
        },
      ],
    },
  ],
};

export interface FakeCall {
  path: string;
  init: RequestInit;
}

export interface FakeClientOptions {
  /** Por path (o prefijo), qué responde. Devolver `null` significa error de red. */
  respond: (path: string, init: RequestInit) => AuthedResult<unknown> | null;
  freshSession?: boolean;
}

/**
 * Un doble de `SessionClient`. No es un mock de `fetch`: lo que el outbox consume es
 * el CONTRATO de `SessionClient` —`ok`/`code`/`message` y `ensureFreshSession()`— y
 * probar contra eso es lo que hace que la regla de "un 401 no descarta nada" se pueda
 * afirmar sin levantar un servidor.
 */
export function fakeSessionClient(options: FakeClientOptions): SessionClient & {
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];

  const client = {
    calls,
    async ensureFreshSession(): Promise<boolean> {
      return options.freshSession ?? true;
    },
    async request<T>(path: string, init: RequestInit = {}): Promise<AuthedResult<T>> {
      calls.push({ path, init });

      const response = options.respond(path, init);
      if (!response) throw new TypeError('Failed to fetch');

      return response as AuthedResult<T>;
    },
  };

  return client as unknown as SessionClient & { calls: FakeCall[] };
}

export function ok<T>(value: T): AuthedResult<T> {
  return { ok: true, value };
}

export function fail(code: string, message = 'nope'): AuthedResult<never> {
  return { ok: false, code, message } as AuthedResult<never>;
}

/**
 * Los dobles del paquete de campo, tipados contra el contrato de `@hs/contracts`.
 *
 * Tipados y no sueltos: si `apps/api` cambia la forma de una de las tres respuestas, el
 * doble deja de compilar. Un doble con la forma vieja seguiría pasando en verde mientras
 * el dispositivo real falla en la planta, que es exactamente el fallo que este contrato
 * compartido existe para hacer imposible.
 */
export function templateVersionPackage(
  overrides: Partial<TemplateVersionPackage> = {},
): TemplateVersionPackage {
  return {
    site_id: '66666666-6666-4666-8666-666666666666',
    template_version_id: '22222222-2222-4222-8222-222222222222',
    version: 2,
    template_name: 'Monthly workplace inspection',
    document: TEST_DOCUMENT,
    inspector_id: null,
    ...overrides,
  };
}

export function locationPackage(): LocationPackage {
  return [{ id: '44444444-4444-4444-8444-444444444444', code: 'line-3', name: 'Line 3' }];
}

export function rosterPackage(): RosterPackage {
  return [
    {
      id: '55555555-5555-4555-8555-555555555555',
      employee_number: 'E-1042',
      first_name: 'Dana',
      last_name: 'Okafor',
    },
  ];
}
