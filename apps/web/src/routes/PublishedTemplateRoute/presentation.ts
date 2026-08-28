import {
  CONDITION_OPERATORS,
  type Condition,
  type ConditionOperator,
  type Location,
  type Site,
  type TemplateDocument,
  type TemplateItem,
  type TemplateSection,
  type VisibleWhen,
} from '@hs/contracts';
import {
  FAILURE_OPERATORS,
  sectionsInDocumentOrder,
  type FailureOperator,
} from '@hs/forms';

import { RESPONSE_TYPE_LABELS, YES_NO_NA_FAILS_ON_LABELS } from '../../presentation/templates';

/** La lógica pura para leer un documento publicado sin convertirlo en un formulario. */

export function totalItems(document: TemplateDocument): number {
  return document.sections.reduce((count, section) => count + section.items.length, 0);
}

const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: 'is',
  not_equals: 'is not',
  in: 'is one of',
  gte: 'is at least',
  lte: 'is at most',
  answered: 'has an answer',
  unanswered: 'has no answer',
};

const FAILURE_OPERATOR_LABELS: Record<FailureOperator, string> = {
  lt: 'Fails below',
  lte: 'Fails at or below',
  gt: 'Fails above',
  gte: 'Fails at or above',
};

function conditionValue(value: boolean | number | string | readonly (boolean | number | string)[]): string {
  if (Array.isArray(value)) return value.map(conditionValue).join(', ');
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

function conditionSubject(itemKey: string, document: TemplateDocument): string {
  const item = sectionsInDocumentOrder(document)
    .flatMap(([, items]) => items)
    .find((candidate) => candidate.item_key === itemKey);

  return item?.prompt ?? itemKey;
}

function conditionText(condition: Condition, document: TemplateDocument): string {
  const subject = conditionSubject(condition.item_key, document);
  const operator = CONDITION_OPERATOR_LABELS[condition.operator];

  if (condition.operator === 'answered' || condition.operator === 'unanswered') {
    return `${subject} ${operator}`;
  }

  return `${subject} ${operator} ${conditionValue(condition.value)}`;
}

/** Traduce una condición a palabras, con el item_key como fallback total. */
export function visibilityLabel(
  visibleWhen: VisibleWhen,
  document: TemplateDocument,
): string {
  if ('all_of' in visibleWhen) {
    return `Shown when ${visibleWhen.all_of
      .map((condition) => conditionText(condition, document))
      .join(' and ')}`;
  }

  if ('any_of' in visibleWhen) {
    return `Shown when ${visibleWhen.any_of
      .map((condition) => conditionText(condition, document))
      .join(' or ')}`;
  }

  return `Shown when ${conditionText(visibleWhen, document)}`;
}

/** Las líneas concretas de configuración que declara cada tipo de respuesta. */
export function responseConfiguration(item: TemplateItem): string[] {
  switch (item.response_type) {
    case 'yes_no':
      return [`Fails on: ${item.fails_on === 'yes' ? 'Yes' : 'No'}`];
    case 'yes_no_na':
      return [`Fails on: ${YES_NO_NA_FAILS_ON_LABELS[item.fails_on]}`];
    case 'signature':
      return ['No additional settings'];
    case 'scale':
      return [`Range: ${item.min} to ${item.max}`];
    case 'text':
      return [`Maximum length: ${item.max_length} characters`];
    case 'number':
      return [`Range: ${item.min} to ${item.max}`, `Decimal places: ${item.decimals}`];
    case 'single_choice':
      return [`Options: ${item.options.map(choiceLabel).join(', ')}`];
    case 'multi_choice':
      return [
        `Options: ${item.options.map(choiceLabel).join(', ')}`,
        `Selections: ${item.min_selected} to ${item.max_selected}`,
      ];
    case 'photo':
      return [`Photos: ${item.min_count} to ${item.max_count}`];
  }
}

function choiceLabel(option: { label: string; value: string }): string {
  return `${option.label} (${option.value})`;
}

/** La prescripción de fallo, sin decidir ni evaluar si una respuesta falla. */
export function findingConfiguration(item: TemplateItem): string[] {
  if (!item.finding) return [];

  return [
    `Corrective action: ${item.finding.corrective_action}`,
    ...(item.finding.fails_when ? [failureThresholdLabel(item.finding.fails_when)] : []),
  ];
}

export function failureThresholdLabel(threshold: {
  operator: FailureOperator;
  value: number;
}): string {
  return `${FAILURE_OPERATOR_LABELS[threshold.operator]} ${threshold.value}`;
}

export function responseTypeLabel(item: TemplateItem): string {
  return RESPONSE_TYPE_LABELS[item.response_type];
}

/** Las plantas donde una ubicación compartida tiene fila física mapeada. */
function locationCoverage(
  code: string | undefined,
  locations: readonly Location[],
  siteIds: readonly string[],
): string[] {
  return siteIds.filter((siteId) =>
    locations.some(
      (location) =>
        location.site_id === siteId &&
        location.organization_location_code === code &&
        location.deactivated_at === null,
    ),
  );
}

function scopeLabel(siteIds: readonly string[], sites: readonly Site[]): string {
  const named = sites.filter((site) => siteIds.includes(site.id));

  if (named.length === 0) return 'No plants';
  if (named.length === sites.length) return sites.length > 1 ? 'Both plants' : named[0]!.name;
  if (named.length === 1) return `${named[0]!.name} only`;

  return named.map((site) => site.name).join(', ');
}

/** Dónde resuelve la ubicación compartida de una sección, para el lector del documento. */
export function sectionAppliesTo(
  section: TemplateSection,
  locations: readonly Location[],
  siteIds: readonly string[],
  sites: readonly Site[],
): string {
  const code = section.organization_location_code;

  if (!code) return 'No location assigned';

  const covered = locationCoverage(code, locations, siteIds);

  return covered.length === 0 ? 'No plant has this location' : scopeLabel(covered, sites);
}

export { CONDITION_OPERATORS, FAILURE_OPERATORS };
