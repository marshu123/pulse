import { describe, expect, it } from 'vitest';
import {
  downsample,
  formatLatency,
  formatUptime,
  latencySeries,
  relativeTime,
  statusOf,
} from '../format';

describe('formatLatency', () => {
  it('renders milliseconds under a second', () => {
    expect(formatLatency(150.42)).toBe('150 ms');
    expect(formatLatency(999)).toBe('999 ms');
  });

  it('switches to seconds past 1000', () => {
    expect(formatLatency(1523.9)).toBe('1.52 s');
  });

  it('shows a dash when there is no measurement', () => {
    expect(formatLatency(null)).toBe('--');
    expect(formatLatency(Number.NaN)).toBe('--');
  });

  it('renders zero rather than hiding it', () => {
    expect(formatLatency(0)).toBe('0 ms');
  });
});

describe('formatUptime', () => {
  it('says "no data" rather than showing 0% when nothing was measured', () => {
    expect(formatUptime(null)).toBe('no data');
  });

  it('does not pad a perfect score', () => {
    expect(formatUptime(100)).toBe('100%');
  });

  it('keeps small values readable', () => {
    expect(formatUptime(0.001)).toBe('<0.01%');
  });

  it('rounds to two decimals', () => {
    expect(formatUptime(99.994)).toBe('99.99%');
  });
});

describe('statusOf', () => {
  it('reports pending when nothing has been checked', () => {
    expect(statusOf({ last_status: null })).toBe('pending');
  });

  it('passes through up and down', () => {
    expect(statusOf({ last_status: 'up' })).toBe('up');
    expect(statusOf({ last_status: 'down' })).toBe('down');
  });
});

describe('relativeTime', () => {
  it('handles a missing timestamp', () => {
    expect(relativeTime(null)).toBe('never');
    expect(relativeTime('nonsense')).toBe('never');
  });

  it('describes recent times in the right unit', () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 5_000).toISOString())).toBe('5s ago');
    expect(relativeTime(new Date(now - 120_000).toISOString())).toBe('2m ago');
    expect(relativeTime(new Date(now - 7_200_000).toISOString())).toBe('2h ago');
  });

  it('does not report negative time for clock skew', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(relativeTime(future)).toBe('just now');
  });
});

describe('downsample', () => {
  it('leaves short series alone', () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('keeps the newest points when trimming', () => {
    expect(downsample([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });
});

describe('latencySeries', () => {
  it('blanks failed checks so the chart shows gaps instead of zeros', () => {
    const points = [
      { latency_ms: 100, ok: true },
      { latency_ms: 0, ok: false },
      { latency_ms: 300, ok: true },
    ];

    expect(latencySeries(points)).toEqual([100, null, 300]);
  });

  it('keeps an explicit null on a successful check', () => {
    expect(latencySeries([{ latency_ms: null, ok: true }])).toEqual([null]);
  });
});
