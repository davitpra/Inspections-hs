import { Body, Controller, INestApplication, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { inspectionSubmissionSchema } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ZodExceptionFilter } from './zod-exception.filter';

/**
 * La regresión: una descripción de hallazgo demasiado corta salía como `500` con el
 * stack del `ZodError` en el log.
 *
 * Un `500` no lleva código tipado, así que `readError` del dispositivo lo tomaba como
 * `session_ended` y el outbox lo mandaba a `retryLater` — un envío que el servidor nunca
 * iba a aceptar, reintentando con retroceso para siempre desde la planta. Lo que este
 * test fija es el `400` con `code`, que es lo único que la cola sabe leer para detenerse.
 *
 * Se prueba sobre un controlador de juguete y no sobre `SubmissionsController` porque lo
 * que se afirma es del filtro: cada controlador de la API llama `schema.parse(body)` en
 * crudo y todos dependen de esta misma traducción.
 */
@Controller()
class ProbeController {
  @Post('probe')
  ingest(@Body() body: unknown): unknown {
    return inspectionSubmissionSchema.parse(body);
  }
}

let app: INestApplication;
let url: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
    providers: [{ provide: APP_FILTER, useClass: ZodExceptionFilter }],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.listen(0);

  url = await app.getUrl();
});

afterAll(async () => {
  await app.close();
});

interface ErrorBody {
  code?: string;
  message?: string;
  issues?: { path: string; code: string; message: string }[];
}

async function post(body: unknown): Promise<{ status: number; body: ErrorBody }> {
  const response = await fetch(`${url}/probe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return { status: response.status, body: (await response.json()) as ErrorBody };
}

describe('ZodExceptionFilter', () => {
  it('un cuerpo que no cumple el contrato es 400 con código, no 500', async () => {
    const response = await post({ nada: 'que ver' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('invalid_request');
  });

  it('nombra el campo que falla, con su path completo', async () => {
    const response = await post(submissionWithDescription('ok'));

    expect(response.status).toBe(400);
    expect(response.body.issues).toContainEqual(
      expect.objectContaining({
        path: 'findings.emergency.first-aid-stocked.description',
        code: 'too_small',
      }),
    );
  });

  it('no devuelve el valor recibido', async () => {
    const response = await post(submissionWithDescription('ok'));

    expect(JSON.stringify(response.body)).not.toContain('secreto');
  });
});

function submissionWithDescription(description: string): unknown {
  return {
    client_submission_id: '11111111-1111-4111-8111-111111111111',
    scheduled_inspection_id: '22222222-2222-4222-8222-222222222222',
    template_version_id: '33333333-3333-4333-8333-333333333333',
    answers: { 'emergency.first-aid-stocked': false },
    photos: {},
    findings: {
      'emergency.first-aid-stocked': {
        description,
        location_id: '44444444-4444-4444-8444-444444444444',
        photo_object_keys: ['sites/x/secreto.jpg'],
      },
    },
    signed_at: '2026-08-12T13:06:36.000Z',
  };
}
