import { OfflineDatabase } from '../offline/db';

/**
 * Una base por test, con nombre propio. Una base compartida entre archivos es un test
 * que ensucia al siguiente, y el síntoma —un borrador que aparece donde no se creó— es
 * exactamente el bug que la suite tendría que estar buscando.
 */
export function freshDatabase(): OfflineDatabase {
  return new OfflineDatabase(`hs-offline-test-${crypto.randomUUID()}`);
}

/**
 * Cerrar y reabrir la MISMA base. Es lo que este proyecto llama "cerrar la
 * aplicación": el proceso muere, IndexedDB queda en disco, y al volver tiene que estar
 * todo. Reabrir con el mismo nombre es la parte que importa.
 */
export async function reopen(database: OfflineDatabase): Promise<OfflineDatabase> {
  const { name } = database;
  database.close();

  const reopened = new OfflineDatabase(name);
  await reopened.open();

  return reopened;
}
