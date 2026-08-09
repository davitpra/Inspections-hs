import type { PoolClient } from 'pg';

/**
 * La inspección programada **visible y no cancelada**, o nada.
 *
 * Es la misma pregunta que hacen las tres rutas del paquete de campo y
 * `POST /uploads/presign`, y por eso vive en un solo lugar. Cuatro copias de esta
 * consulta son cuatro lugares donde alguien puede olvidarse de `cancelled_at`, y la
 * tercera copia siempre es la que se olvida.
 *
 * **No hay `WHERE site_id` acá y su ausencia es el punto** (ADR-002): el recorte por
 * planta lo hace la política `hs_apply_site_isolation` sobre la transacción. Una
 * inspección de la otra planta no devuelve cero filas porque se la filtre, sino porque
 * la transacción no la ve. Tiene que correr dentro de `withSessionScope`.
 *
 * Devuelve `null` en los tres casos —no existe, está cancelada, es de otra planta— y esa
 * indistinguibilidad es deliberada: si el llamador pudiera separarlos, la ruta sería un
 * oráculo de qué se inspecciona donde el solicitante no tiene alcance.
 *
 * **Qué error corresponde NO lo decide esta función.** Devuelve el dato o nada; quién la
 * llama decide cómo se queja. Hoy las rutas del paquete de campo responden
 * `inspection_not_found` y `POST /uploads/presign` responde `forbidden`, y esa
 * divergencia está anotada en el diseño de `inspection-field-package-endpoints` (D6):
 * unificarla significa cambiar un comportamiento ya especificado en `offline-capture`, y
 * es un change propio.
 */
export interface ActiveInspection {
  id: string;
  site_id: string;
  template_version_id: string;
}

export async function findActiveInspection(
  client: PoolClient,
  id: string,
): Promise<ActiveInspection | null> {
  const { rows } = await client.query<ActiveInspection>(
    `SELECT id, site_id, template_version_id
       FROM scheduled_inspection
      WHERE id = $1
        AND cancelled_at IS NULL`,
    [id],
  );

  return rows[0] ?? null;
}
