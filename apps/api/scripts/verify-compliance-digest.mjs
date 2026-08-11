#!/usr/bin/env node
/**
 * VERIFICADOR INDEPENDIENTE DEL DIGEST DE UN REPORTE DE CUMPLIMIENTO.
 *
 * ADR-002 decidió que se hashea el payload canónico en JSON y no los bytes del PDF, y la
 * razón entera de esa decisión es ESTE archivo: que alguien de afuera —el MLITSD, un
 * auditor, nosotros dentro de cinco años— pueda recomputar el número impreso en el pie del
 * documento sin nuestro código y sin nuestra base de datos.
 *
 * Por eso este script **no importa nada del repositorio**: ni `@hs/contracts`, ni la
 * implementación de `canonicalize`, ni un solo módulo de `apps/api`. Solo Node. Si esto
 * coincide con lo que la aplicación guardó, la propiedad se sostiene; si dependiera de
 * nuestra librería, no probaría nada.
 *
 * Uso:
 *   node scripts/verify-compliance-digest.mjs payload.json            # imprime el digest
 *   node scripts/verify-compliance-digest.mjs payload.json <hash>     # además compara
 *
 * Donde `payload.json` es el campo `payload` que devuelve
 * `GET /reports/compliance/:id`, guardado tal cual.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * RFC 8785 (JSON Canonicalization Scheme), en veinte líneas.
 *
 * Las tres reglas: claves ordenadas por unidad de código UTF-16 —que es lo que compara el
 * `sort()` de JavaScript sin comparador—, sin espacio insignificante, y strings y números
 * con la serialización de ECMAScript, que es lo que hace `JSON.stringify` sobre una hoja.
 *
 * El orden de los arrays NO se toca: es dato, no presentación.
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('número no finito: el payload no es JSON válido');
    }

    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',')}}`;
}

const [, , file, expected] = process.argv;

if (!file) {
  console.error('Uso: node scripts/verify-compliance-digest.mjs <payload.json> [hash esperado]');
  process.exit(2);
}

const payload = JSON.parse(readFileSync(file, 'utf8'));
const digest = createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');

console.log(digest);

if (expected) {
  if (digest === expected.trim().toLowerCase()) {
    console.log('OK: el digest coincide con el declarado.');
  } else {
    console.error('NO COINCIDE: el payload no es el que produjo ese digest.');
    process.exit(1);
  }
}
