import { Injectable } from '@nestjs/common';
import type {
  PresignActionUploadRequest,
  PresignFindingUploadRequest,
  PresignUploadRequest,
  PresignUploadResponse,
} from '@hs/contracts';

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

  /**
   * La foto de un hallazgo de entrada manual (etapa 4, design D9).
   *
   * No hay inspección programada de la que colgar el alcance, así que la planta la
   * nombra el cliente. **Que esa planta sea suya no se comprueba comparando contra
   * `session.siteIds`**: se comprueba leyendo el catálogo de ubicaciones de esa planta
   * dentro de la transacción con alcance. Si la política no devuelve ninguna fila, la
   * planta no es del solicitante — mismo mecanismo que en todo el resto (ADR-002), y no
   * una comparación en memoria que hay que acordarse de escribir.
   *
   * Un sitio sin catálogo respondería igual que uno ajeno. Es correcto: sin ubicaciones
   * no se puede reportar un hallazgo ahí, porque `location_id` es obligatorio.
   */
  async presignFinding(
    session: SessionScope,
    input: PresignFindingUploadRequest,
  ): Promise<PresignUploadResponse> {
    const inScope = await this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM location WHERE site_id = $1 AND deactivated_at IS NULL LIMIT 1`,
        [input.site_id],
      );

      return rows.length > 0;
    });

    if (!inScope) {
      throw forbidden('No such site within your scope');
    }

    return this.storage.presignManualPut({
      site_id: input.site_id,
      draft_finding_id: input.draft_finding_id,
      content_type: input.content_type,
      content_length: input.content_length,
    });
  }

  /**
   * La evidencia de una acción correctiva (etapa 5, design D9).
   *
   * La planta NO viaja en el request: la acción ya la sabe, y se lee de ella dentro de
   * la transacción con alcance. Si la política no devuelve la acción, no es del
   * solicitante — mismo mecanismo que en todo el resto (ADR-002) y no una comparación
   * en memoria contra `session.siteIds` que hay que acordarse de escribir.
   *
   * Que quien pide la URL pueda además avanzar la acción NO se comprueba acá: lo hace
   * la transición, que es donde la evidencia entra al registro. Una URL firmada sin
   * evento asociado deja un archivo huérfano en el bucket y nada en la base.
   */
  async presignAction(
    session: SessionScope,
    input: PresignActionUploadRequest,
  ): Promise<PresignUploadResponse> {
    const siteId = await this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<{ site_id: string }>(
        `SELECT site_id FROM corrective_action WHERE id = $1`,
        [input.action_id],
      );

      return rows[0]?.site_id ?? null;
    });

    if (!siteId) {
      throw forbidden('No such action within your scope');
    }

    return this.storage.presignActionPut({
      site_id: siteId,
      action_id: input.action_id,
      content_type: input.content_type,
      content_length: input.content_length,
    });
  }
}
