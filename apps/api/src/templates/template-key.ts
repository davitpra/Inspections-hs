/**
 * La `key` de una plantilla, derivada de su nombre.
 *
 * **VIVE EN EL SERVIDOR Y NADA MÁS.** El cliente no la calcula porque no la elige: el
 * formulario de creación pide un nombre y la clave vuelve resuelta en la respuesta. Una
 * copia en `apps/web` solo serviría para previsualizar algo que el autor no decide, y sería
 * una segunda implementación de una identidad que tiene que ser una sola.
 *
 * POR QUÉ SE DERIVA Y NO SE ESCRIBE. La clave es un identificador técnico —lo que usan los
 * seeds, lo que va a nombrar a la plantilla publicada— y pedirle al coordinador que lo
 * invente es pedirle una decisión que no tiene forma de tomar bien. Lo que sí sabe es cómo
 * se llama la plantilla.
 *
 * POR QUÉ NO DESEMPATA. Si dos nombres derivaran a la misma clave, la salida fácil sería
 * agregar un sufijo —`monthly-electrical-2`— y ahí `key = f(name)` deja de ser cierto sin
 * que nadie lo vea. En vez de eso, la colisión se rechaza y se reporta como lo que es: un
 * nombre demasiado parecido a uno que ya existe. La unicidad del nombre la fuerza el índice
 * de la migración 0017; esto solo tiene que no romperla.
 *
 * NO ES `suggestItemKey`. Aquella recorta a cuatro palabras porque una pregunta puede ser
 * una oración entera; esta se queda con todo, porque el nombre de una plantilla ya es corto
 * y recortarlo produciría claves que no se distinguen entre sí.
 */

/** El patrón que el `CHECK` de 0016 y `@hs/contracts` exigen. */
const TEMPLATE_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * `Monthly electrical inspection` → `monthly-electrical-inspection`.
 *
 * Devuelve `null` cuando el nombre no deja nada utilizable —`"???"`, `"   "`, un nombre
 * escrito enteramente en un alfabeto que el patrón no admite—. Es un caso real y no un
 * imposible, y devolver `''` habría hecho que el llamador lo descubriera recién en el
 * `CHECK` de la base, con un error que no menciona el nombre por ningún lado.
 */
export function templateKeyFromName(name: string): string | null {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    // Los diacríticos, fuera: el patrón solo acepta a-z y dígitos.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return TEMPLATE_KEY_PATTERN.test(slug) ? slug : null;
}
