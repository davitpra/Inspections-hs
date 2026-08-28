import type { LocationOption, PersonOption } from '@hs/contracts';
import type { TemplateDocument } from '@hs/forms';
import Dexie, { type EntityTable, type Table } from 'dexie';

/**
 * Design D5 — El almacén local. Cinco tablas, y el blob vive con la foto.
 *
 * ADR-001: esto NO es una réplica ni un motor de sincronización. Es un borrador con
 * dueño único que se convierte en un envío y muere. Nada de acá converge con nada del
 * servidor: se envía una vez, el servidor acepta, y la fila se borra.
 */

/** Qué baja la descarga previa. Las tres tienen que estar para salir a recorrer. */
export type PrefetchKind = 'template_version' | 'locations' | 'roster';

export type DraftStatus =
  /** Se está capturando. */
  | 'capturing'
  /** Completada y firmada; espera en el outbox. */
  | 'signed'
  /** El servidor la aceptó. La inspección queda cerrada y de solo lectura. */
  | 'accepted';

export type UploadState = 'pending' | 'uploaded' | 'failed';

/**
 * De qué es la foto (etapa 4).
 *
 * `answer` es la respuesta de un ítem de tipo `photo`; `finding` es la foto obligatoria
 * del hallazgo que derivó una respuesta negativa. **Tienen que distinguirse aunque
 * compartan `item_key`**: las de `answer` viajan en `photos` del envío y las de
 * `finding` en `findings[item_key].photo_object_keys`. Si las de un hallazgo cayeran en
 * `photos`, chocarían con la respuesta booleana del mismo ítem y el servidor rechazaría
 * el envío por colisión — que es exactamente lo que `mergePhotoAnswers` detecta.
 */
export type PhotoKind = 'answer' | 'finding';

export type OutboxState =
  | 'queued'
  /** Un `4xx` de validación. No se reintenta; se muestra con el motivo del servidor. */
  | 'rejected';

export interface DraftRow {
  /**
   * D4 — `client_submission_id` ES la clave primaria de la fila, no un campo que se
   * agrega al enviar. Un identificador que es la clave primaria no se puede regenerar
   * por accidente en un `put`, y no existe un camino de código donde el borrador
   * exista sin él.
   */
  client_submission_id: string;
  scheduled_inspection_id: string;
  /** Quién es el dueño. Un borrador de la cuenta A no se le lista a la cuenta B. */
  account_id: string;
  site_id: string;
  /** La versión CONGELADA. No se recalcula al reconectar. */
  template_version_id: string;
  created_at: string;
  updated_at: string;
  /** Dónde estaba el inspector. Reabrir vuelve acá. */
  current_item_key: string | null;
  status: DraftStatus;
  signed_at: string | null;
}

export interface AnswerRow {
  client_submission_id: string;
  item_key: string;
  value: unknown;
  answered_at: string;
}

export interface PhotoRow {
  id: string;
  client_submission_id: string;
  item_key: string;
  /**
   * Los bytes viven acá y no en el sistema de archivos: IndexedDB los almacena
   * nativamente y `navigator.storage.persist()` los cubre. Se conservan después de
   * subir para que el borrador se pueda ver sin red.
   *
   * `ArrayBuffer` y no `Blob`, con su `content_type` al lado. Un `Blob` es
   * estructurado-clonable en un navegador de verdad, pero no en la implementación de
   * IndexedDB con la que corre la suite, y una foto que solo se puede probar a mano es
   * una foto que se pierde sin que nadie se entere. El `Blob` se reconstruye donde se
   * usa —`photoBlob()`—, que es un constructor y no una conversión.
   */
  bytes: ArrayBuffer;
  content_type: string;
  kind: PhotoKind;
  object_key: string | null;
  upload_state: UploadState;
  attempts: number;
  last_error: string | null;
  captured_at: string;
}

/**
 * Los detalles del hallazgo de una respuesta negativa (requisitos §3 R2, etapa 4).
 *
 * Una fila por `item_key`, con la misma clave compuesta que `answers` y por el mismo
 * motivo: corregir la descripción es un `put` y no un borrar-e-insertar. Las fotos NO
 * están acá —viven en `photos` con `kind: 'finding'`— porque una foto es bytes y estas
 * filas se leen enteras en cada pantalla.
 *
 * `description` y `location_id` pueden estar vacíos mientras el inspector escribe: la
 * fila existe desde que la respuesta se vuelve negativa. Lo que no puede quedar
 * incompleto es el borrador al firmar, y de eso se ocupa `incompleteFindings`.
 */
