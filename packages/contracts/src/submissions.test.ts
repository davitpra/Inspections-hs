import { describe, expect, it } from 'vitest';

import {
  MAX_UPLOAD_BYTES,
  acceptedSubmissionSchema,
  inspectionSubmissionSchema,
  presignUploadRequestSchema,
  presignUploadResponseSchema,
} from './submissions.js';

const INSPECTION_ID = '11111111-1111-4111-8111-111111111111';
const SUBMISSION_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

function validPresign() {
  return {
    scheduled_inspection_id: INSPECTION_ID,
    item_key: 'guarding.photo',
    content_type: 'image/jpeg',
    content_length: 1_200_000,
  };
}

function validSubmission() {
  return {
    client_submission_id: SUBMISSION_ID,
    scheduled_inspection_id: INSPECTION_ID,
    template_version_id: VERSION_ID,
    answers: {
      'guarding.installed': true,
      'guarding.rating': 4,
      'guarding.notes': 'Machine 3 guard was refitted',
      'guarding.defects': ['loose', 'bent'],
      'walkthrough.signature': {
        object_key: 'site/inspection/signature.png',
        signed_at: '2026-08-08T15:00:00.000Z',
      },
    },
    photos: {
      'guarding.photo': ['site/inspection/aaa.jpg', 'site/inspection/bbb.jpg'],
    },
    signed_at: '2026-08-08T15:00:00.000Z',
  };
}

describe('presignUploadRequestSchema', () => {
  it('acepta un pedido de subida de una foto', () => {
    expect(presignUploadRequestSchema.safeParse(validPresign()).success).toBe(true);
  });

  it('rechaza un content_type fuera de la lista', () => {
    const result = presignUploadRequestSchema.safeParse({
      ...validPresign(),
      content_type: 'application/pdf',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza un content_length por encima del tope', () => {
    const result = presignUploadRequestSchema.safeParse({
      ...validPresign(),
      content_length: MAX_UPLOAD_BYTES + 1,
    });

    expect(result.success).toBe(false);
  });

  /**
   * D7 — la key la deriva el servidor. Que el `strictObject` la rechace es lo que
   * impide que un dispositivo elija encima de qué inspección escribe.
   */
  it('rechaza una object key propuesta por el cliente', () => {
    const result = presignUploadRequestSchema.safeParse({
      ...validPresign(),
      object_key: 'otro-sitio/otra-inspeccion/mia.jpg',
    });

    expect(result.success).toBe(false);
  });
});

describe('presignUploadResponseSchema', () => {
  it('acepta la URL firmada con su key y su vencimiento', () => {
    const result = presignUploadResponseSchema.safeParse({
      url: 'https://bucket.example.com/site/inspection/aaa.jpg?X-Amz-Signature=abc',
      object_key: 'site/inspection/aaa.jpg',
      expires_at: '2026-08-08T15:05:00.000Z',
    });

    expect(result.success).toBe(true);
  });
});

describe('inspectionSubmissionSchema', () => {
  it('acepta un envío con respuestas y object keys de foto', () => {
    expect(inspectionSubmissionSchema.safeParse(validSubmission()).success).toBe(true);
  });

  /**
   * ADR-001 — el envío referencia object keys y NUNCA lleva bytes. `Uint8Array` es la
   * forma isomórfica de "bytes crudos": el paquete no puede nombrar `Blob` porque no
   * depende de las librerías del DOM, y lo que se afirma es lo mismo — ninguna rama de
   * la unión acepta binario.
   */
  it('rechaza un payload con bytes entre las fotos', () => {
    const result = inspectionSubmissionSchema.safeParse({
      ...validSubmission(),
      photos: { 'guarding.photo': [new Uint8Array([1, 2, 3])] },
    });

    expect(result.success).toBe(false);
  });

  it('rechaza bytes como valor de una respuesta', () => {
    const result = inspectionSubmissionSchema.safeParse({
      ...validSubmission(),
      answers: { 'guarding.photo': new Uint8Array([1, 2, 3]) },
    });

    expect(result.success).toBe(false);
  });

  it('rechaza un client_submission_id que no es uuid', () => {
    const result = inspectionSubmissionSchema.safeParse({
      ...validSubmission(),
      client_submission_id: 'draft-1',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza una item_key que no respeta el formato', () => {
    const result = inspectionSubmissionSchema.safeParse({
      ...validSubmission(),
      answers: { 'Guarding Installed': true },
    });

    expect(result.success).toBe(false);
  });
});

describe('acceptedSubmissionSchema', () => {
  it('acepta el registro creado y el existente por la misma forma', () => {
    const record = {
      id: '55555555-5555-4555-8555-555555555555',
      client_submission_id: SUBMISSION_ID,
      scheduled_inspection_id: INSPECTION_ID,
      template_version_id: VERSION_ID,
      submitted_at: '2026-08-08T15:00:00.000Z',
      submitted_by: USER_ID,
      created: true,
    };

    expect(acceptedSubmissionSchema.safeParse(record).success).toBe(true);
    expect(acceptedSubmissionSchema.safeParse({ ...record, created: false }).success).toBe(true);
  });
});
