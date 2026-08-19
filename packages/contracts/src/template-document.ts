/**
 * El documento de una versión de plantilla ya no se define acá.
 *
 * ADR-007 separa los dos paquetes por lo que significan: `@hs/contracts` son los
 * contratos de request/response, y el documento de plantilla no es una respuesta
 * de un endpoint — es la **entrada del motor de formularios**. Vive en
 * `@hs/forms`, que es lo que viaja dentro del bundle del service worker.
 *
 * Este archivo queda como re-export para que `apps/api` (esquema Drizzle, seeds,
 * suite de integración) siga importando de `@hs/contracts` sin cambios.
 *
 * Se re-exporta la **forma del documento**, no el motor: `validateAnswers` y
 * `evaluateVisibility` se importan de `@hs/forms` directamente. Un contrato de
 * request/response no es el lugar donde buscar la lógica de validación.
 *
 * El borrador es la excepción medida a esa última frase. `normalizeDraft` y
 * `draftIssues` sí se re-exportan porque el borrador **es** el cuerpo de un
 * request y de una respuesta —`PUT /templates/drafts/:id` lo recibe, `GET` lo
 * devuelve con sus issues—, y el servicio que lo atiende necesita las dos para
 * armar la respuesta. Siguen siendo funciones puras de `@hs/forms`; lo único que
 * cambia es desde dónde se las nombra.
 */
export {
  CONDITION_OPERATORS,
  ITEM_KEY_PATTERN,
  RESPONSE_TYPES,
  SECTION_KEY_PATTERN,
  choiceOptionSchema,
  conditionSchema,
  defaultItemConfig,
  draftIssues,
  emptyDraftDocument,
  normalizeDraft,
  responseTypeSchema,
  templateDocumentSchema,
  templateDraftDocumentSchema,
  templateDraftItemSchema,
  templateDraftSectionSchema,
  templateItemSchema,
  templateSectionSchema,
  visibleWhenSchema,
  type ChoiceOption,
  type Condition,
  type ConditionOperator,
  type DraftIssue,
  type ResponseType,
  type TemplateDocument,
  type TemplateDraftDocument,
  type TemplateDraftItem,
  type TemplateDraftItemOf,
  type TemplateDraftSection,
  type TemplateItem,
  type TemplateItemOf,
  type TemplateSection,
  type VisibleWhen,
} from '@hs/forms';
