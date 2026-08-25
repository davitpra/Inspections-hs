import {
  type AcceptInvitationRequest,
  type RefreshResponse,
  type Session,
  type SignInRequest,
  type SignInResponse,
  type TokenPair,
} from '@hs/contracts';

/**
 * ADR-011 — El cliente de sesión, y el gancho del que depende la etapa 3.
 *
 * Lo que este archivo tiene que hacer bien es una sola cosa, y es la que el requisito
 * offline pide: **una entrada de la cola nunca se descarta por un 401**. Todo lo demás
 * —guardar el token, refrescar, reintentar— existe para eso.
 *
 * El almacenamiento se inyecta en vez de asumir `localStorage`: el service worker de
 * la etapa 3 no lo tiene, y el día que el outbox llame a `ensureFreshSession()` desde
 * ahí, este cliente tiene que poder correr sin cambios.
 */

export interface TokenStore {
  read(): Promise<TokenPair | null>;
  write(tokens: TokenPair | null): Promise<void>;
}

/** El resultado de una llamada autenticada, sin excepciones de por medio. */
export type AuthedResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

interface DomainError {
  code: string;
  message: string;
}

export interface SessionClientOptions {
  baseUrl: string;
  store: TokenStore;
  fetch?: typeof globalThis.fetch;
  /**
   * Qué hacer cuando la sesión terminó de verdad. NO recibe nada que se pueda
   * interpretar como "descartá lo que tengas en cola": lo único que corresponde es
   * pedir login de nuevo.
   */
  onSessionEnded?: () => void;
}

/** El almacenamiento por defecto, para el navegador. */
export function localStorageTokenStore(key = 'hs.session'): TokenStore {
  return {
    async read() {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? (JSON.parse(raw) as TokenPair) : null;
    },
    async write(tokens) {
      if (tokens) globalThis.localStorage?.setItem(key, JSON.stringify(tokens));
      else globalThis.localStorage?.removeItem(key);
    },
  };
}

export class SessionClient {
  private readonly fetchImpl: typeof globalThis.fetch;

  /**
   * Un refresh a la vez. Sin esto, tres requests que vencen juntos disparan tres
   * refrescos con el mismo token: dos de ellos llegarían con el token ya gastado y,
   * pasada la ventana de gracia del servidor, la detección de reuso echaría al usuario
   * por hacer las cosas bien.
   */
  private inFlightRefresh: Promise<TokenPair | null> | null = null;

