import { RESPONSE_TYPES, YES_NO_NA_FAILS_ON, type ResponseType, type YesNoNaFailsOn } from '@hs/contracts';

/**
 * Cómo se llama cada cosa de una plantilla en pantalla.
 *
 * `RESPONSE_TYPE_LABELS` es un `Record<ResponseType, string>` completo y no un mapa parcial
 * con fallback: `RESPONSE_TYPES` tiene nueve entradas y el día que sean diez, el que falte
 * rompe el typecheck acá en vez de aparecer como `photo_360` crudo en un `<select>`.
 *
 * Las etiquetas describen lo que el INSPECTOR va a ver, no el tipo de dato: quien escribe la
 * plantilla está eligiendo qué le va a pedir a alguien parado frente a una máquina, y "Yes /
 * No" dice eso mejor que "boolean".
 */
export const RESPONSE_TYPE_LABELS: Record<ResponseType, string> = {
  yes_no: 'Yes / No',
  yes_no_na: 'Yes / No / N/A',
  scale: 'Rating scale',
  text: 'Written answer',
  number: 'Number',
  single_choice: 'Choose one',
  multi_choice: 'Choose several',
  photo: 'Photos',
  signature: 'Signature',
};

/** Una línea sobre qué le pide al inspector cada tipo, para el selector. */
export const RESPONSE_TYPE_HINTS: Record<ResponseType, string> = {
  yes_no: 'A compliant or non-compliant answer — pick which one triggers a finding below.',
  yes_no_na: 'Adds "not applicable" — pick which answer, or pair of answers, triggers a finding below.',
  scale: 'A whole number between the bounds you set.',
  text: 'Free text up to a length you set.',
  number: 'A measurement, with bounds and decimal places.',
  single_choice: 'One option from a list you write.',
  multi_choice: 'Several options, within limits you set.',
  photo: 'One or more photographs.',
  signature: 'A signature captured on the device.',
};

/** Los nueve tipos en el orden en que el motor los declara, para poblar el selector. */
export const RESPONSE_TYPE_OPTIONS: readonly { value: ResponseType; label: string }[] =
  RESPONSE_TYPES.map((value) => ({ value, label: RESPONSE_TYPE_LABELS[value] }));

/**
 * Cómo se lee cada modo de fallo de `yes_no_na`, tanto en el selector del editor como en
 * la vista de solo lectura de la plantilla publicada.
 *
 * "No" y "Yes" son los mismos dos que ofrece `yes_no`; los tres restantes son lo que
 * `yes_no_na` agrega — que "not applicable" también pueda ser, sola o acompañada, la
 * respuesta que amerita revisión.
 */
export const YES_NO_NA_FAILS_ON_LABELS: Record<YesNoNaFailsOn, string> = {
  no: 'No',
  yes: 'Yes',
  no_na: 'No or N/A',
  na: 'N/A only',
  yes_na: 'Yes or N/A',
};

export const YES_NO_NA_FAILS_ON_OPTIONS: readonly { value: YesNoNaFailsOn; label: string }[] =
  YES_NO_NA_FAILS_ON.map((value) => ({ value, label: YES_NO_NA_FAILS_ON_LABELS[value] }));

/** Los dos modos de fallo de `yes_no`, en el selector de Answer settings y en el del sheet. */
export const YES_NO_FAILS_ON_OPTIONS: readonly { value: 'yes' | 'no'; label: string }[] = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
];

/**
 * Lo que dice un borrador sobre sí mismo en el listado.
 *
 * "Ready to publish" y no "Valid": lo que el autor quiere saber no es si el documento pasa
 * un esquema, es si ya se puede usar. Y no hay estado intermedio a propósito — un borrador
 * está listo o le falta algo, y qué le falta se lee adentro.
 */
export function draftStatusLabel(publishable: boolean): string {
  return publishable ? 'Ready to publish' : 'Not ready yet';
}

/** `--ready` / `--not-ready` ya existen en `index.css`; no hace falta una clase nueva. */
export function draftStatusClass(publishable: boolean): string {
  return publishable ? 'status-pill status-pill--ready' : 'status-pill status-pill--not-ready';
}

/**
 * Cuántas preguntas tiene una plantilla, dicho en palabras.
 *
 * Existe porque "0 items" es la respuesta más frecuente al principio y la que más conviene
 * que se lea como una invitación y no como un error.
 */
export function itemCountLabel(count: number): string {
  if (count === 0) return 'No questions yet';
  return count === 1 ? '1 question' : `${count} questions`;
}
