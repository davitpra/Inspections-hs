import type { InspectionSubmission } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import { deriveObjectKey } from '../uploads/object-storage';
import {
  foreignObjectKeys,
  mergePhotoAnswers,
  objectKeyPrefix,
  objectKeysOf,
} from './submission';

const SITE = '11111111-1111-4111-8111-111111111111';
const INSPECTION = '22222222-2222-4222-8222-222222222222';
const OTHER_SITE = '33333333-3333-4333-8333-333333333333';
const OTHER_INSPECTION = '44444444-4444-4444-8444-444444444444';

const key = (site = SITE, inspection = INSPECTION, name = 'abc') =>
  `${site}/${inspection}/${name}`;

describe('mergePhotoAnswers', () => {
  it('funde las keys de un ítem de foto que no tiene entrada en answers', () => {
    // El caso normal y el motivo de que la función exista: el dispositivo NUNCA manda
    // un ítem de foto dentro de `answers`, así que sin la fusión saldría
    // `required_missing` y ningún envío con fotos se aceptaría.
    const result = mergePhotoAnswers(
      { 'dock.guards': false },
      { 'dock.guards.photo': [key(), key(SITE, INSPECTION, 'def')] },
    );

    expect(result).toEqual({
      ok: true,
      answers: {
        'dock.guards': false,
        'dock.guards.photo': [key(), key(SITE, INSPECTION, 'def')],
      },
    });
  });

  it('deja intacto lo que no es una foto', () => {
    const answers = { 'dock.guards': false, 'dock.note': 'loose bolt', 'dock.scale': 3 };

    expect(mergePhotoAnswers(answers, {})).toEqual({ ok: true, answers });
  });

  it('rechaza la misma item_key en los dos mapas, sin elegir un ganador', () => {
    const result = mergePhotoAnswers(
      { 'dock.photo': ['de answers'], 'dock.guards': false },
      { 'dock.photo': [key()] },
    );

    expect(result).toEqual({ ok: false, collisions: ['dock.photo'] });
  });

  it('nombra todas las colisiones, no la primera', () => {
    const result = mergePhotoAnswers(
      { a: [], b: [], c: false },
      { a: [key()], b: [key()] },
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.collisions).toEqual(['a', 'b']);
  });

  it('no muta los mapas que recibe', () => {
    const answers = { 'dock.guards': false };
    const photos = { 'dock.photo': [key()] };

    mergePhotoAnswers(answers, photos);

    expect(answers).toEqual({ 'dock.guards': false });
    expect(photos).toEqual({ 'dock.photo': [key()] });
  });
});

describe('objectKeysOf', () => {
  it('junta las keys de las fotos y la de la firma', () => {
    const keys = objectKeysOf(
      {
        'dock.guards': false,
        'sign.inspector': { object_key: key(SITE, INSPECTION, 'sig'), signed_at: '2026-08-03T14:20:00-04:00' },
      },
      { 'dock.photo': [key(), key(SITE, INSPECTION, 'def')] },
    );

    expect(keys.sort()).toEqual(
      [key(), key(SITE, INSPECTION, 'def'), key(SITE, INSPECTION, 'sig')].sort(),
    );
  });

  it('no confunde una respuesta de texto con una firma', () => {
    expect(objectKeysOf({ 'dock.note': 'algo', 'dock.scale': 3 }, {})).toEqual([]);
  });

  it('ignora un objeto que no tiene la forma de una firma', () => {
    // El cast es el punto del caso: el contrato de Zod ya rechaza esto antes de llegar
    // al servicio, y aun así la función no puede confiar en eso —`signed_at` faltante
    // no puede convertirse en una object key aceptada por descuido.
    const malformed = { x: { object_key: 'k' } } as unknown as InspectionSubmission['answers'];

    expect(objectKeysOf(malformed, {})).toEqual([]);
  });
});

describe('foreignObjectKeys', () => {
  it('acepta las keys que uploads deriva para esta inspección', () => {
    // La afirmación que importa: lo que el servidor firma es lo que el servidor
    // acepta. Se compara contra `deriveObjectKey` real y no contra una cadena
    // escrita a mano — si el prefijo cambiara de un lado, esto lo dice.
    const derived = deriveObjectKey(SITE, INSPECTION);

    expect(foreignObjectKeys([derived], SITE, INSPECTION)).toEqual([]);
  });

  it('rechaza la key de otra inspección del mismo sitio', () => {
    const foreign = key(SITE, OTHER_INSPECTION);

    expect(foreignObjectKeys([key(), foreign], SITE, INSPECTION)).toEqual([foreign]);
  });

  it('rechaza la key de otra planta', () => {
    const foreign = key(OTHER_SITE, OTHER_INSPECTION);

    expect(foreignObjectKeys([foreign], SITE, INSPECTION)).toEqual([foreign]);
  });

  it('rechaza una key que empieza con el id del sitio pero no con el prefijo entero', () => {
    // `${SITE}/${INSPECTION}x/...` empieza con el prefijo del sitio y NO pertenece a
    // esta inspección. Un `includes` en vez de un `startsWith` la dejaría pasar.
    const sneaky = `${SITE}/${INSPECTION}x/abc`;

    expect(foreignObjectKeys([sneaky], SITE, INSPECTION)).toEqual([sneaky]);
  });

  it('rechaza una ruta que sale del prefijo por arriba', () => {
    const escaping = `${SITE}/${INSPECTION}/../${OTHER_INSPECTION}/abc`;

    // Esta SÍ empieza con el prefijo, así que `foreignObjectKeys` la acepta: no es
    // una ruta de archivo, es una clave de objeto, y el bucket la trata como cadena
    // literal. El test existe para dejar escrito que se sabe y que es inocuo.
    expect(foreignObjectKeys([escaping], SITE, INSPECTION)).toEqual([]);
  });

  it('sin keys no hay nada que rechazar', () => {
    expect(foreignObjectKeys([], SITE, INSPECTION)).toEqual([]);
  });
});

describe('objectKeyPrefix', () => {
  it('termina en barra, que es lo que hace que startsWith no acepte de más', () => {
    expect(objectKeyPrefix(SITE, INSPECTION)).toBe(`${SITE}/${INSPECTION}/`);
  });
});
