const configuredBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, '');
const BASE_URL = normalizedBaseUrl.endsWith('/api/v1')
  ? normalizedBaseUrl
  : `${normalizedBaseUrl}/api/v1`;

interface ClerkWindow extends Window {
  __clerk_session_token?: string;
}

class ApiClient {
  readonly baseUrl = BASE_URL;
  private guestToken: string | null = null;

  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    // Clerk session token (set by Clerk's useAuth hook on client)
    if (typeof window !== 'undefined') {
      const clerkToken = (window as ClerkWindow).__clerk_session_token;
      if (clerkToken) headers['Authorization'] = `Bearer ${clerkToken}`;
    }
    // Guest token (stored in localStorage)
    const storedGuest = this.guestToken ??
      (typeof window !== 'undefined' ? localStorage.getItem('kapruka_guest_token') : null);
    if (storedGuest) headers['X-Guest-Token'] = storedGuest;
    return headers;
  }

  setGuestToken(token: string) {
    this.guestToken = token;
    if (typeof window !== 'undefined') localStorage.setItem('kapruka_guest_token', token);
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, { headers: this.getAuthHeaders() });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
    // Capture guest token from response header
    const guestToken = res.headers.get('X-Guest-Token');
    if (guestToken) this.setGuestToken(guestToken);
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json();
  }
}

export const apiClient = new ApiClient();
