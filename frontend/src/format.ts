/** Formatting helpers, isolated so they can be unit tested. */

/** 150.42 -> "150 ms", 1523.9 -> "1.52 s" */
export function formatLatency(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return '--';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** 99.994 -> "99.99%" */
export function formatUptime(percent: number | null): string {
  if (percent === null || Number.isNaN(percent)) return 'no data';
  if (percent === 100) return '100%';
  if (percent < 0.01) return '<0.01%';
  return `${percent.toFixed(2)}%`;
}

export function statusOf(summary: {
  last_status: 'up' | 'down' | null;
}): 'up' | 'down' | 'pending' {
  if (summary.last_status === null) return 'pending';
  return summary.last_status;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'never';

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/**
 * Downsample a series to at most `max` points for charting, keeping the newest.
 * Charts get slow well before they get wrong, so cap the width rather than
 * plotting thousands of points.
 */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const slice = points.slice(-max);
  return slice;
}

/** Latencies of successful checks only, aligned with `points`. */
export function latencySeries<T extends { latency_ms: number | null; ok: boolean }>(
  points: T[]
): (number | null)[] {
  return points.map((p) => (p.ok ? p.latency_ms : null));
}
