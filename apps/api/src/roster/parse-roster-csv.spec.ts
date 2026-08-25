import { describe, expect, it } from 'vitest';

import { RosterFileError, parseRosterCsv } from './parse-roster-csv';

const HEADER = 'employee_number,first_name,last_name,site_code,status';

/** Un archivo con el encabezado canónico y las filas dadas. */
function file(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

describe('parseRosterCsv', () => {
  it('acepta un archivo limpio', () => {
    const result = parseRosterCsv(
      file('10472,Ada,Reid,st-thomas,active', '10473,Bo,Chen,glencoe,inactive'),
    );

    expect(result.rowsRead).toBe(2);
    expect(result.rejections).toEqual([]);
    expect(result.rows.map((row) => row.employee_number)).toEqual(['10472', '10473']);
    expect(result.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
  });

  it('matchea las columnas por nombre, no por posición', () => {
    const result = parseRosterCsv(
      ['status,last_name,site_code,employee_number,first_name', 'active,Reid,st-thomas,10472,Ada'].join(
        '\n',
      ),
    );

    expect(result.rows[0]).toMatchObject({
      employee_number: '10472',
      first_name: 'Ada',
      last_name: 'Reid',
      site_code: 'st-thomas',
      status: 'active',
    });
  });

  it('rechaza el archivo entero si falta una columna requerida', () => {
    expect(() =>
      parseRosterCsv(['first_name,last_name,site_code,status', 'Ada,Reid,st-thomas,active'].join('\n')),
    ).toThrow(RosterFileError);
  });

  it('nombra la columna que falta', () => {
    expect(() =>
      parseRosterCsv(['first_name,last_name,site_code,status', 'Ada,Reid,st-thomas,active'].join('\n')),
    ).toThrow(/employee_number/);
  });

  it('acepta un apellido con coma entre comillas', () => {
    const result = parseRosterCsv(file('10472,Ada,"Reid, Jr.",st-thomas,active'));

    expect(result.rows[0]?.last_name).toBe('Reid, Jr.');
  });

  it('acepta los CRLF de un export de Excel', () => {
    const result = parseRosterCsv(
      [HEADER, '10472,Ada,Reid,st-thomas,active', '10473,Bo,Chen,glencoe,active'].join('\r\n'),
    );

    expect(result.rows).toHaveLength(2);
  });

  it('descarta el BOM de un "CSV UTF-8"', () => {
    const result = parseRosterCsv(`\uFEFF${file('10472,Ada,Reid,st-thomas,active')}`);

    expect(result.rows[0]?.employee_number).toBe('10472');
  });

  it('rechaza la fila sin número de empleado y sigue con las demás', () => {
    const result = parseRosterCsv(
      file('10472,Ada,Reid,st-thomas,active', ',Bo,Chen,glencoe,active', '10474,Cy,Diaz,glencoe,active'),
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]).toMatchObject({ row_number: 3, employee_number: null });
    expect(result.rejections[0]?.reason).toMatch(/employee_number/);
  });

  it('rechaza un status fuera de active/inactive', () => {
    const result = parseRosterCsv(file('10472,Ada,Reid,st-thomas,terminated'));

    expect(result.rows).toHaveLength(0);
    expect(result.rejections[0]?.reason).toMatch(/status/);
  });

  it('rechaza un nombre vacío', () => {
    const result = parseRosterCsv(file('10472,,Reid,st-thomas,active'));

    expect(result.rejections[0]?.reason).toMatch(/first_name/);
  });

  it('aplica la primera aparición de un número duplicado y rechaza la segunda', () => {
    const result = parseRosterCsv(
      file('10472,Ada,Reid,st-thomas,active', '10472,Ada,Reid,glencoe,active'),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.site_code).toBe('st-thomas');
    expect(result.rejections[0]).toMatchObject({ row_number: 3, employee_number: '10472' });
    // El motivo nombra la fila donde ya había aparecido: es adónde hay que ir.
    expect(result.rejections[0]?.reason).toMatch(/row 2/);
  });

  it('acepta un archivo con encabezado y sin filas — no da de baja a nadie', () => {
    const result = parseRosterCsv(HEADER);

    expect(result.rowsRead).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.rejections).toEqual([]);
  });

  it('rechaza un archivo vacío sin encabezado', () => {
    expect(() => parseRosterCsv('')).toThrow(RosterFileError);
  });

  it('normaliza comillas sin cerrar como un error del archivo', () => {
    expect(() => parseRosterCsv(file('10472,Ada,"Reid,st-thomas,active'))).toThrowError(
      expect.objectContaining({
        name: 'Error',
        message: expect.stringMatching(/invalid CSV/i),
      }),
    );
  });

  it('cuenta cada fila de datos leída, rechazadas incluidas', () => {
    const result = parseRosterCsv(
      file('10472,Ada,Reid,st-thomas,active', ',Bo,Chen,glencoe,active', '10474,Cy,Diaz,x,nope'),
    );

    expect(result.rowsRead).toBe(3);
    expect(result.rows.length + result.rejections.length).toBe(3);
  });
});
