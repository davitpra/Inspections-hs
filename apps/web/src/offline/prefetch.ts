import {
  locationPackageSchema,
  rosterPackageSchema,
  templateVersionPackageSchema,
} from '@hs/contracts';

import { sessionClient } from '../api/client';
import type { SessionClient } from '../auth/session-client';
import { db, type OfflineDatabase, type PrefetchKind, type PrefetchPayload } from './db';

/**
 * La descarga previa: lo que el dispositivo tiene que tener guardado ANTES de perder
 * señal.
 *
 * Son tres cosas y las tres tienen que estar: el documento congelado de la
 * `template_version` a la que la inspección está atada, el catálogo cerrado de
 * ubicaciones de su planta, y el subconjunto activo del roster. Falta cualquiera y la
 * inspección no está lista para el campo — y eso se muestra mientras todavía hay red,
 * que es el único momento en el que se puede arreglar.
 *
 * Los tres esquemas de respuesta vienen de `@hs/contracts` y no se definen acá: son el
 * mismo objeto contra el que `apps/api` responde, así que un desajuste entre las dos
 * mitades es un error de `pnpm typecheck` y no un `safeParse` que falla en una planta.
 */

/** Las tres, en el orden en que se piden. Un fallo parcial deja las que sí bajaron. */
export const PREFETCH_KINDS: readonly PrefetchKind[] = [
  'template_version',
  'locations',
  'roster',
];

export interface PrefetchResult {
  scheduled_inspection_id: string;
  stored: PrefetchKind[];
  missing: PrefetchKind[];
  /** Por `kind` que falló, el motivo. Lo que la pantalla nombra. */
  errors: Partial<Record<PrefetchKind, string>>;
}

export interface PrefetchOptions {
  database?: OfflineDatabase;
  client?: SessionClient;
}

/**
 * Baja las tres piezas y escribe una fila de `prefetch` por cada una que llegó.
 *
 * Cada `kind` se escribe apenas llega, y no las tres al final: un roster que falla no
 * tiene por qué costar la descarga del documento, que es la más cara. Volver a correr
 * esto con red completa lo que falte, sin re-bajar lo que ya está.
 */
export async function prefetchInspection(
  scheduledInspectionId: string,
  options: PrefetchOptions = {},
): Promise<PrefetchResult> {
  const database = options.database ?? db;
  const client = options.client ?? sessionClient;

  const stored: PrefetchKind[] = [];
  const errors: Partial<Record<PrefetchKind, string>> = {};

  const attempts: [PrefetchKind, () => Promise<PrefetchPayload>][] = [
    [
      'template_version',
      async () => {
        const body = await fetchJson(
          client,
          `/scheduled-inspections/${scheduledInspectionId}/template-version`,
        );
        const parsed = templateVersionPackageSchema.parse(body);

        return { kind: 'template_version', ...parsed };
      },
    ],
    [
      'locations',
      async () => {
        const body = await fetchJson(
          client,
          `/scheduled-inspections/${scheduledInspectionId}/locations`,
        );

        return { kind: 'locations', locations: locationPackageSchema.parse(body) };
      },
    ],
    [
      'roster',
      async () => {
        const body = await fetchJson(
          client,
          `/scheduled-inspections/${scheduledInspectionId}/roster`,
        );

        return { kind: 'roster', people: rosterPackageSchema.parse(body) };
      },
    ],
  ];

  for (const [kind, run] of attempts) {
    try {
      const payload = await run();

      await database.prefetch.put({
        scheduled_inspection_id: scheduledInspectionId,
        kind,
        payload,
        fetched_at: new Date().toISOString(),
      });

      stored.push(kind);
    } catch (error) {
      errors[kind] = error instanceof Error ? error.message : String(error);
    }
  }

  const missing = PREFETCH_KINDS.filter((kind) => !stored.includes(kind));

  return { scheduled_inspection_id: scheduledInspectionId, stored, missing, errors };
}

/** Qué falta para poder salir a recorrer. Vacío significa lista. */
export async function missingForField(
  scheduledInspectionId: string,
  database: OfflineDatabase = db,
): Promise<PrefetchKind[]> {
  const rows = await database.prefetch
    .where('scheduled_inspection_id')
    .equals(scheduledInspectionId)
    .toArray();

  const present = new Set(rows.map((row) => row.kind));

  return PREFETCH_KINDS.filter((kind) => !present.has(kind));
}

/**
 * "Lista para el campo" = las tres presentes. No es un booleano que alguien fija: se
 * deriva de lo que hay guardado, y por eso no puede quedar en `true` cuando el
 * documento se borró.
 */
export async function isFieldReady(
  scheduledInspectionId: string,
  database: OfflineDatabase = db,
): Promise<boolean> {
  return (await missingForField(scheduledInspectionId, database)).length === 0;
}

/**
 * El documento congelado, tal como se bajó.
 *
 * **Esto NO vuelve a pedir nada al servidor, y esa es la garantía entera**: publicar
 * la versión `3` de la plantilla no cambia lo que el dispositivo interpreta para una
 * inspección atada a la `2`. La versión se congela al programar y el dispositivo la
 * respeta porque lee de acá y de ningún otro lado.
 */
export async function storedTemplateVersion(
  scheduledInspectionId: string,
  database: OfflineDatabase = db,
): Promise<Extract<PrefetchPayload, { kind: 'template_version' }> | null> {
  const row = await database.prefetch.get([scheduledInspectionId, 'template_version']);

  return row?.payload.kind === 'template_version' ? row.payload : null;
}

export async function storedLocations(
  scheduledInspectionId: string,
  database: OfflineDatabase = db,
): Promise<Extract<PrefetchPayload, { kind: 'locations' }>['locations']> {
  const row = await database.prefetch.get([scheduledInspectionId, 'locations']);

  return row?.payload.kind === 'locations' ? row.payload.locations : [];
}

export async function storedRoster(
  scheduledInspectionId: string,
  database: OfflineDatabase = db,
): Promise<Extract<PrefetchPayload, { kind: 'roster' }>['people']> {
  const row = await database.prefetch.get([scheduledInspectionId, 'roster']);

  return row?.payload.kind === 'roster' ? row.payload.people : [];
}

async function fetchJson(client: SessionClient, path: string): Promise<unknown> {
  const result = await client.request<unknown>(path);

  // Un `401` que no se pudo renovar llega acá como `session_ended`. La descarga previa
  // FALLA, que es lo correcto —no hay nada que guardar—, pero no descarta nada: no hay
  // borrador todavía, y si lo hubiera, no es asunto de esta función.
  if (!result.ok) throw new Error(`${path}: ${result.message}`);

  return result.value;
}
