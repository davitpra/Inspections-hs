import { createHash } from 'node:crypto';

import { canonicalize } from '@hs/contracts';

/**
 * ADR-002 — EL DIGEST DEL REPORTE DE CUMPLIMIENTO. Del payload, nunca del PDF.
 *
 * Las dos mitades viven en lugares distintos a propósito: la serialización canónica está
 * en `@hs/contracts` porque es parte del contrato y tiene que poder correr fuera de este
 * proceso, y el SHA-256 está acá porque `node:crypto` es del servidor. Quien verifique
 * desde afuera necesita el payload, RFC 8785 y un SHA-256 — nada de este repositorio.
 *
 * POR QUÉ NO EXISTE UN `digestPdf` NI VA A EXISTIR. Chromium no produce el mismo archivo
 * dos veces: cambian la versión del navegador, las fuentes del contenedor, el subsetting
 * del embebido y la fecha de creación que el propio PDF lleva adentro. Un digest del
 * archivo sería un número que a los seis meses no verifica nadie, ni nosotros. El del
 * payload sí, y por eso es el que se imprime en el pie de cada página.
 */

/** El algoritmo, escrito una sola vez y nombrado en el documento que produce. */
export const PAYLOAD_DIGEST_ALGORITHM = 'sha256';

/** Lo que el `CHECK` de `compliance_report.payload_hash` exige del otro lado. */
export const PAYLOAD_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * El digest hexadecimal en minúscula del payload canonicalizado y codificado en UTF-8.
 *
 * Minúscula y no mayúscula porque el `CHECK` de la migración pide `[0-9a-f]`: dos formas
 * de escribir el mismo número serían dos formas de que una comparación de cadenas falle
 * sobre un documento correcto.
 *
 * Si el payload no es canonicalizable —una fecha sin normalizar, un conteo `NaN`— esto
 * lanza y el reporte no llega a existir. Es deliberado: un reporte con un digest calculado
 * sobre una serialización tolerante es peor que ningún reporte.
 */
export function digestPayload(payload: unknown): string {
  return createHash(PAYLOAD_DIGEST_ALGORITHM)
    .update(canonicalize(payload), 'utf8')
    .digest('hex');
}
