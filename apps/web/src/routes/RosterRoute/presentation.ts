import type { Person } from '@hs/contracts';

/**
 * Cómo se lee la consola del roster: etiquetas, orden y búsqueda, sin marcado.
 *
 * La consola es de solo lectura, así que acá no hay nada sobre qué se puede cambiar: solo
 * cómo se muestra y cómo se encuentra.
 *
 * Aparte del componente por la misma razón que `scheduling-presentation.ts`: lo que
 * importa es la decisión y el nombre de cada cosa, y eso se prueba sin renderizar nada.
 */

/**
 * Cómo se nombra a una persona en pantalla.
 *
 * **Siempre con el número de empleado**, y no es decoración: el nombre NO identifica —dos
 * personas activas pueden llamarse igual y §4 lo permite explícitamente—, así que una
 * etiqueta sin el número deja al coordinador eligiendo entre dos filas idénticas.
 */
export function personLabel(person: Person): string {
  return `${person.last_name}, ${person.first_name} (${person.employee_number})`;
}

/** Activa o no. El estado es una fecha en la base; acá es una palabra. */
export function statusLabel(person: Person): string {
  return person.deactivated_at === null ? 'Active' : 'Inactive';
}

/** La clase del badge. Sin colores literales: los tokens los resuelve `index.css`. */
export function statusClass(person: Person): string {
  return person.deactivated_at === null ? 'badge' : 'badge badge--closed';
}

/**
 * Si esta persona entra en la búsqueda.
 *
 * Busca en apellido, nombre y número de empleado: quien tiene el número lo tipea, y quien
 * no, escribe un apellido a medias. Sin distinguir mayúsculas ni acentos —`normalize` más
 * el rango de diacríticos—, porque "Álvarez" tipeado sin tilde tiene que encontrar.
 */
export function matchesSearch(person: Person, query: string): boolean {
  const needle = normalise(query);
  if (needle === '') return true;

  return [person.first_name, person.last_name, person.employee_number]
    .map(normalise)
    .some((field) => field.includes(needle));
}

function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * El orden de la lista: apellido, nombre y —como desempate— número de empleado.
 *
 * El tercer criterio no sobra: la spec permite dos personas activas con el mismo nombre y
 * apellido, y sin él las dos filas se intercambiarían de lugar entre renders.
 */
export function sortRoster(people: readonly Person[]): Person[] {
  return [...people].sort(
    (a, b) =>
      a.last_name.localeCompare(b.last_name) ||
      a.first_name.localeCompare(b.first_name) ||
      a.employee_number.localeCompare(b.employee_number),
  );
}
