import type { Location, PersonOption } from '@hs/contracts';

/** El texto que distingue una persona sin convertirla en un perfil. */
export function personLabel(person: PersonOption): string {
  return `${person.employee_number} \u2014 ${person.first_name} ${person.last_name}`;
}

/** Busca por legajo, nombre o nombre completo en cualquiera de los dos órdenes. */
export function matchPeople(
  options: readonly PersonOption[],
  query: string,
  limit = 20,
): PersonOption[] {
  const needle = query.trim().toLowerCase();

  if (needle === '') return [];

  return options
    .filter((person) => {
      const firstLast = `${person.first_name} ${person.last_name}`.toLowerCase();
      const lastFirst = `${person.last_name} ${person.first_name}`.toLowerCase();
      return [person.employee_number, person.first_name, person.last_name, firstLast, lastFirst]
        .some((value) => value.toLowerCase().includes(needle));
    })
    .slice(0, Math.max(0, limit));
}

/** Opciones de sujeto sin ofrecer a la persona que está reportando. */
export function subjectOptions(
  options: readonly PersonOption[],
  reporterPersonId: string,
): PersonOption[] {
  return options.filter((person) => person.id !== reporterPersonId);
}

/** Opciones de testigo sin repetir sujeto ni personas ya elegidas. */
export function witnessOptions(
  options: readonly PersonOption[],
  subjectId: string,
  chosenIds: readonly string[],
): PersonOption[] {
  return options.filter(
    (person) => person.id !== subjectId && !chosenIds.includes(person.id),
  );
}

/** Ubicaciones activas de la planta que está seleccionada en el formulario. */
export function locationsOfSite(locations: readonly Location[], siteId: string): Location[] {
  return locations.filter(
    (location) => location.site_id === siteId && location.deactivated_at === null,
  );
}
