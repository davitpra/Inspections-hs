/**
 * La configuración de CORS, aparte de `main.ts` para poder probarla.
 *
 * `main.ts` ejecuta `bootstrap()` al importarse —abre la base y escucha un puerto—, así
 * que un test que quisiera leer esta lista desde ahí levantaría la aplicación entera. Con
 * el archivo separado, `cors.spec.ts` la importa y no arranca nada.
 *
 * La PWA se sirve como archivos estáticos y la API es otro proceso: son dos orígenes
 * distintos, y sin CORS el dispositivo no puede llamar a ninguna ruta. `apps/web` ya está
 * construido así —`VITE_API_BASE_URL` apunta a otro host— así que esto no es una concesión
 * al desarrollo local sino la configuración que el despliegue necesita.
 */

/**
 * Los verbos que el preflight puede autorizar.
 *
 * TIENE QUE INCLUIR TODO VERBO QUE UN CONTROLLER MAPEE, y `cors.spec.ts` lo comprueba
 * leyendo los decoradores de todos los controllers.
 *
 * Ese test existe por un caso real. `PUT` llegó con el guardado de un borrador de
 * plantilla y no se agregó acá: el navegador manda un `OPTIONS` de preflight antes de
 * cualquier `PUT`, la respuesta no lo listaba, y el `fetch` moría con «Failed to fetch»
 * —un error de red, sin status y sin cuerpo, que no se parece en nada a la ruta que lo
 * causó—. No lo atrapó nada, y no es casualidad: los tests de `apps/web` mockean el módulo
 * de API y los de integración llaman al servicio directo, así que **ninguno atraviesa una
 * capa CORS**. La comprobación tenía que ser sobre esta lista.
 */
export const CORS_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

/**
 * **Lista blanca explícita, nunca `*`.** Un comodín acá le daría a cualquier página del
 * navegador del inspector permiso para hablarle a la API con su sesión. El token viaja en
 * el header `Authorization` y no en una cookie, así que `credentials` queda en `false`: no
 * hay nada que el navegador deba adjuntar solo.
 */
export function allowedOrigins(): string[] {
  const configured = process.env.WEB_ORIGINS;

  if (configured) return configured.split(',').map((origin) => origin.trim());

  // Sin configurar: solo el servidor de desarrollo de Vite. Un despliegue que no declare
  // `WEB_ORIGINS` deja de responderle a su propia PWA, que es un fallo ruidoso y por lo
  // tanto preferible a un comodín silencioso.
  return ['http://localhost:5173', 'http://localhost:4173'];
}
