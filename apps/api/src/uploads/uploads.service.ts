import { Injectable } from '@nestjs/common';
import type { PresignUploadRequest, PresignUploadResponse } from '@hs/contracts';

import { forbidden } from '../auth/auth.errors';
import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { findActiveInspection } from '../inspections/active-inspection';
import { ObjectStorageService } from './object-storage';

/**
 * `POST /uploads/presign` — lo único que este change le agrega al servidor.
 *
 * Hace dos cosas y se detiene: comprueba que la inspección exista **dentro del alcance
 * del solicitante** y firma un PUT. Ninguna lógica de envío: la ingesta idempotente es
 * `submission-ingestion-endpoint`, y meterla acá de a pedazos sería empezarla sin su
 * transacción ni su único sobre `client_submission_id`.
 *
 * El aislamiento por sitio lo aplica la política RLS y NO un `WHERE` en la consulta
 * (invariante de contexto, ADR-002): la inspección de la otra planta no devuelve cero
 * filas porque se la filtre acá, sino porque la transacción no la ve. Es la misma
 * razón por la que este servicio no recibe ni acepta un `site_id` del cuerpo.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly db: DbService,
    private readonly storage: ObjectStorageService,
  ) {}

  async presign(
    session: SessionScope,
    input: PresignUploadRequest,
  ): Promise<PresignUploadResponse> {
    const inspection = await this.db.withSessionClient(session, (client) =>
      findActiveInspection(client, input.scheduled_inspection_id),
    );

    // Una sola respuesta para "no existe", "está cancelada" y "es de la otra planta":
    // desde acá las tres se ven igual, y distinguirlas convertiría el endpoint en un
    // oráculo de qué se inspecciona donde el solicitante no tiene alcance.
    //
    // `forbidden` y no `inspection_not_found`: es el comportamiento que `offline-capture`
    // ya especifica para esta ruta ("rejected as forbidden"). Las rutas del paquete de
    // campo responden con el código del controlador de inspecciones, y la divergencia
    // está anotada a propósito en vez de arreglada de paso.
    if (!inspection) {
      throw forbidden('No such inspection record within your scope');
    }

    return this.storage.presignPut({
      site_id: inspection.site_id,
      scheduled_inspection_id: input.scheduled_inspection_id,
      content_type: input.content_type,
      content_length: input.content_length,
    });
  }
}
