const configuredBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, '');
const BASE_URL = normalizedBaseUrl.endsWith('/api/v1')
  ? normalizedBaseUrl
  : `${normalizedBaseUrl}/api/v1`;

type AuthTokenProvider = () => Promise<string | null>;

class ApiClient {
  readonly baseUrl = BASE_URL;
  private guestToken: string | null = null;
  private authTokenProvider: AuthTokenProvider | null = null;
  private identityBootstrap: Promise<void> | null = null;

  setAuthTokenProvider(provider: AuthTokenProvider | null): void {
    this.authTokenProvider = provider;
  }

  async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};

    if (this.authTokenProvider) {
      const clerkToken = await this.authTokenProvider();
      if (clerkToken) headers['Authorization'] = `Bearer ${clerkToken}`;
    }

    if (headers.Authorization) return headers;

    const storedGuest =
      this.guestToken ??
      (typeof window !== 'undefined'
        ? localStorage.getItem('kapruka_guest_token')
        : null);

    if (storedGuest) {
      this.guestToken = storedGuest;
      headers['X-Guest-Token'] = storedGuest;
    }

    return headers;
  }

  setGuestToken(token: string): void {
    this.guestToken = token;
    if (typeof window !== 'undefined') localStorage.setItem('kapruka_guest_token', token);
  }

  captureGuestToken(headers: Headers): void {
    const guestToken = headers.get('X-Guest-Token');
    if (guestToken) this.setGuestToken(guestToken);
  }

  private hasIdentity(): boolean {
    if (this.authTokenProvider) return true;
    if (this.guestToken) return true;
    return (
      typeof window !== 'undefined' &&
      localStorage.getItem('kapruka_guest_token') !== null
    );
  }

  /**
   * The backend mints a brand-new guest identity for any request that
   * arrives with no token at all. On a cold session, more than one component
   * fires its first request at roughly the same time (e.g. the sidebar's
   * chat-list fetch alongside a chat page's create/load effect) — if both go
   * out before either has captured a token, the server hands back two
   * different guest identities, and whichever response is captured last
   * silently overwrites the other in storage, permanently orphaning any chat
   * created under the identity that lost the race.
   *
   * Serializing here fixes that at the root: the first tokenless call
   * becomes the sole in-flight "establishing" request, and every other
   * caller waits for it — by the time they proceed, `hasIdentity()` is true
   * and they send the one token it obtained, instead of racing their own.
   */
  private async coordinateIdentity<T>(run: () => Promise<T>): Promise<T> {
    if (this.hasIdentity()) return run();

    if (this.identityBootstrap) {
      await this.identityBootstrap;
      return run();
    }

    let resolveBootstrap!: () => void;
    this.identityBootstrap = new Promise((resolve) => {
      resolveBootstrap = resolve;
    });

    try {
      return await run();
    } finally {
      resolveBootstrap();
      this.identityBootstrap = null;
    }
  }

  async get<T>(path: string): Promise<T> {
    return this.coordinateIdentity(async () => {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: await this.getAuthHeaders(),
      });
      this.captureGuestToken(res.headers);
      if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
      return res.json() as Promise<T>;
    });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.coordinateIdentity(async () => {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await this.getAuthHeaders()),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      this.captureGuestToken(res.headers);
      if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
      return res.json() as Promise<T>;
    });
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.coordinateIdentity(async () => {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(await this.getAuthHeaders()),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      this.captureGuestToken(res.headers);
      if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
      return res.json() as Promise<T>;
    });
  }

  async delete(path: string): Promise<void> {
    return this.coordinateIdentity(async () => {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'DELETE',
        headers: await this.getAuthHeaders(),
      });
      this.captureGuestToken(res.headers);
      if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
      // 204 No Content — nothing to parse.
    });
  }
}

export const apiClient = new ApiClient();
