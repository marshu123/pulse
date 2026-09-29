import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from '../pages/Login';
import { Sparkline, UptimeBar } from '../pages/MonitorDetail';

function mockFetch(routes: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.entries(routes).find(([key]) => url.includes(key));
    if (!match) {
      return new Response('{}', { status: 404 });
    }
    const [, value] = match;
    return new Response(JSON.stringify(value.body), {
      status: value.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Login', () => {
  it('signs in and reports the user back', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/auth/login': {
          status: 200,
          body: {
            access_token: 'token-123',
            token_type: 'bearer',
            user: { id: 1, email: 'dev@example.com', created_at: '2026-01-01' },
          },
        },
      })
    );

    const onAuthenticated = vi.fn();
    render(<Login onAuthenticated={onAuthenticated} onUnauthorised={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Email'), 'dev@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(onAuthenticated.mock.calls[0][1]).toBe('token-123');
  });

  it('shows the API error message on bad credentials', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/auth/login': {
          status: 401,
          body: { detail: 'Incorrect email or password' },
        },
      })
    );

    render(<Login onAuthenticated={vi.fn()} onUnauthorised={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Email'), 'dev@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Incorrect email or password'
    );
  });

  it('explains itself when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    render(<Login onAuthenticated={vi.fn()} onUnauthorised={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Email'), 'dev@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the API'
    );
  });

  it('switches to the register form', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    render(<Login onAuthenticated={vi.fn()} onUnauthorised={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Create one' }));

    expect(
      screen.getByRole('button', { name: 'Create account' })
    ).toBeInTheDocument();
  });

  it('enforces the password length in the browser', () => {
    render(<Login onAuthenticated={vi.fn()} onUnauthorised={vi.fn()} />);

    expect(screen.getByLabelText('Password')).toHaveAttribute('minlength', '8');
  });
});

describe('Sparkline', () => {
  it('asks for more data rather than drawing a misleading line', () => {
    render(<Sparkline values={[100]} />);

    expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
  });

  it('draws a path once there are two points', () => {
    const { container } = render(<Sparkline values={[100, 200, 150]} />);

    expect(container.querySelectorAll('path')).toHaveLength(1);
  });

  it('breaks the line at gaps rather than interpolating', () => {
    const { container } = render(<Sparkline values={[100, null, 200]} />);

    // Two separate segments, because the failed middle check is unknown.
    expect(container.querySelectorAll('path')).toHaveLength(2);
  });

  it('labels itself for screen readers', () => {
    render(<Sparkline values={[100, 200]} />);

    expect(
      screen.getByRole('img', { name: /response time/i })
    ).toBeInTheDocument();
  });
});

describe('UptimeBar', () => {
  it('renders one cell per check', () => {
    const { container } = render(
      <UptimeBar
        points={[
          { ok: true, status_code: 200 },
          { ok: false, status_code: 500 },
          { ok: true, status_code: 200 },
        ]}
      />
    );

    expect(container.querySelectorAll('.cell')).toHaveLength(3);
    expect(container.querySelectorAll('.cell.down')).toHaveLength(1);
  });

  it('renders nothing when there are no checks', () => {
    const { container } = render(<UptimeBar points={[]} />);

    expect(container.querySelectorAll('.cell')).toHaveLength(0);
  });
});
