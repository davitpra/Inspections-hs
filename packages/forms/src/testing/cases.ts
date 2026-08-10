import type { ViolationCode } from '../document/validate.js';

/**
 * La tabla de casos que corre en los dos entornos.
 *
 * ADR-007 exige que el dispositivo sin señal y el servidor que recibe el envío
 * lleguen al mismo veredicto. "Importan el mismo paquete" hace que sea probable;
 * esta tabla es lo que lo prueba: los tests unitarios de `packages/forms` la
 * recorren, y la suite de integración de `apps/api` recorre **esta misma tabla**
 * importada del build. Un desacuerdo rompe CI.
 *
 * Son datos, no tests: sin `describe` ni `it`. Si vivieran dentro de un archivo
 * de test, el servidor no podría ejecutarlos y la garantía volvería a ser una
 * afirmación.
 *
 * Se expone por el subpath `@hs/forms/testing` y no por el índice: no tiene por
 * qué viajar dentro del bundle del service worker.
 */

export interface ExpectedViolation {
  readonly item_key: string;
  readonly code: ViolationCode;
}

export interface EngineCase {
  readonly name: string;
  /** Se parsea con `templateDocumentSchema`: cada caso también ejercita el esquema. */
  readonly document: unknown;
  readonly answers: Readonly<Record<string, unknown>>;
  /** Violaciones esperadas, en cualquier orden. Vacío significa que el envío pasa. */
  readonly expected: readonly ExpectedViolation[];
  /** Visibilidad esperada, para los casos de lógica condicional. */
  readonly expected_visibility?: Readonly<Record<string, boolean>>;
  /**
   * Las `item_key` que derivan hallazgo, en orden de documento.
   *
   * Está en la tabla compartida y no solo en un test del paquete porque el
   * dispositivo pide los detalles del hallazgo y el servidor los exige: que los
   * dos deriven exactamente el mismo conjunto es la garantía de ADR-007 aplicada
   * a la etapa 4, y se prueba del mismo modo que la de las violaciones.
   */
  readonly expected_negative?: readonly string[];
}

/** Un documento de una sección con los ítems que se le pasen. */
function doc(items: Record<string, unknown>[], sectionExtras: Record<string, unknown> = {}): unknown {
  return {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        ...sectionExtras,
        items: items.map((item, index) => ({ position: index + 1, ...item })),
      },
    ],
  };
}

const yesNo = {
  item_key: 'guards.present',
  prompt: 'Machine guards present?',
  required: true,
  response_type: 'yes_no',
};

const yesNoNa = {
  item_key: 'eyewash.tested',
  prompt: 'Eyewash station flushed?',
  required: true,
  response_type: 'yes_no_na',
};

const scale = {
  item_key: 'housekeeping.score',
  prompt: 'Housekeeping score',
  required: true,
  response_type: 'scale',
  min: 1,
  max: 5,
};

const text = {
  item_key: 'notes.general',
  prompt: 'Notes',
  required: false,
  response_type: 'text',
  max_length: 20,
};

const numberItem = {
  item_key: 'temperature.reading',
  prompt: 'Cooler temperature',
  required: true,
  response_type: 'number',
  min: -10,
  max: 40,
  decimals: 1,
};

const singleChoice = {
  item_key: 'floor.condition',
  prompt: 'Floor condition',
  required: true,
  response_type: 'single_choice',
  options: [
    { value: 'dry', label: 'Dry' },
    { value: 'wet', label: 'Wet' },
  ],
};

const multiChoice = {
  item_key: 'ppe.worn',
  prompt: 'PPE worn',
  required: true,
  response_type: 'multi_choice',
  options: [
    { value: 'gloves', label: 'Gloves' },
    { value: 'goggles', label: 'Goggles' },
    { value: 'boots', label: 'Boots' },
  ],
  min_selected: 1,
  max_selected: 2,
};

const photo = {
  item_key: 'evidence.photos',
  prompt: 'Photos',
  required: true,
  response_type: 'photo',
  min_count: 1,
  max_count: 2,
};

const signature = {
  item_key: 'closeout.signature',
  prompt: 'Inspector signature',
  required: true,
  response_type: 'signature',
};

/** El par condicional: `hazard.followup` solo se muestra si hay peligro. */
const hazardPresent = {
  item_key: 'hazard.present',
  prompt: 'Any hazard observed?',
  required: true,
  response_type: 'yes_no',
};

const hazardFollowup = {
  item_key: 'hazard.followup',
  prompt: 'Describe the hazard',
  required: true,
  response_type: 'text',
  max_length: 500,
  visible_when: { item_key: 'hazard.present', operator: 'equals', value: true },
};

const VALID_SIGNATURE = { object_key: 'inspections/sig.png', signed_at: '2026-08-08T14:00:00.000Z' };

