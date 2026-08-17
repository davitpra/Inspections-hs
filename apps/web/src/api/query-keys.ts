import type { RecurrenceGrouping } from '@hs/contracts';

/**
 * Las claves de caché de TanStack Query, en un solo lugar.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. Una `queryKey` mal escrita **no rompe nada**: la consulta
 * se hace igual, la invalidación simplemente no encuentra a quién invalidar, y lo que se
 * ve es una pantalla que no se actualizó después de guardar. No hay excepción, no hay
 * error en consola, y el diagnóstico exige leer dos archivos distintos —el que consulta y
 * el que invalida— y notar que las tuplas no coinciden. Es el fallo más barato de
 * introducir y el más caro de encontrar que tiene esta aplicación.
 *
 * LA FORMA IMPORTA MÁS QUE EL ARCHIVO. Cada entrada con argumentos opcionales devuelve el
 * **prefijo** cuando se la llama sin ellos, así que consultar e invalidar usan la misma
 * función y no dos literales parecidos:
 *
 *     useQuery({ queryKey: queryKeys.draft(id, account?.userId), … })
 *     queryClient.invalidateQueries({ queryKey: queryKeys.draft(id) })
 *
 * Eso es exactamente lo que ya se hacía a mano —`['draft', id, userId]` consultado,
 * `['draft', id]` invalidado— pero ahora la relación entre los dos es una firma y no una
 * coincidencia que hay que sostener a ojo.
 *
 * `undefined` se recorta en vez de viajar dentro de la clave. Todas las consultas que
 * pasan un argumento opcional están además detrás de un `enabled`, así que la clave corta
 * nunca llega a disparar una consulta a medias: solo la deja donde la invalidación la
 * encuentra.
 */

/**
 * Recorta los argumentos ausentes. Filtra `undefined` en cualquier posición y no solo al
 * final, que es lo que hay que saber para no agregar una clave con un hueco en el medio:
 * el orden de una clave es su jerarquía, y un hueco la desalinearía en silencio.
 */
function key(...parts: readonly (string | number | undefined)[]): readonly (string | number)[] {
  return parts.filter((part): part is string | number => part !== undefined);
}

export const queryKeys = {
  // Catálogo — lo que convierte identificadores en nombres.
  sites: () => key('sites'),
  templates: () => key('templates'),

  // Inspecciones: programación y campo.
  pendingInspections: () => key('pending-inspections'),
  scheduledInspections: () => key('scheduled-inspections'),
  inspectionSchedules: () => key('inspection-schedules'),
  inspectorCandidates: (siteId?: string) => key('inspector-candidates', siteId),
  fieldReady: (scheduledInspectionId?: string) => key('field-ready', scheduledInspectionId),
  locations: (scheduledInspectionId?: string) => key('locations', scheduledInspectionId),
  /** El paquete de campo guardado localmente, solo para leer su `inspector_id`. */
  storedTemplateVersion: (scheduledInspectionId?: string) =>
    key('stored-template-version', scheduledInspectionId),
  /**
   * El documento pedido POR RED, para la vista previa de una asignación que no está
   * descargada. Clave distinta de `storedTemplateVersion` a propósito: esa lee del
   * dispositivo y nunca sale a la red, y confundirlas convertiría una lectura offline
   * garantizada en una llamada.
   */
  templateVersionPackage: (scheduledInspectionId?: string) =>
    key('template-version-package', scheduledInspectionId),

  /**
   * El borrador de ESTE dispositivo y ESTA cuenta (ADR-001: un dueño, un dispositivo).
   * La cuenta va en la clave y no solo en la consulta: dos cuentas en el mismo teléfono
   * no pueden compartir caché de borrador.
   */
  draft: (scheduledInspectionId: string, userId?: string) =>
    key('draft', scheduledInspectionId, userId),
  /**
   * EL MISMO BORRADOR, PERO NO LA MISMA CONSULTA. `CaptureRoute` no lee el borrador: lo
   * ABRE —`openDraft` es un efecto— y puede negarse, así que su dato es un envoltorio
   * (`{ kind: 'loaded' | 'refused' }`) y no el borrador pelado que devuelve `loadDraft`.
   *
   * Compartir clave con `draft()` hacía que al pasar de la captura a la revisión la
   * segunda pantalla recibiera el envoltorio de la primera y leyera `.draft` de algo que
   * no lo tiene. Dos formas de dato distintas no pueden vivir en la misma entrada de
   * caché, aunque describan la misma fila.
   *
   * El marcador va DESPUÉS del identificador para no romper el prefijo: `draft(id)`
   * sigue invalidando esta consulta y la otra de una sola vez.
   */
  captureDraft: (scheduledInspectionId: string, userId?: string) =>
    key('draft', scheduledInspectionId, 'capture', userId),
  drafts: (userId?: string) => key('drafts', userId),
  document: (clientSubmissionId?: string) => key('document', clientSubmissionId),
  /** La cola es del dueño de sus borradores, y por eso la cuenta va en la clave. */
  outbox: (userId?: string) => key('outbox', userId),

  // Acciones correctivas y bandeja.
  actions: () => key('actions'),
  action: (id?: string) => key('action', id),
  notifications: () => key('notifications'),

  // Incidentes.
  incidents: () => key('incidents'),
  incident: (id?: string) => key('incident', id),
  form7: (incidentId?: string) => key('form7', incidentId),

  // Roster.
  roster: (siteId?: string) => key('roster', siteId),
  account: (userId?: string) => key('account', userId),

  // Reportes.
  recurrence: (windowMonths?: number, groupBy?: RecurrenceGrouping) =>
    key('recurrence', windowMonths, groupBy),

  /**
   * El cumplimiento se ramifica: la cobertura al vuelo y los reportes ya congelados son
   * dos cosas distintas de la misma planta. `compliance()` invalida las dos.
   */
  compliance: () => key('compliance'),
  complianceCoverage: (siteId?: string, rangeStart?: string, rangeEnd?: string) =>
    key('compliance', 'coverage', siteId, rangeStart, rangeEnd),
  complianceReports: (siteId?: string) => key('compliance', 'reports', siteId),
} as const;
