import { describe, expect, it } from 'vitest';

import {
  MAX_UPLOAD_BYTES,
  acceptedSubmissionSchema,
  inspectionSubmissionSchema,
  presignFindingUploadRequestSchema,
  presignActionUploadRequestSchema,
  presignUploadRequestSchema,
  presignUploadResponseSchema,
  submittedInspectionSchema,
} from './submissions.js';

const INSPECTION_ID = '11111111-1111-4111-8111-111111111111';
const SUBMISSION_ID = '22222222-2222-4222-8222-222222222222';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const LOCATION_ID = '55555555-5555-4555-8555-555555555555';
const SITE_ID = '66666666-6666-4666-8666-666666666666';
const DRAFT_FINDING_ID = '77777777-7777-4777-8777-777777777777';
const FINDING_ID = '88888888-8888-4888-8888-888888888888';

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
    findings: {
      'guarding.installed': {
        description: 'Guard missing on the infeed of packaging line 3',
        location_id: LOCATION_ID,
        photo_object_keys: ['site/inspection/ccc.jpg'],
      },
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

describe('presignActionUploadRequestSchema', () => {
  const valid = {
    action_id: '66666666-6666-4666-8666-666666666666',
    content_type: 'image/jpeg',
    content_length: 1024,
  };

  it('acepta un pedido de subida de evidencia', () => {
    expect(presignActionUploadRequestSchema.safeParse(valid).success).toBe(true);
  });

  /**
   * Las tres formas son tres afirmaciones distintas sobre tres prefijos distintos
   * (design D9). Que la de la evidencia no acepte los campos de las otras dos es lo
   * que impide que un pedido termine escribiendo bajo el prefijo equivocado.
   */
  it('rechaza los campos de las otras dos formas', () => {
    for (const extra of [
      { scheduled_inspection_id: '77777777-7777-4777-8777-777777777777' },
      { draft_finding_id: '88888888-8888-4888-8888-888888888888' },
      { site_id: '99999999-9999-4999-8999-999999999999' },
      { object_key: 'otro-sitio/actions/otra/mia.jpg' },
    ]) {
      expect(presignActionUploadRequestSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });

  it('rechaza un content_length por encima del tope', () => {
    expect(
      presignActionUploadRequestSchema.safeParse({
        ...valid,
        content_length: MAX_UPLOAD_BYTES + 1,
      }).success,
    ).toBe(false);
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

  it('exige el bloque de hallazgos, aunque esté vacío', () => {
    const { findings: _omitted, ...withoutFindings } = validSubmission();

    expect(inspectionSubmissionSchema.safeParse(withoutFindings).success).toBe(false);
    expect(
      inspectionSubmissionSchema.safeParse({ ...validSubmission(), findings: {} }).success,
    ).toBe(true);
  });

  it('rechaza un hallazgo sin foto', () => {
    const result = inspectionSubmissionSchema.safeParse({
      ...validSubmission(),
      findings: {
        'guarding.installed': {
          description: 'Guard missing on the infeed of packaging line 3',
          location_id: LOCATION_ID,
          photo_object_keys: [],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('rechaza una descripción demasiado corta', () => {
    const result = inspectionSubmissionSchema.safeParse({
      ...validSubmission(),
      findings: {
        'guarding.installed': {
          description: 'broken',
          location_id: LOCATION_ID,
          photo_object_keys: ['site/inspection/ccc.jpg'],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  /**
   * La lista cerrada de la pregunta 1 del lado del contrato: se referencia un
   * `location_id`, y no hay rama que acepte un nombre escrito a mano.
   */
  it('rechaza una ubicación escrita como texto libre', () => {
    const result = inspectionSubmissionSchema.safeParse({
      ...validSubmission(),
      findings: {
        'guarding.installed': {
          description: 'Guard missing on the infeed of packaging line 3',
          location_id: 'packaging line 3',
          photo_object_keys: ['site/inspection/ccc.jpg'],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it('rechaza bytes entre las fotos de un hallazgo', () => {
    const result = inspectionSubmissionSchema.safeParse({
      ...validSubmission(),
      findings: {
        'guarding.installed': {
          description: 'Guard missing on the infeed of packaging line 3',
          location_id: LOCATION_ID,
          photo_object_keys: [new Uint8Array([1, 2, 3])],
        },
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('presignFindingUploadRequestSchema', () => {
  function validFindingPresign() {
    return {
      site_id: SITE_ID,
      draft_finding_id: DRAFT_FINDING_ID,
      content_type: 'image/jpeg',
      content_length: 900_000,
    };
  }

  it('acepta el pedido de la foto de un hallazgo manual', () => {
    expect(presignFindingUploadRequestSchema.safeParse(validFindingPresign()).success).toBe(true);
  });

  it('rechaza una object key propuesta por el cliente', () => {
    const result = presignFindingUploadRequestSchema.safeParse({
      ...validFindingPresign(),
      object_key: 'otro-sitio/manual/mia.jpg',
    });

    expect(result.success).toBe(false);
  });

  /** Un hallazgo manual no tiene ítem: aceptar una `item_key` sería mentir sobre eso. */
  it('rechaza una item_key', () => {
    const result = presignFindingUploadRequestSchema.safeParse({
      ...validFindingPresign(),
      item_key: 'guarding.photo',
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

describe('submittedInspectionSchema', () => {
  function validSubmitted() {
    return {
      scheduled_inspection_id: INSPECTION_ID,
      inspection_id: SUBMISSION_ID,
      site_id: SITE_ID,
      period_start: '2026-08-01',
      period_months: 1,
      template_name: 'Monthly general workplace inspection',
      template_version_id: VERSION_ID,
      template_version: 2,
      document: {
        sections: [
          {
            section_key: 'guarding',
            section_title: 'Machine guarding',
            position: 1,
            items: [
              {
                item_key: 'guarding.installed',
                prompt: 'Are all guards installed?',
                position: 1,
                response_type: 'yes_no',
                required: true,
              },
            ],
          },
        ],
      },
      answers: {
        'guarding.installed': false,
        'guarding.rating': 4,
        'guarding.notes': 'Machine 3 guard was refitted',
        'guarding.defects': ['loose', 'bent'],
        'guarding.photo': ['site/inspection/aaa.jpg'],
        'walkthrough.signature': {
          object_key: 'site/inspection/signature.png',
          signed_at: '2026-08-08T15:00:00.000Z',
        },
      },
      findings: [
        {
          id: FINDING_ID,
          site_id: SITE_ID,
          origin: 'inspection',
          inspection_id: SUBMISSION_ID,
          template_version_item_id: VERSION_ID,
          item_key: 'guarding.installed',
          location_id: LOCATION_ID,
          description: 'Guard missing on the infeed of packaging line 3',
          photo_object_keys: ['site/inspection/ccc.jpg'],
          reported_by: USER_ID,
          occurred_at: '2026-08-08T15:00:00.000Z',
          recorded_at: '2026-08-08T15:05:00.000Z',
          recurrence: null,
        },
      ],
      submitted_by: USER_ID,
      submitted_by_name: 'Marie Tremblay',
      signed_at: '2026-08-08T15:00:00.000Z',
      received_at: '2026-08-09T11:00:00.000Z',
      answer_count: 6,
    };
  }

  it('acepta un envío leído con respuestas de cada forma que define response_type', () => {
    expect(submittedInspectionSchema.safeParse(validSubmitted()).success).toBe(true);
  });

  /**
   * El nombre del firmante falta cuando su fila de `person` está en la otra planta. La
   * firma no falta: `submitted_by` sigue ahí.
   */
  it('acepta un firmante sin nombre visible', () => {
    const result = submittedInspectionSchema.safeParse({
      ...validSubmitted(),
      submitted_by_name: null,
    });

    expect(result.success).toBe(true);
  });

  /**
   * Un ítem sin respuesta NO tiene clave. Es lo que distingue "no contestado" de
   * "contestado vacío" sin necesitar un centinela.
   */
  it('acepta un envío sin ninguna respuesta para un ítem del documento', () => {
    const result = submittedInspectionSchema.safeParse({
      ...validSubmitted(),
      answers: {},
      answer_count: 0,
    });

    expect(result.success).toBe(true);
  });

  it('rechaza una item_key que no cumple el patrón', () => {
    const result = submittedInspectionSchema.safeParse({
      ...validSubmitted(),
      answers: { 'Guarding Installed': true },
    });

    expect(result.success).toBe(false);
  });

  it('exige el documento congelado: sin él no hay con qué leer las respuestas', () => {
    const { document: _document, ...withoutDocument } = validSubmitted();

    expect(submittedInspectionSchema.safeParse(withoutDocument).success).toBe(false);
  });
});
