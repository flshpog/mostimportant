// Talks to the board server. In dev it defaults to a server on this machine;
// override with VITE_BOARD_API (e.g. in apps/web/.env.local).
export const API_BASE: string =
  import.meta.env.VITE_BOARD_API ?? (import.meta.env.DEV ? "http://localhost:8787" : "https://board.fiovivor.org");

const TOKEN_KEY = "everest-board-token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode etc: login just won't persist across reloads
  }
}

export const loginUrl = () => `${API_BASE}/auth/login`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, "offline", "Can't reach the board server.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? `Request failed (${res.status}).`);
  return data as T;
}
