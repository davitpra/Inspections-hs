import { Module } from '@nestjs/common';

import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

/**
 * Requisitos §7 etapa 6 — El módulo de incidentes de ADR-008.
 *
 * **No importa `ActionsModule` y no exporta nada, y las dos cosas son la regla de
 * dependencias de ADR-008 aplicada.**
 *
 * Hacia `actions`: la guarda "no se cierra con acciones abiertas" lee el estado de las
 * acciones **en SQL** —`hs_incident_has_open_actions`— y no llamando a
 * `ActionsService`. Hacia acá: crear una acción cuyo padre es una investigación entra
 * por el endpoint de `actions` con el `investigation_id` en la ruta, y `actions` valida
 * que la investigación exista y sea del sitio con una FK compuesta, no con una llamada a
 * un servicio de incidentes.
 *
 * Las dos flechas se resuelven en el esquema, que es donde la etapa 4 ya resolvió la
 * suya. Si algún día uno de los dos módulos tuviera que inyectar al otro, habría un
 * ciclo y habría un módulo mal recortado.
 *
 * **No importa `JobsModule`**: este change no encola nada. R4 pide notificar al
 * coordinador y eso ocurre dentro de la transacción del reporte; el tercero de los tres
 * trabajos que ADR-005 enumeró sigue sin reclamar.
 */
@Module({
  controllers: [IncidentsController],
  providers: [IncidentsService],
})
export class IncidentsModule {}