  constructor(private readonly options: SessionClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async signIn(request: SignInRequest): Promise<AuthedResult<Session>> {
    const response = await this.fetchImpl(`${this.options.baseUrl}/auth/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) return failure(await readError(response));

    const body = (await response.json()) as SignInResponse;
    await this.options.store.write(body.tokens);

    return { ok: true, value: body.session };
  }

  /**
   * Aceptar una invitación: el único momento en que se fija una contraseña sin presentar
   * la anterior (ADR-011).
   *
   * Vive acá y no en `api/`, junto a `signIn` y por el mismo motivo: es una llamada SIN
   * autenticar —quien acepta todavía no tiene sesión, su credencial es el token— y los
   * helpers de `api/*.ts` convierten el fallo en `Error(message)`, perdiendo el `code`.
   * Sin el código no hay forma de separar "esta invitación ya no sirve" de "no hubo red".
   *
   * No escribe nada en el `TokenStore`: el servidor responde 204 y aceptar no crea
   * sesión. Después de esto hay que iniciar sesión como cualquier otro día.
   */
  async acceptInvitation(request: AcceptInvitationRequest): Promise<AuthedResult<void>> {
    const response = await this.fetchImpl(`${this.options.baseUrl}/auth/invitations/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) return failure(await readError(response));

    return { ok: true, value: undefined };
  }

  async signOut(): Promise<void> {
    await this.request('/auth/sign-out', { method: 'POST' });
    await this.options.store.write(null);
  }

  /**
   * EL GANCHO DE LA ETAPA 3. El outbox tiene que llamar a esto **antes** de mandar la
   * primera entrada, no después del primer 401.
   *
   * Refrescar antes cuesta un request; descubrirlo después cuesta un reintento por
   * cada entrada de la cola, sobre la red que ADR-010 describe como mala, y con un
   * inspector esperando en la planta.
   *
   * Devuelve `true` si hay credenciales utilizables. Si devuelve `false`, la respuesta
   * correcta es pedir login — **nunca** vaciar ni descartar la cola.
   */
  async ensureFreshSession(): Promise<boolean> {
    const tokens = await this.options.store.read();
    if (!tokens) return false;

    // Con margen: un token que vence en diez segundos vence a mitad del envío.
    const expiresSoon = Date.parse(tokens.accessExpiresAt) - Date.now() < 60_000;
    if (!expiresSoon) return true;

    return (await this.refresh()) !== null;
  }

  /**
   * Una llamada autenticada, con el reintento ya adentro.
   *
   * El contrato con quien la llama es lo importante: si devuelve `ok: false` con
   * `session_ended`, lo que corresponde es pedir login y **conservar** lo que estuviera
   * pendiente. Ningún código de esta unión significa "descartá".
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<AuthedResult<T>> {
    const attempt = async (): Promise<Response> => {
      const tokens = await this.options.store.read();

      return this.fetchImpl(`${this.options.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          ...(tokens ? { authorization: `Bearer ${tokens.accessToken}` } : {}),
        },
      });
    };

    let response = await attempt();

    if (!response.ok) {
      const error = await readError(response);

      // El único caso renovable. Se refresca UNA vez y se reintenta: si el reintento
      // vuelve a fallar, no es un token viejo y seguir insistiendo no arregla nada.
      if (error.code === 'token_expired' && (await this.refresh())) {
        response = await attempt();
      } else {
        if (sessionReallyEnded(response, error)) this.options.onSessionEnded?.();
        return failure(error);
      }
    }

    if (!response.ok) {
      const error = await readError(response);
      if (sessionReallyEnded(response, error)) this.options.onSessionEnded?.();
      return failure(error);
    }

    if (response.status === 204) return { ok: true, value: undefined as T };

    return { ok: true, value: (await response.json()) as T };
  }

  /** El refresh silencioso. Devuelve el par nuevo, o `null` si la sesión terminó. */
  async refresh(): Promise<TokenPair | null> {
    this.inFlightRefresh ??= this.performRefresh().finally(() => {
      this.inFlightRefresh = null;
    });

    return this.inFlightRefresh;
  }

  private async performRefresh(): Promise<TokenPair | null> {
    const tokens = await this.options.store.read();
    if (!tokens) return null;

    const response = await this.fetchImpl(`${this.options.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });

    if (!response.ok) {
      // El token guardado ya no sirve, pero NO se borra nada más que él: lo que el
      // dispositivo tenga en cola es del outbox y no de este cliente.
      await this.options.store.write(null);
      this.options.onSessionEnded?.();
      return null;
    }

    const body = (await response.json()) as RefreshResponse;
    await this.options.store.write(body.tokens);

    return body.tokens;
  }
}

/**
 * Refrescar al recuperar conexión, para que el primer envío diferido salga con un
 * token vivo. Devuelve la función que desuscribe.
 *
 * Se dispara también con `visibilitychange`: un teléfono que estuvo con la pantalla
 * apagada tres horas vuelve sin ningún evento `online`, porque nunca perdió la red —
 * simplemente no la usó.
 */
export function refreshOnReconnect(client: SessionClient): () => void {
  const handler = (): void => {
    void client.ensureFreshSession();
  };

  globalThis.addEventListener?.('online', handler);
  globalThis.addEventListener?.('visibilitychange', handler);

  return () => {
    globalThis.removeEventListener?.('online', handler);
    globalThis.removeEventListener?.('visibilitychange', handler);
  };
}

/**
 * Si esto es de verdad el fin de la sesión, o solo un error que no supimos leer.
 *
 * Un error de dominio puede traer cualquier código del módulo que atendió el request; no
 * se puede castear como un código de auth. Aun cuando diga `session_ended`, solo termina la
 * sesión si el status también es 401. Un `404`, un `502` o una página HTML se reportan como
 * `request_failed` y no sacan al inspector de su recorrido.
 *
 * Ese error se vio de verdad con `POST /inspection-submissions` sin implementar. Por eso
 * se pide la evidencia mínima antes de dar la sesión por terminada: código y status.
 */
function sessionReallyEnded(response: Response, error: DomainError): boolean {
  return error.code === 'session_ended' && response.status === 401;
}

async function readError(response: Response): Promise<DomainError> {
  try {
    const body = (await response.clone().json()) as Partial<DomainError>;

    if (typeof body.code === 'string') {
      return {
        code: body.code,
        message: typeof body.message === 'string' ? body.message : 'Request failed',
      };
    }
  } catch {
    // Cuerpo no-JSON: se cae al default de abajo.
  }

  return { code: 'request_failed', message: `Request failed with ${response.status}` };
}

function failure(error: DomainError): { ok: false; code: string; message: string } {
  return { ok: false, code: error.code, message: error.message };
}
