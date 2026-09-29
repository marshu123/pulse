/**
 * Typed API client.
 *
 * The token is kept in memory plus localStorage so a refresh does not sign the
 * user out. It is a demo project, not a bank; a real deployment would prefer an
 * httpOnly cookie.
 */

const TOKEN_KEY = 'pulse.token';

/**
 * Request paths in this file already start with `/api`, so VITE_API_URL must be
 * the bare origin. Normalise it here rather than trusting the deploy config:
 *
 *   https://host        -> https://host
 *   https://host/       -> https://host        (trailing slash would 404)
 *   https://host/api    -> https://host        (would become /api/api/...)
 *   ""                  -> ""                  (dev: Vite proxies /api)
 */
export function normaliseBase(raw: string | undefined): string {
  if (!raw) return '';

  const trimmed = raw.trim().replace(/\/+$/, '');
  if (/\/api$/i.test(trimmed)) {
    return trimmed.slice(0, -4);
  }
  return trimmed;
}

export const BASE = normaliseBase(import.meta.env.VITE_API_URL);

export type User = {
  id: number;
  email: string;
  created_at: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

export type MonitorSummary = {
  monitor_id: number;
  name: string;
  url: string;
  active: boolean;
  total_checks: number;
  successful_checks: number;
  uptime_percent: number | null;
  last_status: 'up' | 'down' | null;
  last_checked_at: string | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  in_incident: boolean;
};

export type SeriesPoint = {
  checked_at: string;
  latency_ms: number | null;
  ok: boolean;
  status_code: number | null;
};

export type Series = {
  monitor_id: number;
  window: string;
  uptime_percent: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  total_checks: number;
  points: SeriesPoint[];
};

/** The API answered with a non-2xx status and a JSON error body. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never completed: DNS, TLS, CORS, offline, or a blocked host. */
export class NetworkError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Something answered, but not the API. A login redirect, a proxy error page or
 * a WAF block all look like this, and they are not the same as being offline.
 */
export class UnexpectedResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly contentType: string | null,
    readonly bodyPreview: string
  ) {
    super(message);
    this.name = 'UnexpectedResponseError';
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private browsing, storage unavailable */
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch (cause) {
    // fetch only rejects when the request never completed, so this is a real
    // connectivity or CORS problem rather than a bad response.
    throw new NetworkError(
      `Could not reach ${BASE || 'the API'}. Check your connection, that the API is running, and that CORS allows this origin.`,
      cause
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const contentType = response.headers.get('content-type');

  if (text) {
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      // Something answered, but it was not the API. Say so, rather than
      // reporting this as though the API were unreachable.
      throw new UnexpectedResponseError(
        `Expected JSON from ${BASE}${path} but got ${contentType ?? 'no content-type'} (status ${response.status}). This usually means the request reached something other than the API, such as a login redirect or a proxy error page.`,
        response.status,
        contentType,
        text.slice(0, 140)
      );
    }

    if (!response.ok) {
      const detail =
        body && typeof body === 'object' && 'detail' in body
          ? String((body as { detail: unknown }).detail)
          : `Request failed (${response.status})`;
      throw new ApiError(detail, response.status);
    }

    return body as T;
  }

  if (!response.ok) {
    throw new ApiError(`Request failed (${response.status})`, response.status);
  }

  return undefined as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<TokenResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<TokenResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  monitors: () => request<MonitorSummary[]>('/api/monitors'),

  createMonitor: (input: {
    name: string;
    url: string;
    interval_seconds: number;
  }) =>
    request<{ id: number }>('/api/monitors', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateMonitor: (
    id: number,
    input: Partial<{
      name: string;
      url: string;
      interval_seconds: number;
      active: boolean;
    }>
  ) =>
    request<unknown>(`/api/monitors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteMonitor: (id: number) =>
    request<void>(`/api/monitors/${id}`, { method: 'DELETE' }),

  runCheck: (id: number) =>
    request<unknown>(`/api/monitors/${id}/check`, { method: 'POST' }),

  series: (id: number, window: string) =>
    request<Series>(`/api/monitors/${id}/series?window=${window}`),
};
