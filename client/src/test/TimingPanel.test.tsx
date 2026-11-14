import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import otlpFixture from './fixtures/otlp-local.json';
import { parseTraceFile } from '../local/traceFiles.js';
import { TraceAnalysis } from '../local/TimingPanel.js';
import { formatMs } from '../utils/formatMs.js';

describe('millisecond formatting', () => {
  it('rounds to three decimals without trailing zeros', () => {
    expect(formatMs(100)).toBe('100 ms');
    expect(formatMs(12.345678)).toBe('12.346 ms');
    expect(formatMs(0.1 + 0.2)).toBe('0.3 ms');
    expect(formatMs(1234.5)).toBe('1234.5 ms');
    expect(formatMs(0)).toBe('0 ms');
    expect(formatMs(0.000005)).toBe('<0.001 ms');
  });

  it('shows rounded durations in the slowest spans and the critical path', () => {
    const [trace] = parseTraceFile(JSON.stringify(otlpFixture), 'otel.json');
    const { container } = render(<TraceAnalysis trace={trace} />);
    expect(screen.getAllByText('12.346 ms').length).toBeGreaterThan(0);
    expect(container.textContent).toContain('(12.346 ms)');
    expect(container.textContent).not.toMatch(/\d\.\d{4,} ms/);
  });
});
