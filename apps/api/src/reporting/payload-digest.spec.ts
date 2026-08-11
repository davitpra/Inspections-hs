import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { PAYLOAD_HASH_PATTERN, digestPayload } from './payload-digest';

const PAYLOAD = {
  schema_version: 1,
  site: { id: 'st-thomas', name: 'St. Thomas' },
  coverage: { required_count: 12, completed_count: 11 },
  periods: [{ period_start: '2026-01-01', status: 'completed' }],
};

describe('digestPayload', () => {
  it('produce 64 hex en minúscula, que es lo que el CHECK de la migración exige', () => {
    const digest = digestPayload(PAYLOAD);

    expect(digest).toMatch(PAYLOAD_HASH_PATTERN);
    expect(digest).toHaveLength(64);
    expect(digest).toBe(digest.toLowerCase());
  });

  it('no depende del orden en que se armó el objeto', () => {
    const reordered = {
      periods: [{ status: 'completed', period_start: '2026-01-01' }],
      coverage: { completed_count: 11, required_count: 12 },
      site: { name: 'St. Thomas', id: 'st-thomas' },
      schema_version: 1,
    };

    expect(digestPayload(reordered)).toBe(digestPayload(PAYLOAD));
  });

  it('cambia cuando cambia un solo dato', () => {
    const altered = { ...PAYLOAD, coverage: { required_count: 12, completed_count: 12 } };

    expect(digestPayload(altered)).not.toBe(digestPayload(PAYLOAD));
  });

  it('es el mismo número en otro proceso, que es la propiedad entera', () => {
    // Se recomputa en un proceso de Node aparte, sin compartir memoria ni módulos
    // cargados. Es la versión chica del test de cierre 10.1: el digest de un reporte de
    // julio tiene que poder recomputarse en 2031 desde el payload y el RFC.
    const script = `
      const { createHash } = require('node:crypto');
      const payload = JSON.parse(process.argv[1]);
      const canon = (v) => {
        if (v === null || typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
        return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
      };
      process.stdout.write(createHash('sha256').update(canon(payload), 'utf8').digest('hex'));
    `;

    const elsewhere = execFileSync(process.execPath, ['-e', script, JSON.stringify(PAYLOAD)], {
      encoding: 'utf8',
    });

    expect(elsewhere).toBe(digestPayload(PAYLOAD));
  });

  it('es SHA-256 del texto canónico y no de otra cosa', () => {
    const canonical =
      '{"coverage":{"completed_count":11,"required_count":12},' +
      '"periods":[{"period_start":"2026-01-01","status":"completed"}],' +
      '"schema_version":1,' +
      '"site":{"id":"st-thomas","name":"St. Thomas"}}';

    expect(digestPayload(PAYLOAD)).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    );
  });

  it('lanza en vez de hashear un payload que no es canonicalizable', () => {
    // Una fecha sin normalizar es el caso realista: `JSON.stringify` le llamaría
    // `toJSON()` y el digest pasaría a depender de una conversión implícita.
    expect(() => digestPayload({ generated_at: new Date(0) })).toThrow();
    expect(() => digestPayload({ completed_count: Number.NaN })).toThrow();
  });
});
