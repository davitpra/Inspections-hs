import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CompliancePayload } from '@hs/contracts';

import { DbService } from '../db/db.service';
import { JobsService } from '../jobs/jobs.service';
import { RENDER_COMPLIANCE_PDF_JOB } from '../jobs/job-registry';
import { ObjectStorageService, deriveComplianceReportKey } from '../uploads/object-storage';
import { PdfRendererService } from './pdf-renderer';

/**
 * ADR-005 y ADR-006 — EL RENDER DEL PDF, FUERA DEL REQUEST.
 *
 * POR QUÉ NO ES SINCRÓNICO (design D4): Playwright levanta Chromium y produce el archivo
 * en segundos, no en milisegundos. Sostener el request mientras tanto ataría el timeout
 * del proxy a la performance del navegador y haría que un cuelgue del render se viera,
 * desde afuera, como un cuelgue de la aplicación.
 *
 * LO QUE ESA ASINCRONÍA COMPRA, y es más que latencia: cuando este trabajo empieza, el
 * reporte y su digest YA ESTÁN GUARDADOS. Un Chromium que falla es una fila `failed` y un
 * reintento; nunca un reporte perdido. Y el reintento produce el MISMO documento, porque
 * parte del payload congelado y no de los datos de hoy.
 *
 * EL RESULTADO SE ESCRIBE SIEMPRE, salga bien o mal. Un intento que no deja fila es un
 * intento que nadie puede ver: el coordinador miraría un reporte sin PDF sin saber si el
 * trabajo todavía no corrió o si falló hace tres días.
 *
 * SIN CRON. Es el primer trabajo del sistema que dispara una persona: se encola desde
 * `ComplianceService.generate` y no desde el calendario.
 */
@Injectable()
export class RenderComplianceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RenderComplianceService.name);

  constructor(
    private readonly db: DbService,
    private readonly jobs: JobsService,
    private readonly renderer: PdfRendererService,
    private readonly storage: ObjectStorageService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work(RENDER_COMPLIANCE_PDF_JOB, async (payload) => {
      await this.run(payload.report_id);
    });
  }

  /**
   * Renderiza el reporte y deja la fila del intento.
   *
   * **Relanza el error después de escribir la fila `failed`**, y el orden importa: la
   * fila es lo que el coordinador ve, y el `throw` es lo que hace que pg-boss reintente.
   * Tragarse el error dejaría el intento visible y sin reintento; no escribir la fila
   * dejaría el reintento sin rastro.
   */
  async run(reportId: string): Promise<void> {
    const report = await this.readReport(reportId);

    if (!report) {
      // Un reporte que no existe no se reintenta: no hay nada que renderizar y el
      // reintento fallaría igual hasta agotar el tope. Se registra y se termina.
      this.logger.warn(`Render pedido para un reporte inexistente: ${reportId}`);
      return;
    }

    // El id del intento se genera ACÁ y no en la base porque es parte de la key del
    // objeto: el archivo se sube antes de que la fila exista, así que la fila tiene que
    // poder decir dónde quedó lo que ya se escribió.
    const renderId = randomUUID();
    const objectKey = deriveComplianceReportKey(report.site_id, report.id, renderId);

    try {
      const pdf = await this.renderer.render({
        payload: report.payload,
        reportId: report.id,
        payloadHash: report.payload_hash,
      });

      await this.storage.putComplianceReport(objectKey, pdf);

      await this.recordRender(report.site_id, {
        id: renderId,
        reportId: report.id,
        outcome: 'succeeded',
        objectKey,
        error: null,
      });

      this.logger.log(`Reporte ${report.id} renderizado en ${objectKey}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.recordRender(report.site_id, {
        id: renderId,
        reportId: report.id,
        outcome: 'failed',
        objectKey: null,
        // Recortado: el mensaje lo lee una persona que decide si reintenta, y un stack
        // de Chromium entero en una celda de la pantalla no ayuda a decidir nada.
        error: message.slice(0, 500),
      });

      this.logger.error(`Falló el render del reporte ${report.id}: ${message}`);

      // Que pg-boss reintente. La fila ya quedó escrita.
      throw error;
    }
  }

  /**
   * El reporte, leído declarando el alcance de TODAS las plantas activas.
   *
   * Es el mismo camino que usan la apertura de período y el escalamiento: un trabajo no
   * tiene sesión detrás, así que declara alcance explícito con `withSiteScope` y deja que
   * la política haga el resto. `site` no lleva RLS —es dato de referencia de la
   * organización— y por eso la lista de plantas se puede leer antes de declarar nada.
   */
  private async readReport(reportId: string): Promise<StoredReport | null> {
    const { rows: sites } = await this.db.unscopedPool.query<{ id: string }>(
      'SELECT id FROM site WHERE deactivated_at IS NULL ORDER BY code',
    );

    const siteIds = sites.map((row) => row.id);
    if (siteIds.length === 0) return null;

    return this.db.withSiteScopeClient({ siteIds, userId: null }, async (client) => {
      const { rows } = await client.query<StoredReport>(
        `SELECT id, site_id, payload, payload_hash
           FROM compliance_report WHERE id = $1::uuid`,
        [reportId],
      );

      return rows[0] ?? null;
    });
  }

  /**
   * La fila del intento, escrita con el alcance de la planta del reporte.
   *
   * `userId` va en `null` a propósito: **el sistema renderizó, no una persona**. La
   * entrada `compliance_report.rendered` que el trigger appendea sale con actor nulo, que
   * es exactamente lo que el registro tiene que decir — la persona ya quedó registrada
   * cuando generó el reporte.
   */
  private async recordRender(siteId: string, render: RenderInput): Promise<void> {
    await this.db.withSiteScopeClient({ siteIds: [siteId], userId: null }, async (client) => {
      await client.query(
        `INSERT INTO compliance_report_render
           (id, report_id, site_id, outcome, object_key, error)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)`,
        [render.id, render.reportId, siteId, render.outcome, render.objectKey, render.error],
      );
    });
  }
}

interface StoredReport {
  id: string;
  site_id: string;
  payload: CompliancePayload;
  payload_hash: string;
}

interface RenderInput {
  id: string;
  reportId: string;
  outcome: 'succeeded' | 'failed';
  objectKey: string | null;
  error: string | null;
}
