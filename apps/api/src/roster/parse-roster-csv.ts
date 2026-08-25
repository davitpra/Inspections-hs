import { CsvError, parse } from 'csv-parse/sync';

import {
  ROSTER_CSV_COLUMNS,
  rosterCsvRowSchema,
  type RosterCsvRow,
  type RosterRejection,
} from '@hs/contracts';

/**
 * Requisitos §6 pregunta cerrada 3 — El roster entra por archivo, manual y
 * controlado. Nunca por sincronización con ADP.
 *
 * Esta mitad es PURA: no toca la base, no conoce NestJS y no sabe qué sitios
 * existen. Recibe el texto del archivo y devuelve las filas que valen y las que no,
 * con el motivo de cada rechazo. Es lo que se puede testear sin levantar Postgres, y
 * es donde vive la numeración de filas que el coordinador necesita para ir a
 * arreglar el archivo.
 *
 * Lo que NO puede decidir acá: si el `site_code` existe, si cae dentro del alcance
 * de quien importa, y si el `employee_number` ya está en el roster. Eso necesita la
 * base y vive en `apply-roster.ts`.
 */

/** El resultado del parseo. Las filas ya validadas y las que no pasaron. */
export interface ParsedRoster {
  rows: ParsedRosterRow[];
  rejections: RosterRejection[];
  /** Filas de datos leídas, rechazadas incluidas. No cuenta el encabezado. */
  rowsRead: number;
  /**
   * La fila cruda de CADA fila de datos, por número de fila — las rechazadas
   * incluidas. Es lo que permite guardar el rechazo junto a lo que se rechazó, y
   * atribuir a su planta una fila que traía un `site_code` bueno y falló por otra
   * cosa.
   */
  rawByRow: Map<number, Record<string, string>>;
}

export interface ParsedRosterRow extends RosterCsvRow {
  /**
   * 1-based sobre el ARCHIVO, con el encabezado contando como fila 1. Es el número
   * que el coordinador ve en Excel, que es el único lugar donde va a ir a
   * arreglarlo. Se arrastra hasta el reporte y hasta `roster_import_rejection`.
   */
  rowNumber: number;
  /** La fila cruda, para poder guardarla junto al rechazo. */
  raw: Record<string, string>;
}

/**
 * El archivo entero es inválido, no una fila suya. Es el único caso en que no se
 * aplica nada: sin encabezado no hay forma de saber qué es cada columna, y adivinar
 * por posición es exactamente cómo se importa un roster con los nombres y los
 * apellidos cambiados de lugar.
 */
export class RosterFileError extends Error {}

/** Quita el BOM que dejan los "Guardar como CSV UTF-8" de Excel. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseRosterCsv(text: string): ParsedRoster {
  // `csv-parse` y no `split(',')`: los apellidos con coma entre comillas y los
  // `\r\n` de un export de Excel son el caso normal, no el borde.
  let records: Record<string, string>[];

  try {
    records = parse(stripBom(text), {
      columns: (header: string[]) => header.map((name) => name.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (error) {
    if (error instanceof CsvError) {
      throw new RosterFileError(`the file contains invalid CSV: ${error.message}`, { cause: error });
    }
    throw error;
  }

  const rows: ParsedRosterRow[] = [];
  const rejections: RosterRejection[] = [];
  const rawByRow = new Map<number, Record<string, string>>();

  // Sin filas de datos no hay encabezado que verificar contra nada; un archivo con
  // encabezado válido y cero filas es legítimo (no da de baja a nadie) y uno
  // completamente vacío no lo es.
  if (records.length === 0) {
    assertHeader(text);
    return { rows: [], rejections: [], rowsRead: 0, rawByRow };
  }

  const present = Object.keys(records[0] ?? {});
  const missing = ROSTER_CSV_COLUMNS.filter((column) => !present.includes(column));

  if (missing.length > 0) {
    throw new RosterFileError(`the file is missing required column(s): ${missing.join(', ')}`);
  }

  // Los duplicados se detectan contra la PRIMERA aparición: esa se aplica y la
  // segunda se rechaza nombrando la fila donde ya había aparecido.
  const seen = new Map<string, number>();

  records.forEach((raw, index) => {
    // +2: el encabezado es la fila 1 y `index` arranca en 0.
    const rowNumber = index + 2;

    rawByRow.set(rowNumber, raw);

    const reject = (reason: string) =>
      rejections.push({
        row_number: rowNumber,
        employee_number: raw.employee_number?.trim() || null,
        reason,
      });

    const result = rosterCsvRowSchema.safeParse({
      employee_number: raw.employee_number ?? '',
      first_name: raw.first_name ?? '',
      last_name: raw.last_name ?? '',
      site_code: raw.site_code ?? '',
      status: raw.status ?? '',
    });

    if (!result.success) {
      reject(describe(result.error.issues));
      return;
    }

    const previous = seen.get(result.data.employee_number);

    if (previous !== undefined) {
      reject(
        `duplicate employee_number "${result.data.employee_number}" — already present on row ${previous}`,
      );
      return;
    }

    seen.set(result.data.employee_number, rowNumber);
    rows.push({ ...result.data, rowNumber, raw });
  });

  return { rows, rejections, rowsRead: records.length, rawByRow };
}

/**
 * Un archivo sin ninguna fila de datos igual tiene que traer el encabezado
 * completo: es lo que distingue "el export salió vacío" de "subiste el archivo
 * equivocado".
 */
function assertHeader(text: string): void {
  const [line = ''] = stripBom(text).split(/\r?\n/);
  const header = line.split(',').map((name) => name.trim().toLowerCase().replace(/^"|"$/g, ''));
  const missing = ROSTER_CSV_COLUMNS.filter((column) => !header.includes(column));

  if (missing.length > 0) {
    throw new RosterFileError(`the file is missing required column(s): ${missing.join(', ')}`);
  }
}

/**
 * El motivo, en una línea. Un problema por campo y no todos: el coordinador va a ir
 * a arreglar la fila, no a leer un informe de validación, y "employee_number: Too
 * small; employee_number: sin espacios..." es la misma noticia dos veces.
 */
function describe(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const first = new Map<string, string>();

  for (const issue of issues) {
    const field = String(issue.path[0] ?? 'row');

    if (!first.has(field)) {
      // El mensaje del regex ya nombra el campo; no se lo antepone dos veces.
      first.set(field, issue.message.startsWith(field) ? issue.message : `${field}: ${issue.message}`);
    }
  }

  return [...first.values()].join('; ');
}
