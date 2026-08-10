import { Injectable, NotFoundException } from '@nestjs/common';
import { notificationSchema, type Notification } from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';

/**
 * La bandeja in-app. ADR-011 design D9: no hay correo, así que esto es el canal.
 *
 * Dos cosas que este servicio no hace y no debería: filtrar por planta —lo hace la
 * política de `notification`— y borrar. Una notificación leída queda; `read_at` es lo
 * único que cambia, y el trigger de guarda impide volverla a no leída.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService) {}

  /** Las mías: no leídas primero, y dentro de cada grupo las más recientes. */
  async inbox(session: SessionScope): Promise<Notification[]> {
    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<NotificationRow>(
        `SELECT id, site_id, kind, payload, created_at, read_at
           FROM notification
          WHERE user_id = $1
          ORDER BY (read_at IS NOT NULL), created_at DESC`,
        [session.userId],
      );

      return rows.map(toNotification);
    });
  }

  /**
   * Marca como leída. Idempotente: `read_at` no se pisa si ya estaba, porque
   * releer no es un hecho nuevo y el trigger la dejaría pasar igual.
   */
  async markRead(session: SessionScope, id: string): Promise<Notification> {
    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<NotificationRow>(
        `UPDATE notification
            SET read_at = coalesce(read_at, now())
          WHERE id = $1 AND user_id = $2
        RETURNING id, site_id, kind, payload, created_at, read_at`,
        [id, session.userId],
      );

      const row = rows[0];
      if (!row) throw new NotFoundException('No such notification');

      return toNotification(row);
    });
  }
}

interface NotificationRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  kind: string;
  /**
   * `unknown` y no un tipo concreto: desde la etapa 5 hay cuatro formas posibles y cuál
   * es la de esta fila lo decide `kind`. Afirmar acá que es la del período fue cierto
   * mientras hubo un solo tipo y sería mentira ahora.
   */
  payload: unknown;
  created_at: Date;
  read_at: Date | null;
}

/**
 * La fila, validada contra la unión discriminada del contrato (design D11).
 *
 * **Parsea en vez de castear, y esa es la decisión.** Un `as Notification` haría que un
 * `kind` que la base tiene y el contrato no —una migración a medio desplegar, un
 * `INSERT` a mano— llegue a la bandeja como una tarjeta que no sabe renderizarse. Con
 * el parseo, la lectura falla ruidoso donde alguien lo va a ver.
 */
function toNotification(row: NotificationRow): Notification {
  return notificationSchema.parse({
    id: row.id,
    site_id: row.site_id,
    kind: row.kind,
    payload: row.payload,
    created_at: row.created_at.toISOString(),
    read_at: row.read_at?.toISOString() ?? null,
  });
}
