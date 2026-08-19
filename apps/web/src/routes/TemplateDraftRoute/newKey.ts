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