export const ENGINE_CASES: readonly EngineCase[] = [
  // — Un caso válido por tipo de ítem —
  { name: 'yes_no válido', document: doc([yesNo]), answers: { 'guards.present': false }, expected: [] },
  { name: 'yes_no_na acepta na', document: doc([yesNoNa]), answers: { 'eyewash.tested': 'na' }, expected: [] },
  { name: 'scale válido', document: doc([scale]), answers: { 'housekeeping.score': 3 }, expected: [] },
  {
    name: 'text válido',
    document: doc([{ ...text, required: true }]),
    answers: { 'notes.general': 'Aisle 4 blocked' },
    expected: [],
  },
  {
    name: 'number válido con un decimal',
    document: doc([numberItem]),
    answers: { 'temperature.reading': 3.5 },
    expected: [],
  },
  {
    name: 'single_choice válido',
    document: doc([singleChoice]),
    answers: { 'floor.condition': 'wet' },
    expected: [],
  },
  {
    name: 'multi_choice válido',
    document: doc([multiChoice]),
    answers: { 'ppe.worn': ['gloves', 'boots'] },
    expected: [],
  },
  {
    name: 'photo válido: object keys, no blobs',
    document: doc([photo]),
    answers: { 'evidence.photos': ['inspections/a.jpg'] },
    expected: [],
  },
  {
    name: 'signature válida',
    document: doc([signature]),
    answers: { 'closeout.signature': VALID_SIGNATURE },
    expected: [],
  },
  {
    name: 'opcional visible sin contestar',
    document: doc([text]),
    answers: {},
    expected: [],
  },

  // — Un caso por código de violación —
  {
    name: 'required_missing',
    document: doc([yesNo]),
    answers: {},
    expected: [{ item_key: 'guards.present', code: 'required_missing' }],
  },
  {
    name: 'wrong_shape: yes_no contestado con string',
    document: doc([yesNo]),
    answers: { 'guards.present': 'yes' },
    expected: [{ item_key: 'guards.present', code: 'wrong_shape' }],
  },
  {
    name: 'out_of_range: scale fuera del rango',
    document: doc([scale]),
    answers: { 'housekeeping.score': 7 },
    expected: [{ item_key: 'housekeeping.score', code: 'out_of_range' }],
  },
  {
    name: 'too_many_decimals',
    document: doc([numberItem]),
    answers: { 'temperature.reading': 3.456 },
    expected: [{ item_key: 'temperature.reading', code: 'too_many_decimals' }],
  },
  {
    name: 'too_long',
    document: doc([{ ...text, required: true }]),
    answers: { 'notes.general': 'x'.repeat(21) },
    expected: [{ item_key: 'notes.general', code: 'too_long' }],
  },
  {
    name: 'unknown_option',
    document: doc([singleChoice]),
    answers: { 'floor.condition': 'flooded' },
    expected: [{ item_key: 'floor.condition', code: 'unknown_option' }],
  },
  {
    name: 'duplicate_option',
    document: doc([multiChoice]),
    answers: { 'ppe.worn': ['gloves', 'gloves'] },
    expected: [{ item_key: 'ppe.worn', code: 'duplicate_option' }],
  },
  {
    name: 'selection_count_out_of_range',
    document: doc([multiChoice]),
    answers: { 'ppe.worn': ['gloves', 'goggles', 'boots'] },
    expected: [{ item_key: 'ppe.worn', code: 'selection_count_out_of_range' }],
  },
  {
    name: 'photo_count_out_of_range',
    document: doc([photo]),
    answers: { 'evidence.photos': ['a.jpg', 'b.jpg', 'c.jpg'] },
    expected: [{ item_key: 'evidence.photos', code: 'photo_count_out_of_range' }],
  },
  {
    name: 'unknown_item',
    document: doc([yesNo]),
    answers: { 'guards.present': true, 'lockout.tags-present': true },
    expected: [{ item_key: 'lockout.tags-present', code: 'unknown_item' }],
  },
  {
    name: 'answer_for_hidden_item',
    document: doc([hazardPresent, hazardFollowup]),
    answers: { 'hazard.present': false, 'hazard.followup': 'Spill near line 3' },
    expected: [{ item_key: 'hazard.followup', code: 'answer_for_hidden_item' }],
    expected_visibility: { 'hazard.present': true, 'hazard.followup': false },
  },

  // — Lógica condicional —
  {
    name: 'condicional: el ítem se muestra y su requerido se exige',
    document: doc([hazardPresent, hazardFollowup]),
    answers: { 'hazard.present': true },
    expected: [{ item_key: 'hazard.followup', code: 'required_missing' }],
    expected_visibility: { 'hazard.present': true, 'hazard.followup': true },
  },
  {
    name: 'condicional: el ítem oculto no se exige',
    document: doc([hazardPresent, hazardFollowup]),
    answers: { 'hazard.present': false },
    expected: [],
    expected_visibility: { 'hazard.present': true, 'hazard.followup': false },
  },
  {
    name: 'condicional: sección oculta arrastra a sus ítems',
    document: {
      sections: [
        {
          section_key: 'general',
          section_title: 'General',
          position: 1,
          items: [{ ...hazardPresent, position: 1 }],
        },
        {
          section_key: 'followup',
          section_title: 'Follow-up',
          position: 2,
          visible_when: { item_key: 'hazard.present', operator: 'equals', value: true },
          items: [
            {
              item_key: 'followup.owner',
              prompt: 'Who owns the follow-up?',
              position: 1,
              required: true,
              response_type: 'text',
              max_length: 120,
            },
          ],
        },
      ],
    },
    answers: { 'hazard.present': false },
    expected: [],
    expected_visibility: { 'hazard.present': true, 'followup.owner': false },
  },
  {
    name: 'condicional: any_of con un operador numérico',
    document: doc([
      scale,
      {
        item_key: 'housekeeping.followup',
        prompt: 'What needs attention?',
        required: true,
        response_type: 'text',
        max_length: 200,
        visible_when: {
          any_of: [
            { item_key: 'housekeeping.score', operator: 'lte', value: 2 },
            { item_key: 'housekeeping.score', operator: 'gte', value: 5 },
          ],
        },
      },
    ]),
    answers: { 'housekeeping.score': 2 },
    expected: [{ item_key: 'housekeeping.followup', code: 'required_missing' }],
    expected_visibility: { 'housekeeping.score': true, 'housekeeping.followup': true },
  },

  // — Un envío completo, del tipo que llega de un recorrido real —
  {
    name: 'envío completo válido',
    document: doc([yesNo, scale, multiChoice, photo, signature]),
    answers: {
      'guards.present': true,
      'housekeeping.score': 4,
      'ppe.worn': ['gloves'],
      'evidence.photos': ['inspections/a.jpg', 'inspections/b.jpg'],
      'closeout.signature': VALID_SIGNATURE,
    },
    expected: [],
  },
  {
    name: 'envío con tres violaciones a la vez',
    document: doc([yesNo, scale, multiChoice]),
    answers: {
      'guards.present': 'yes',
      'housekeeping.score': 9,
      'ppe.worn': ['gloves', 'goggles', 'boots'],
    },
    expected: [
      { item_key: 'guards.present', code: 'wrong_shape' },
      { item_key: 'housekeeping.score', code: 'out_of_range' },
      { item_key: 'ppe.worn', code: 'selection_count_out_of_range' },
    ],
  },

  // — Qué respuesta deriva hallazgo (requisitos §3 R2, etapa 4) —
  {
    name: 'negativo: yes_no en false deriva hallazgo',
    document: doc([yesNo]),
    answers: { 'guards.present': false },
    expected: [],
    expected_negative: ['guards.present'],
  },
  {
    name: 'negativo: yes_no en true no deriva',
    document: doc([yesNo]),
    answers: { 'guards.present': true },
    expected: [],
    expected_negative: [],
  },
  {
    name: 'negativo: yes_no_na en no deriva hallazgo',
    document: doc([yesNoNa]),
    answers: { 'eyewash.tested': 'no' },
    expected: [],
    expected_negative: ['eyewash.tested'],
  },
  {
    name: 'negativo: na no es un incumplimiento',
    document: doc([yesNoNa]),
    answers: { 'eyewash.tested': 'na' },
    expected: [],
    expected_negative: [],
  },
  {
    name: 'negativo: ningún otro tipo de respuesta deriva',
    document: doc([scale, numberItem, singleChoice, multiChoice, photo, signature]),
    answers: {
      'housekeeping.score': 1,
      'temperature.reading': -10,
      'floor.condition': 'wet',
      'ppe.worn': ['gloves'],
      'evidence.photos': ['inspections/a.jpg'],
      'closeout.signature': VALID_SIGNATURE,
    },
    expected: [],
    expected_negative: [],
  },
  {
    name: 'negativo: un ítem oculto no deriva aunque traiga respuesta',
    document: doc([
      hazardPresent,
      {
        item_key: 'hazard.followup',
        prompt: 'Was the hazard contained?',
        required: true,
        response_type: 'yes_no',
        visible_when: { item_key: 'hazard.present', operator: 'equals', value: true },
      },
    ]),
    answers: { 'hazard.present': false, 'hazard.followup': false },
    expected: [{ item_key: 'hazard.followup', code: 'answer_for_hidden_item' }],
    expected_visibility: { 'hazard.followup': false },
    expected_negative: ['hazard.present'],
  },
  {
    name: 'negativo: varios, en orden de documento',
    document: doc([yesNo, yesNoNa, scale]),
    answers: { 'guards.present': false, 'eyewash.tested': 'no', 'housekeeping.score': 2 },
    expected: [],
    expected_negative: ['guards.present', 'eyewash.tested'],
  },
];
