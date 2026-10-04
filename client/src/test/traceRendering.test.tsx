import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpanRecord, TraceDetail, TraceSummary } from '../../../shared/types.js';
import { SpanInspector, Waterfall } from '../components/Waterfall.js';
import { TraceTable } from '../components/TraceTable.js';
import { TraceAnalysis } from '../local/TimingPanel.js';
import { axe } from './axe.js';

const TRACE_ID = '11112222333344445555666677778888';

afterEach(cleanup);

function span(index: number, overrides: Partial<SpanRecord> = {}): SpanRecord {
  return {
    id: (index + 1).toString(16).padStart(16, '0'),
    traceId: TRACE_ID,
    parentSpanId: index === 0 ? null : '0000000000000001',
    serviceName: index === 0 ? 'gateway' : 'worker',
    name: `operation ${index}`,
    kind: 'INTERNAL',
    startTimeMs: 1_000 + index,
    endTimeMs: index === 0 ? 2_000 : 1_010 + index,
    durationMs: index === 0 ? 1_000 : 10,
    statusCode: 'OK',
    attributes: {},
    ...overrides,
  };
}

function trace(rawSpans: SpanRecord[]): TraceDetail {
  const root = rawSpans[0];
  return {
    summary: {
      id: TRACE_ID,
      rootSpanName: root.name,
      rootServiceName: root.serviceName,
      startTimeMs: 1_000,
      durationMs: 1_000,
      spanCount: rawSpans.length,
      services: [...new Set(rawSpans.map((item) => item.serviceName))],
      hasError: false,
      createdAt: '2026-10-04T00:00:00.000Z',
    },
    // Raw records are authoritative even when the convenience root is partial.
    rootSpan: { ...root, children: [], depth: 0, offsetMs: 0, durationPercent: 100 },
    rawSpans,
  };
}

function spanButtons(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('.span-row')];
}