export interface FindingDraftRow {
  client_submission_id: string;
  item_key: string;
  description: string;
  location_id: string | null;
  updated_at: string;
}

export interface OutboxRow {
  client_submission_id: string;
  state: OutboxState;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  /**
   * D3 — El lock. Vive en la fila y no en una variable de módulo: una bandera en
   * memoria protege contra dos llamadas del mismo contexto y contra nada más.
   */
  sending_since: number | null;
  lock_owner: string | null;
}

export type PrefetchPayload =
  | {
      kind: 'template_version';
      site_id: string;
      template_version_id: string;
      version: number;
      document: TemplateDocument;
      /**
       * Opcional a propósito, y NO por descuido: el contrato lo manda siempre, pero un
       * dispositivo que descargó antes de que este campo existiera tiene el payload
       * guardado sin él. Ese caso se trata como "no se sabe" y no como "sin inspector" —
       * ver `captureEligibility` en `drafts.ts`.
       */
      inspector_id?: string | null;
      /**
       * Opcional por el mismo motivo que `inspector_id`, y con la misma consecuencia
       * acotada: un paquete bajado antes de que el campo existiera no tiene cómo nombrar
       * la plantilla, y el encabezado de la captura muestra solo la fecha hasta que se
       * vuelva a descargar — ver `draftSubtitle`.
       */
      template_name?: string;
    }
  | { kind: 'locations'; locations: LocationOption[] }
  | { kind: 'roster'; people: PersonOption[] };

export interface PrefetchRow {
  scheduled_inspection_id: string;
  kind: PrefetchKind;
  payload: PrefetchPayload;
  fetched_at: string;
}

/** Los bytes guardados, otra vez como `Blob`: para mostrarlos y para subirlos. */
export function photoBlob(photo: Pick<PhotoRow, 'bytes' | 'content_type'>): Blob {
  return new Blob([photo.bytes], { type: photo.content_type });
}

/** El par de tokens de sesión, guardado acá y no en `localStorage` (D10). */
export interface TokenRow {
  id: string;
  value: unknown;
}

export class OfflineDatabase extends Dexie {
  drafts!: EntityTable<DraftRow, 'client_submission_id'>;
  /** Clave compuesta `[client_submission_id+item_key]`: `Table`, no `EntityTable`. */
  answers!: Table<AnswerRow, [string, string]>;
  photos!: EntityTable<PhotoRow, 'id'>;
  /** Clave compuesta `[client_submission_id+item_key]`, igual que `answers`. */
  findings!: Table<FindingDraftRow, [string, string]>;
  outbox!: EntityTable<OutboxRow, 'client_submission_id'>;
  prefetch!: Table<PrefetchRow, [string, PrefetchKind]>;
  tokens!: EntityTable<TokenRow, 'id'>;

  constructor(name = 'hs-offline') {
    super(name);

    /**
     * El esquema nace en la versión `1` y se declara explícitamente para que la
     * primera evolución tenga a qué encadenarse. Un dispositivo con un borrador
     * adentro no puede permitirse una base recreada: la migración es lo que separa un
     * rollback de una pérdida de datos.
     */
    this.version(1).stores({
      drafts: 'client_submission_id, scheduled_inspection_id, account_id, status, created_at',
      // Compuesta: la respuesta se identifica por su borrador y su ítem, y esa es la
      // clave que hace que reescribir una respuesta sea un `put` y no un borrar-e-insertar.
      answers: '[client_submission_id+item_key], client_submission_id',
      photos: 'id, client_submission_id, [client_submission_id+item_key], upload_state',
      outbox: 'client_submission_id, state, next_attempt_at',
      prefetch: '[scheduled_inspection_id+kind], scheduled_inspection_id',
      tokens: 'id',
    });

    /**
     * Versión 2 (etapa 4): los hallazgos.
     *
     * La migración es lo que la versión 1 dejó preparado. Un dispositivo con un
     * borrador a medio recorrer no puede permitirse una base recreada, así que las
     * fotos que ya existen se marcan como `answer`: son de un ítem de tipo `photo`,
     * porque hasta esta versión no había otra clase.
     */
    this.version(2)
      .stores({
        findings: '[client_submission_id+item_key], client_submission_id',
      })
      .upgrade(async (transaction) =>
        transaction
          .table<PhotoRow>('photos')
          .toCollection()
          .modify((photo) => {
            photo.kind = 'answer';
          }),
      );
  }
}

/**
 * La instancia de la aplicación. Los tests construyen la suya con un nombre propio:
 * un módulo con una base compartida es un test que contamina al siguiente.
 */
export const db = new OfflineDatabase();
