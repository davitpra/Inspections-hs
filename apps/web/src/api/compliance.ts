import {
  complianceReportSchema,
  complianceReportSummarySchema,
  complianceViewSchema,
  type ComplianceReport,
  type ComplianceReportSummary,
  type ComplianceView,
} from '@hs/contracts';
import { z } from 'zod';

import { get, send } from './request';

/**
 * El cliente del reporte de cumplimiento (etapa 7, §3 R5).
 *
 * Lo que vuelve se parsea contra el contrato (ver `request.ts`). Acá importa más que en
 * ninguna otra pantalla: lo que se muestra es evidencia regulatoria, y un campo que el
 * servidor tenga y el cliente no —una migración a medio desplegar— tiene que fallar donde
 * alguien lo ve, y no como un documento que se renderiza a medias.
 *
 * **ONLINE, y fuera de Dexie y del service worker**, igual que la recurrencia. Un reporte
 * de cumplimiento se genera sentado, con conexión, para imprimirlo o mandarlo. Guardarlo
 * offline además guardaría una copia del payload cuyo digest nadie recomputó, que es
 * exactamente la clase de copia que este change existe para no tener.
 */

export interface ComplianceRange {
  siteId: string;
  rangeStart: string;
  rangeEnd: string;
}

/** La cobertura al vuelo. No congela nada y no trae digest. */
export async function getCoverage(range: ComplianceRange): Promise<ComplianceView> {
  const query = new URLSearchParams({
    site_id: range.siteId,
    range_start: range.rangeStart,
    range_end: range.rangeEnd,
  });

  return get(`/reports/compliance?${query}`, (value) => complianceViewSchema.parse(value));
}

/** Los reportes ya generados de la planta, del más reciente al más viejo. */
export async function listReports(siteId: string): Promise<ComplianceReportSummary[]> {
  const query = new URLSearchParams({ site_id: siteId });

  return get(`/reports/compliance/list?${query}`, (value) =>
    z.array(complianceReportSummarySchema).parse(value),
  );
}

/**
 * Congela un reporte.
 *
 * Devuelve el reporte con su digest y SIN render: el PDF llega después, por el trabajo de
 * pg-boss. La pantalla tiene que poder mostrar esa espera en vez de fingir que el archivo
 * ya está.
 *
 * Esta llamada estaba escrita a mano y era la única sin `content-type`, así que el body
 * viajaba como `text/plain`, Nest no lo parseaba y el servidor contestaba 400 con los tres
 * campos en `undefined`: generar un reporte no funcionaba. Pasar por `send` es la
 * corrección — ver `request.ts`.
 */
export async function generateReport(range: ComplianceRange): Promise<ComplianceReport> {
  return send(
    'POST',
    '/reports/compliance',
    {
      site_id: range.siteId,
      range_start: range.rangeStart,
      range_end: range.rangeEnd,
    },
    (value) => complianceReportSchema.parse(value),
  );
}

/**
 * La URL firmada para bajar el PDF.
 *
 * DOS PASOS Y NO UNO: primero se pide la URL —con el token de la sesión, que es lo que
 * autoriza— y después el navegador abre esa URL contra el bucket. Un `<a href>` directo
 * al endpoint llegaría sin el header `Authorization` y comería un 401; y el PDF, en
 * cualquier caso, no pasa por la API.
 *
 * La URL expira en minutos, así que se pide en el momento del clic y no al pintar la
 * lista.
 */
export async function getDownloadUrl(reportId: string): Promise<string> {
  return get(
    `/reports/compliance/${reportId}/pdf`,
    (value) =>
      z.object({ url: z.url(), expires_at: z.iso.datetime({ offset: true }) }).parse(value).url,
  );
}