describe('trace rendering', () => {
  it('shows children, separate roots and missing-parent spans from all raw records', async () => {
    const spans = [
      span(0),
      span(1),
      span(2, { parentSpanId: 'ffffffffffffffff', name: 'orphan operation', attributes: { 'source.file': 'synthetic' } }),
      span(3, { parentSpanId: null, name: 'separate root' }),
    ];
    const onSelect = vi.fn();
    const { container, rerender } = render(<Waterfall trace={trace(spans)} loading={false} selectedSpanId={null} onSelectSpan={onSelect} />);
    expect(spanButtons(container)).toHaveLength(4);
    for (const item of spans) expect(screen.getByRole('button', { name: new RegExp(item.name) })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /orphan operation/ }));
    expect(onSelect).toHaveBeenCalledWith(spans[2].id);
    rerender(<SpanInspector trace={trace(spans)} spanId={spans[2].id} />);
    expect(screen.getByText('orphan operation')).toBeInTheDocument();
    expect(screen.getByText('ffffffffffffffff')).toBeInTheDocument();
    expect(screen.getByText('source.file')).toBeInTheDocument();
    expect(screen.getByText('synthetic')).toBeInTheDocument();
  });

  it('reports a zero-duration span as zero percent in the inspector', () => {
    const zero = span(1, { endTimeMs: 1_001, durationMs: 0, name: 'instant operation' });
    render(<SpanInspector trace={trace([span(0), zero])} spanId={zero.id} />);
    expect(screen.getByText('instant operation')).toBeInTheDocument();
    expect(screen.getByText('0 ms')).toBeInTheDocument();
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.queryByText('100.0%')).not.toBeInTheDocument();
  });

  it('renders an all-zero trace with a finite visible span marker', () => {
    const instant = span(0, { endTimeMs: 1_000, durationMs: 0 });
    const data = trace([instant]);
    data.summary.durationMs = 0;
    const { container } = render(<><Waterfall trace={data} loading={false} selectedSpanId={null} onSelectSpan={vi.fn()} /><SpanInspector trace={data} spanId={instant.id} /></>);
    const marker = container.querySelector<HTMLElement>('.span-bar');
    expect(marker).not.toBeNull();
    expect(Number.parseFloat(marker!.style.left)).toBe(0);
    expect(Number.parseFloat(marker!.style.width)).toBeGreaterThan(0);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(screen.getByText('0.0%')).toBeInTheDocument();
  });

  it('keeps every span reachable across 100-row pages and permits selection on the last page', async () => {
    const spans = Array.from({ length: 205 }, (_, index) => span(index));
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Waterfall trace={trace(spans)} loading={false} selectedSpanId={null} onSelectSpan={onSelect} />);
    const pages = screen.getByRole('navigation', { name: 'Waterfall pages' });
    const previous = within(pages).getByRole('button', { name: 'Previous spans' });
    const next = within(pages).getByRole('button', { name: 'Next spans' });
    expect(previous).toBeDisabled();
    const visibleNames = new Set<string>();
    for (const expectedCount of [100, 100, 5]) {
      expect(spanButtons(container)).toHaveLength(expectedCount);
      for (const element of container.querySelectorAll('.span-name')) visibleNames.add(element.textContent ?? '');
      if (expectedCount !== 5) await user.click(next);
    }
    expect(visibleNames).toEqual(new Set(spans.map((item) => item.name)));
    expect(next).toBeDisabled();
    const last = screen.getByRole('button', { name: /operation 204 worker/ });
    last.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(spans[204].id);
    await user.click(previous);
    expect(within(pages).getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /operation 100 worker/ })).toBeInTheDocument();
    await user.click(previous);
    expect(previous).toBeDisabled();
    expect(screen.getByRole('button', { name: /operation 0 gateway/ })).toBeInTheDocument();
  });

  it('resets waterfall pagination when the selected trace changes', async () => {
    const many = trace(Array.from({ length: 101 }, (_, index) => span(index)));
    const user = userEvent.setup();
    const props = { loading: false, selectedSpanId: null, onSelectSpan: vi.fn() };
    const { rerender } = render(<Waterfall trace={many} {...props} />);
    await user.click(screen.getByRole('button', { name: 'Next spans' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    const changed = { ...many, summary: { ...many.summary, id: 'aaaabbbbccccddddeeeeffff00001111' } };
    rerender(<Waterfall trace={changed} {...props} />);
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous spans' })).toBeDisabled();
  });

  it('paginates 101 traces without losing the final selectable trace', async () => {
    const template = trace([span(0)]).summary;
    const traces: TraceSummary[] = Array.from({ length: 101 }, (_, index) => ({ ...template, id: (index + 1).toString(16).padStart(32, '0'), rootSpanName: `trace operation ${index}` }));
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<TraceTable traces={traces} loading={false} selectedTraceId={null} onSelectTrace={onSelect} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(100);
    expect(screen.getByRole('button', { name: 'Previous traces' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /trace operation 100 / })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next traces' }));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Next traces' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /trace operation 100 / }));
    expect(onSelect).toHaveBeenCalledWith(traces[100].id);
    await user.click(screen.getByRole('button', { name: 'Previous traces' }));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(100);
    expect(screen.getByRole('button', { name: 'Previous traces' })).toBeDisabled();
  });

  it('keeps paginated spans and timing analysis accessible on both pages', async () => {
    const data = trace(Array.from({ length: 101 }, (_, index) => span(index)));
    const user = userEvent.setup();
    const { container } = render(<><Waterfall trace={data} loading={false} selectedSpanId={null} onSelectSpan={vi.fn()} /><TraceAnalysis trace={data} /></>);
    const analysis = screen.getByRole('region', { name: 'Trace timing analysis' });
    expect(within(analysis).getByRole('heading', { name: 'Slowest spans' })).toBeInTheDocument();
    expect(within(analysis).getByRole('heading', { name: 'Critical path estimate' })).toBeInTheDocument();
    expect(within(analysis).getAllByRole('listitem')).toHaveLength(10);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Next spans' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
