import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, type Series } from '../api';
import { formatLatency, formatUptime, latencySeries } from '../format';

const WINDOWS = ['1h', '6h', '24h', '7d', '30d'] as const;
type Window_ = (typeof WINDOWS)[number];

export function MonitorDetail({
  monitorId,
  onBack,
  onUnauthorised,
}: {
  monitorId: number;
  onBack: () => void;
  onUnauthorised: () => void;
}) {
  const [window_, setWindow] = useState<Window_>('24h');
  const [series, setSeries] = useState<Series | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .series(monitorId, window_)
      .then((result) => {
        if (!cancelled) {
          setSeries(result);
          setError(null);
        }
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) {
          onUnauthorised();
          return;
        }
        setError(caught instanceof ApiError ? caught.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [monitorId, window_, onUnauthorised]);

  const latencies = useMemo(
    () => (series ? latencySeries(series.points) : []),
    [series]
  );

  return (
    <div className="shell">
      <header className="topbar">
        <button className="link" onClick={onBack}>
          &larr; All monitors
        </button>
        <div className="brand-mark">
          <span className="dot" />
          Pulse
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {series && (
        <>
          <section className="stats">
            <Stat label="Uptime" value={formatUptime(series.uptime_percent)} />
            <Stat label="Avg latency" value={formatLatency(series.avg_latency_ms)} />
            <Stat label="p95 latency" value={formatLatency(series.p95_latency_ms)} />
            <Stat label="Checks" value={String(series.total_checks)} />
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Response time</h2>
              <div className="windows">
                {WINDOWS.map((option) => (
                  <button
                    key={option}
                    className={option === window_ ? 'chip active' : 'chip'}
                    onClick={() => setWindow(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            {series.points.length === 0 ? (
              <p className="muted">No checks recorded in this window yet.</p>
            ) : (
              <>
                <Sparkline values={latencies} width={900} height={220} />
                <UptimeBar points={series.points} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/**
 * A plain SVG line chart. No charting library: for one line series this is
 * forty lines, and it keeps the bundle small.
 */
export function Sparkline({
  values,
  width = 900,
  height = 220,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
}) {
  const points = values.filter((v): v is number => v !== null);
  if (points.length < 2) {
    return <p className="muted">Not enough data to draw a chart yet.</p>;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);

  // Break the line at gaps rather than interpolating across missing data.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) segments.push(current.join(' '));
      current = [];
      return;
    }
    const x = index * step;
    const y = height - ((value - min) / span) * (height - 24) - 12;
    current.push(`${current.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(' '));

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Response time, ${formatLatency(min)} to ${formatLatency(max)}`}
    >
      {segments.map((d, index) => (
        <path key={index} d={d} fill="none" stroke="currentColor" strokeWidth="2" />
      ))}
      <text x="4" y="16" className="axis">
        {formatLatency(max)}
      </text>
      <text x="4" y={height - 4} className="axis">
        {formatLatency(min)}
      </text>
    </svg>
  );
}

/** A coarse availability strip: one cell per check, green for up. */
export function UptimeBar({
  points,
}: {
  points: { ok: boolean; status_code: number | null }[];
}) {
  if (points.length === 0) return null;
  return (
    <div className="uptime-strip" role="img" aria-label="Recent check results">
      {points.map((point, index) => (
        <span
          key={index}
          className={point.ok ? 'cell up' : 'cell down'}
          title={
            point.ok
              ? `up${point.status_code ? ` (${point.status_code})` : ''}`
              : `down${point.status_code ? ` (${point.status_code})` : ''}`
          }
        />
      ))}
    </div>
  );
}
