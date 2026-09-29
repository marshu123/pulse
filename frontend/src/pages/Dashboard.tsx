import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type MonitorSummary } from '../api';
import { describeError } from '../errors';
import { formatLatency, formatUptime, relativeTime, statusOf } from '../format';

export function Dashboard({
  onSignOut,
  onOpen,
}: {
  onSignOut: () => void;
  onOpen: (id: number) => void;
}) {
  const [monitors, setMonitors] = useState<MonitorSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setMonitors(await api.monitors());
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onSignOut();
        return;
      }
      setError(describeError(caught));
    }
  }, [onSignOut]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while the tab is visible. A hidden tab does not need live numbers.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const totals = summarise(monitors ?? []);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-mark">
          <span className="dot" />
          Pulse
        </div>
        <button className="link" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <section className="stats">
        <Stat label="Monitors" value={String(totals.total)} />
        <Stat
          label="Up"
          value={String(totals.up)}
          tone={totals.total > 0 ? 'good' : undefined}
        />
        <Stat
          label="Down"
          value={String(totals.down)}
          tone={totals.down > 0 ? 'bad' : undefined}
        />
        <Stat label="Avg uptime" value={formatUptime(totals.uptime)} />
        <Stat label="Avg latency" value={formatLatency(totals.latency)} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Add a monitor</h2>
        </div>
        <AddMonitor
          busy={creating}
          onCreate={async (input) => {
            setCreating(true);
            try {
              await api.createMonitor(input);
              setError(null);
              await load();
            } catch (caught) {
              setError(describeError(caught));
            } finally {
              setCreating(false);
            }
          }}
        />
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Monitors</h2>
          <button className="link" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {monitors === null && <p className="muted">Loading…</p>}

        {monitors !== null && monitors.length === 0 && (
          <p className="muted">
            Nothing monitored yet. Add a URL above and it will be probed
            immediately.
          </p>
        )}

        {monitors !== null && monitors.length > 0 && (
          <ul className="monitor-list">
            {monitors.map((monitor) => (
              <MonitorRow
                key={monitor.monitor_id}
                monitor={monitor}
                onOpen={onOpen}
                onChanged={load}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="stat">
      <span className={`stat-value${tone ? ` ${tone}` : ''}`}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function MonitorRow({
  monitor,
  onOpen,
  onChanged,
}: {
  monitor: MonitorSummary;
  onOpen: (id: number) => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const state = statusOf(monitor);

  async function runNow() {
    setBusy(true);
    try {
      await api.runCheck(monitor.monitor_id);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${monitor.name}"?`)) return;
    await api.deleteMonitor(monitor.monitor_id);
    await onChanged();
  }

  return (
    <li className="monitor">
      <button className="status" onClick={runNow} disabled={busy} title="Probe now">
        <span className={`pip ${state}`} />
        <span className="status-text">
          {busy ? 'checking…' : state === 'pending' ? 'no data' : state}
        </span>
      </button>

      <div className="monitor-body">
        <button className="monitor-name" onClick={() => onOpen(monitor.monitor_id)}>
          {monitor.name}
        </button>
        <span className="monitor-url">{monitor.url}</span>
      </div>

      <div className="metrics">
        <Metric label="Uptime" value={formatUptime(monitor.uptime_percent)} />
        <Metric label="Avg" value={formatLatency(monitor.avg_latency_ms)} />
        <Metric label="p95" value={formatLatency(monitor.p95_latency_ms)} />
        <Metric label="Checked" value={relativeTime(monitor.last_checked_at)} />
      </div>

      <div className="row-actions">
        <button
          className="link"
          onClick={async () => {
            await api.updateMonitor(monitor.monitor_id, {
              active: !monitor.active,
            });
            await onChanged();
          }}
        >
          {monitor.active ? 'Pause' : 'Resume'}
        </button>
        <button className="link danger" onClick={remove}>
          Delete
        </button>
      </div>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function AddMonitor({
  onCreate,
  busy,
}: {
  onCreate: (input: {
    name: string;
    url: string;
    interval_seconds: number;
  }) => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [interval, setIntervalValue] = useState(300);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onCreate({ name, url, interval_seconds: Number(interval) });
    setName('');
    setUrl('');
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <input
        required
        placeholder="Name, e.g. Marketing site"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Monitor name"
      />
      <input
        required
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="URL"
      />
      <select
        value={interval}
        onChange={(e) => setIntervalValue(Number(e.target.value))}
        aria-label="Check interval"
      >
        <option value={60}>Every minute</option>
        <option value={300}>Every 5 minutes</option>
        <option value={900}>Every 15 minutes</option>
        <option value={3600}>Hourly</option>
      </select>
      <button type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add monitor'}
      </button>
    </form>
  );
}

export function summarise(monitors: MonitorSummary[]) {
  const withData = monitors.filter((m) => m.uptime_percent !== null);
  const weighted = withData.reduce(
    (acc, m) => acc + (m.uptime_percent ?? 0) * m.total_checks,
    0
  );
  const totalChecks = withData.reduce((acc, m) => acc + m.total_checks, 0);

  const latencies = monitors
    .map((m) => m.avg_latency_ms)
    .filter((value): value is number => value !== null);

  return {
    total: monitors.length,
    up: monitors.filter((m) => m.last_status === 'up').length,
    down: monitors.filter((m) => m.last_status === 'down').length,
    uptime:
      totalChecks === 0
        ? null
        : Math.round((weighted / totalChecks) * 100) / 100,
    latency:
      latencies.length === 0
        ? null
        : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
  };
}
