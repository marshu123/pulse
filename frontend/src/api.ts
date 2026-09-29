/**
 * Typed API client.
 *
 * The token is kept in memory plus localStorage so a refresh does not sign the
 * user out. It is a demo project, not a bank; a real deployment would prefer an
 * httpOnly cookie.
 */

const BASE = import.meta.env.VITE_API_URL ?? '';
const TOKEN_KEY = 'pulse.token';

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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
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

  const response = await fetch(`${BASE}${path}`, { ...init, headers });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : `Request failed (${response.status})`;
    throw new ApiError(detail, response.status);
  }

  return body as T;
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
