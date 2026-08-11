/**
 * ADR-002 y §7 etapa 7 — LA SERIALIZACIÓN CANÓNICA SOBRE LA QUE SE CALCULA EL HASH DEL
 * REPORTE DE CUMPLIMIENTO.
 *
 * ADR-002 decidió que se hashea el **payload canónico en JSON** y no los bytes del PDF:
 * la generación por navegador headless no es reproducible byte a byte —versión de
 * Chromium, fuentes del contenedor, subsetting, fecha de creación que Chromium escribe
 * dentro del archivo— y un hash del archivo sería un número que a los seis meses no
 * verifica nadie. Este archivo es la mitad que hace verificable a la otra: **misma
 * entrada, mismos bytes, siempre**.
 *
 * POR QUÉ RFC 8785 Y NO «ordenamos las claves y usamos JSON.stringify». Son casi lo
 * mismo, y el «casi» es todo el problema. `JSON.stringify` no define el orden de las
 * claves, y escribir «ordenamos alfabéticamente y serializamos con Node» dentro de un
 * documento regulatorio obliga a que quien verifique adivine nuestra versión del runtime.
 * «RFC 8785» le da una especificación pública y, probablemente, una librería en su
 * lenguaje. El verificador no debería necesitar nuestro código: ese es el punto entero.
 *
 * POR QUÉ VIVE EN `@hs/contracts` Y NO EN `apps/api`. La forma del payload y su
 * serialización son un contrato, no un detalle del servidor. El día que un verificador
 * corra en el navegador o en un script suelto, importa esto mismo. Por eso el archivo no
 * tiene NINGUNA dependencia —tampoco `node:crypto`—: el digest lo calcula quien tenga un
 * SHA-256 a mano, y acá solo se produce el texto.
 *
 * LA REGLA QUE NO SE PUEDE VIOLAR SIN AVISAR: cambiar la forma de un payload cambia su
 * digest. Por eso el payload de cumplimiento lleva `schema_version` adentro y se sube a
 * mano cuando la forma cambia. Un digest que cambia sin que nadie lo declare es
 * exactamente la clase de sorpresa que este mecanismo existe para no tener.
 */

/** Lo único que se puede canonicalizar: JSON, y nada más que JSON. */
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export class CanonicalizationError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} (en ${path})`);
    this.name = 'CanonicalizationError';
  }
}

/**
 * El valor, serializado según RFC 8785 (JSON Canonicalization Scheme).
 *
 * Las tres reglas del esquema, y de dónde sale cada una acá:
 *
 *   1. **Claves ordenadas por unidad de código UTF-16.** El `sort()` por defecto de
 *      JavaScript compara cadenas justamente así, que es la única razón por la que no
 *      hace falta un comparador. No es alfabético y no es locale-aware: `"Z"` va antes
 *      que `"a"`, y eso es lo correcto.
 *   2. **Sin espacio insignificante.** No hay indentación ni espacios tras `:` ni `,`.
 *   3. **Strings y números con la serialización de ECMAScript**, que es lo que el propio
 *      RFC referencia. Por eso las hojas se delegan a `JSON.stringify`: reimplementar el
 *      escapado de strings o el `Number::toString` sería reimplementar la especificación
 *      que el RFC apunta, con la posibilidad de equivocarse en los bordes que importan
 *      (pares subrogados, `5e-324`, `-0`).
 *
 * LO QUE ESTA FUNCIÓN RECHAZA EN VEZ DE ARREGLAR. `JSON.stringify` es tolerante por
 * diseño: convierte `undefined` de un array en `null`, omite la clave cuyo valor es
 * `undefined`, y llama a `toJSON()` de un `Date` sin decirlo. Las tres son formas de que
 * dos payloads distintos den el mismo texto, o de que el mismo payload dé textos
 * distintos según por dónde pasó. Acá cada una es un error:
 *
 *   - `undefined`, `NaN`, `Infinity`, `-Infinity`, `bigint`, función, símbolo → error.
 *   - Cualquier objeto que no sea un array o un objeto plano —incluido `Date`— → error.
 *
 * Ese último rechazo es deliberado y tiene una consecuencia útil: obliga a que quien
 * construye el payload normalice sus fechas a ISO-8601 explícitamente, en vez de confiar
 * en el `toJSON()` de `Date` y descubrir dentro de dos años que el digest dependía de él.
 */
export function canonicalize(value: unknown): string {
  return write(value, '$');
}

function write(value: unknown, path: string): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      // `NaN` e `Infinity` no existen en JSON. `JSON.stringify` los convierte en `null`,
      // que es peor que fallar: un conteo roto se serializaría como un dato válido.
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`número no finito: ${String(value)}`, path);
      }
      // `Number::toString` de ECMAScript, que es lo que el RFC referencia. Incluye que
      // `-0` se escriba `0` y que `1e21` se escriba `1e+21`.
      return JSON.stringify(value);

    case 'string':
      // El escapado de ECMAScript, con `\uXXXX` para los de control y con los pares
      // subrogados tratados como manda `JSON.stringify` bien formado.
      return JSON.stringify(value);

    case 'undefined':
      throw new CanonicalizationError('undefined no es JSON', path);

    case 'bigint':
      throw new CanonicalizationError('bigint no es JSON: convertir a número o a string', path);

    case 'function':
    case 'symbol':
      throw new CanonicalizationError(`${typeof value} no es JSON`, path);
  }

  if (Array.isArray(value)) {
    // EL ORDEN DE UN ARRAY NO SE TOCA. Es dato, no presentación: `[a, b]` y `[b, a]` son
    // dos payloads distintos y tienen que dar dos digests distintos. Que el reporte
    // ordene sus arrays de forma determinista es responsabilidad de quien lo construye,
    // no de esta función.
    return `[${value.map((item, index) => write(item, `${path}[${index}]`)).join(',')}]`;
  }

  if (!isPlainObject(value)) {
    // Acá caen `Date`, `Map`, `Set`, instancias de clase y todo lo que tenga `toJSON()`.
    // `JSON.stringify` los aceptaría en silencio y el digest pasaría a depender de una
    // conversión implícita.
    throw new CanonicalizationError(
      `solo se canonicalizan objetos planos y arrays; llegó ${describe(value)}`,
      path,
    );
  }

  const entries = Object.keys(value)
    // Regla 1 del RFC: unidades de código UTF-16, que es lo que compara `sort()` sin
    // comparador. NO usar `localeCompare`: ordenaría distinto según la máquina, que es
    // el modo de fallo exacto que este archivo existe para no tener.
    .sort()
    .map((key) => {
      const entry = (value as Record<string, unknown>)[key];

      if (entry === undefined) {
        // `JSON.stringify` omitiría la clave. Omitirla haría que un payload al que le
        // falta un campo y otro que lo trae en `undefined` dieran el mismo digest.
        throw new CanonicalizationError('clave con valor undefined', `${path}.${key}`);
      }

      return `${JSON.stringify(key)}:${write(entry, `${path}.${key}`)}`;
    });

  return `{${entries.join(',')}}`;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describe(value: object): string {
  return value.constructor?.name ?? 'objeto sin prototipo';
}
