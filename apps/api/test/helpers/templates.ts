import type { TemplateDocument, TemplateSection } from '@hs/contracts';
import type { Pool } from 'pg';

import { inScope, one } from './postgres';

/**
 * Helpers para publicar plantillas en los tests de integración.
 *
 * Todo corre con el pool que reciban: las tablas de plantilla no llevan `site_id`
 * ni política RLS —son datos de referencia de la organización— así que no hace
 * falta declarar alcance de sitio. `inScope` con una lista vacía simplemente no
 * declara ninguno.
 */

/** Crea una plantilla y devuelve su id. */
export async function createTemplate(pool: Pool, key: string, name = key): Promise<string> {
  const rows = await inScope<{ id: string }>(
    pool,
    [],
    'INSERT INTO template (key, name) VALUES ($1, $2) RETURNING id',
    [key, name],
  );

  return one(rows).id;
}

/** Registra los conceptos. Sin esto, publicar una versión falla por la FK. */
export async function registerItems(
  pool: Pool,
  templateId: string,
  itemKeys: readonly string[],
  options: { replacesItemKey?: string } = {},
): Promise<void> {
  for (const itemKey of itemKeys) {
    await inScope(
      pool,
      [],
      'INSERT INTO template_item (item_key, template_id, replaces_item_key) VALUES ($1, $2, $3)',
      [itemKey, templateId, options.replacesItemKey ?? null],
    );
  }
}

/** Publica una versión y devuelve su id. El trigger deriva las filas de ítem. */
export async function publishVersion(
  pool: Pool,
  templateId: string,
  version: number,
  document: TemplateDocument,
): Promise<string> {
  const rows = await inScope<{ id: string }>(
    pool,
    [],
    `INSERT INTO template_version (template_id, version, document)
     VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [templateId, version, JSON.stringify(document)],
  );

  return one(rows).id;
}

/** Una sección de un solo ítem — la forma que usa casi todo test de identidad. */
export function sectionWith(
  section: Pick<TemplateSection, 'section_key' | 'section_title'>,
  item: TemplateSection['items'][number],
): TemplateSection {
  return { ...section, position: 1, items: [item] };
}

/** La fila derivada de un `item_key` dentro de una versión. */
export async function itemRow(
  pool: Pool,
  templateVersionId: string,
  itemKey: string,
): Promise<VersionItemRow> {
  const rows = await inScope<VersionItemRow>(
    pool,
    [],
    `SELECT id, item_key, section_key, section_title, "position", prompt, response_type, required
       FROM template_version_item
      WHERE template_version_id = $1 AND item_key = $2`,
    [templateVersionId, itemKey],
  );

  return one(rows);
}

export interface VersionItemRow extends Record<string, unknown> {
  id: string;
  item_key: string;
  section_key: string;
  section_title: string;
  position: number;
  prompt: string;
  response_type: string;
  required: boolean;
}
