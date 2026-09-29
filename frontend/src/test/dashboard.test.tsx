import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard, summarise } from '../pages/Dashboard';
import type { MonitorSummary } from '../api';

const UP: MonitorSummary = {
  monitor_id: 1,
  name: 'Marketing site',
  url: 'https://example.com',
  active: true,
  total_checks: 100,
  successful_checks: 99,
  uptime_percent: 99,
  last_status: 'up',
  last_checked_at: new Date().toISOString(),
  avg_latency_ms: 120.4,
  p95_latency_ms: 240.8,
  in_incident: false,
};

const DOWN: MonitorSummary = {
  ...UP,
  monitor_id: 2,
  name: 'Checkout API',
  url: 'https://api.example.com',
  last_status: 'down',
  uptime_percent: 87.5,
  in_incident: true,
};

function stubApi(monitors: MonitorSummary[]) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/api/monitors') && !url.includes('/check')) {
      return new Response(JSON.stringify(monitors), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  window.confirm = vi.fn(() => true);
});

describe('Dashboard', () => {
  it('shows the empty state when nothing is monitored', async () => {
    stubApi([]);

    render(<Dashboard onSignOut={vi.fn()} onOpen={vi.fn()} />);

    expect(
      await screen.findByText(/nothing monitored yet/i)
    ).toBeInTheDocument();
  });

  it('renders one row per monitor with its metrics', async () => {
    stubApi([UP, DOWN]);

    render(<Dashboard onSignOut={vi.fn()} onOpen={vi.fn()} />);

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Marketing site')).toBeInTheDocument();
    expect(screen.getByText('99.00%')).toBeInTheDocument();
    expect(screen.getByText('87.50%')).toBeInTheDocument();
  });

  it('marks a failing monitor as down', async () => {
    stubApi([DOWN]);

    render(<Dashboard onSignOut={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByText('down')).toBeInTheDocument();
  });

  it('opens a monitor when its name is clicked', async () => {
    stubApi([UP]);
    const onOpen = vi.fn();

    render(<Dashboard onSignOut={vi.fn()} onOpen={onOpen} />);

    await userEvent.click(await screen.findByText('Marketing site'));

    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('shows an actionable error when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    render(<Dashboard onSignOut={vi.fn()} onOpen={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the API'
    );
  });

  it('signs the user out when the API rejects the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'Not authenticated' }), { status: 401 }))
    );
    const onSignOut = vi.fn();

    render(<Dashboard onSignOut={onSignOut} onOpen={vi.fn()} />);

    await waitFor(() => expect(onSignOut).toHaveBeenCalled());
  });

  it('adds a monitor and refreshes the list', async () => {
    const calls = stubApi([]);
    const { unmount } = render(<Dashboard onSignOut={vi.fn()} onOpen={vi.fn()} />);
    await screen.findByText(/nothing monitored yet/i);

    await userEvent.type(
      screen.getByLabelText('Monitor name'),
      'New site'
    );
    await userEvent.type(screen.getByLabelText('URL'), 'new.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add monitor' }));

    await waitFor(() =>
      expect(
        calls.some((c) => c.includes('/api/monitors') && !c.includes('GET'))
      ).toBe(true)
    );
    unmount();
  });

  it('signs out on demand', async () => {
    stubApi([]);
    const onSignOut = vi.fn();

    render(<Dashboard onSignOut={onSignOut} onOpen={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(onSignOut).toHaveBeenCalled();
  });
});

describe('summarise', () => {
  it('handles an empty list', () => {
    const result = summarise([]);

    expect(result.total).toBe(0);
    expect(result.uptime).toBeNull();
    expect(result.latency).toBeNull();
  });

  it('weights uptime by the number of checks rather than averaging averages', () => {
    const result = summarise([
      { ...UP, total_checks: 10, uptime_percent: 100 },
      { ...UP, monitor_id: 3, total_checks: 90, uptime_percent: 90 },
    ]);

    // A flat average would give 95. Weighting by sample size gives 91.
    expect(result.uptime).toBe(91);
  });

  it('ignores monitors with no data when averaging uptime', () => {
    const result = summarise([
      { ...UP, uptime_percent: null, total_checks: 0 },
      { ...UP, monitor_id: 3, uptime_percent: 80, total_checks: 10 },
    ]);

    expect(result.uptime).toBe(80);
  });

  it('averages latency across monitors that reported one', () => {
    const result = summarise([
      { ...UP, avg_latency_ms: 100 },
      { ...UP, monitor_id: 3, avg_latency_ms: 200 },
    ]);

    expect(result.latency).toBe(150);
  });

  it('counts up and down', () => {
    const result = summarise([UP, DOWN, { ...UP, monitor_id: 3, last_status: null }]);

    expect(result.total).toBe(3);
    expect(result.up).toBe(1);
    expect(result.down).toBe(1);
  });
});
