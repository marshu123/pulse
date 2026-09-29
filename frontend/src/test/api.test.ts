import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  NetworkError,
  UnexpectedResponseError,
  normaliseBase,
} from '../api';
import { describeError } from '../errors';

describe('normaliseBase', () => {
  it('leaves a bare origin alone', () => {
    expect(normaliseBase('https://api.example.com')).toBe(
      'https://api.example.com'
    );
  });

  it('strips a trailing slash, which would otherwise double up', () => {
    // /host/ + /api/... produces //api/... which 404s.
    expect(normaliseBase('https://api.example.com/')).toBe(
      'https://api.example.com'
    );
  });

  it('strips several trailing slashes', () => {
    expect(normaliseBase('https://api.example.com///')).toBe(
      'https://api.example.com'
    );
  });

  it('strips a trailing /api because request paths already include it', () => {
    // /host/api + /api/auth/register would become /api/api/auth/register.
    expect(normaliseBase('https://api.example.com/api')).toBe(
      'https://api.example.com'
    );
    expect(normaliseBase('https://api.example.com/api/')).toBe(
      'https://api.example.com'
    );
  });

  it('is case insensitive about /api', () => {
    expect(normaliseBase('https://api.example.com/API')).toBe(
      'https://api.example.com'
    );
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseBase('  https://api.example.com  ')).toBe(
      'https://api.example.com'
    );
  });

  it('keeps an empty value empty, so dev keeps using the Vite proxy', () => {
    expect(normaliseBase('')).toBe('');
    expect(normaliseBase(undefined)).toBe('');
  });

  it('does not mangle a path that merely contains api', () => {
    expect(normaliseBase('https://example.com/apifoo')).toBe(
      'https://example.com/apifoo'
    );
  });
});

describe('describeError', () => {
  it('passes an API error message straight through', () => {
    const error = new ApiError('Incorrect email or password', 401);
    expect(describeError(error)).toBe('Incorrect email or password');
  });

  it('explains a network failure as a connectivity or CORS problem', () => {
    const error = new NetworkError('Could not reach https://x');
    expect(describeError(error)).toBe('Could not reach https://x');
  });

  it('distinguishes a non-JSON response from being offline', () => {
    // The regression this exists for: a Vercel login page arriving where the
    // API should be used to report "could not reach the API".
    const error = new UnexpectedResponseError(
      'Expected JSON but got text/plain (status 401).',
      401,
      'text/plain',
      '{"access":"vercel curl <deployment-url>"}'
    );

    const message = describeError(error);

    expect(message).toContain('text/plain');
    expect(message).toContain('status 401');
    expect(message).toContain('vercel curl');
    expect(message).not.toMatch(/Could not reach/i);
  });

  it('falls back for something unrecognised', () => {
    expect(describeError(new Error('boom'))).toBe(
      'Something went wrong. Please try again.'
    );
  });
});

describe('request error classification', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('raises NetworkError when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const { api } = await import('../api');

    await expect(api.login('a@b.com', 'password123')).rejects.toBeInstanceOf(
      NetworkError
    );
  });

  it('raises UnexpectedResponseError when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>Log in to Vercel</html>', {
            status: 401,
            headers: { 'Content-Type': 'text/html' },
          })
      )
    );
    const { api } = await import('../api');

    const error = await api.login('a@b.com', 'password123').catch((e) => e);

    expect(error).toBeInstanceOf(UnexpectedResponseError);
    expect(error.status).toBe(401);
    expect(error.contentType).toBe('text/html');
  });

  it('still raises ApiError for a JSON error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: 'Incorrect email or password' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
    const { api } = await import('../api');

    const error = await api.login('a@b.com', 'password123').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Incorrect email or password');
  });

  it('truncates a huge non-JSON body in the preview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('x'.repeat(5000), {
            status: 502,
            headers: { 'Content-Type': 'text/html' },
          })
      )
    );
    const { api } = await import('../api');

    const error = await api.login('a@b.com', 'password123').catch((e) => e);

    expect(error.bodyPreview.length).toBeLessThanOrEqual(140);
  });
});
