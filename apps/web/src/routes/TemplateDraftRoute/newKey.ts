const KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const KEY_LENGTH = 12;

/** Genera una identidad técnica del editor, fuera de la capa pura del documento. */
export function newKey(taken: readonly string[] = []): string {
  const used = new Set(taken);

  let key = '';

  do {
    const bytes = new Uint8Array(KEY_LENGTH);
    globalThis.crypto.getRandomValues(bytes);
    key = Array.from(bytes, (byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length]).join('');
  } while (used.has(key));

  return key;
}

/**
 * `count` identidades nuevas de una vez, todas distintas entre sí.
 *
 * Existe para duplicar una sección: llamar `newKey` en un bucle sin ir acumulando lo ya
 * generado puede devolver dos veces la misma, y esa colisión sería un problema que la
 * pantalla se fabrica sola y después le reporta al autor.
 */
export function newKeys(count: number, taken: readonly string[] = []): string[] {
  const minted: string[] = [];

  for (let index = 0; index < count; index += 1) {
    minted.push(newKey([...taken, ...minted]));
  }

  return minted;
}
