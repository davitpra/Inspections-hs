import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { inspectionSubmissionSchema, type AcceptedSubmission } from '@hs/contracts';

import { CurrentSession } from '../auth/session.decorator';
import type { SessionContext } from '../auth/session.service';
import { SubmissionsService } from './submissions.service';

/**
 * ADR-008, costura crítica 1 — El punto de no retorno de R1.
 *
 * **La ruta es `/inspection-submissions` y no `/inspections/submissions`.** ADR-008
 * escribe la segunda en la prosa que nombra la costura; el dispositivo, ya entregado y
 * probado, postea a la primera. Se adopta la del dispositivo: cambiar código offline
 * verificado para ganar una barra es riesgo sin beneficio, y servir las dos dejaría dos
 * caminos al registro legal, que es exactamente la ambigüedad que esta costura no puede
 * permitirse. El resto del módulo ya usa rutas planas.
 *
 * Un controlador propio y no un método más de `InspectionsController` porque son dos
 * cosas distintas: aquel administra la OBLIGACIÓN de inspeccionar —coordinador,
 * calendario, reasignaciones—, y este recibe su CUMPLIMIENTO, de un teléfono, una sola
 * vez, sin vuelta atrás.
 */
@Controller()
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  /**
   * **`201` también en el reenvío**, y no es un descuido.
   *
   * El contrato lo dice: `created` distingue los dos casos «sin cambiar el status ni la
   * forma». Para el dispositivo los dos significan lo mismo —el registro existe, la
   * entrada del outbox se puede borrar— y hacer que un reintento sobre la red de una
   * planta devuelva algo distinto de un envío exitoso es pedirle a la cola que
   * interprete la diferencia. La única lectura de "created" es del lado del servidor.
   *
   * El actor sale de `@CurrentSession` y de ningún campo del cuerpo.
   */
  @Post('inspection-submissions')
  @HttpCode(HttpStatus.CREATED)
  async ingest(
    @CurrentSession() session: SessionContext,
    @Body() body: unknown,
  ): Promise<AcceptedSubmission> {
    return this.submissions.ingest(session, inspectionSubmissionSchema.parse(body));
  }
}
