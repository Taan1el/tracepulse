import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.js';
import { axe } from './axe.js';

const ID_A = '11112222333344445555666677778888';
const ID_B = 'aaaabbbbccccddddeeeeffff00001111';

const traceA = {
  id: ID_A,
  rootSpanName: 'POST /api/v1/checkout',
  rootServiceName: 'api-gateway',
  startTimeMs: 1000,
  durationMs: 245.5,
  spanCount: 2,
  services: ['api-gateway', 'payment-service'],
  hasError: false,
  httpStatus: 201,
  createdAt: '2026-09-10T12:00:00.000Z',
};

const traceB = {
  ...traceA,
  id: ID_B,
  rootSpanName: 'POST /api/v1/login',
  rootServiceName: 'auth-service',
  startTimeMs: 900,
  durationMs: 640,
  spanCount: 1,
  services: ['auth-service'],
  hasError: true,
};

function detailFor(summary: typeof traceA) {
  const root = {
    id: 'a1a1a1a1a1a1a1a1',
    traceId: summary.id,
    parentSpanId: null,
    serviceName: summary.rootServiceName,
    name: summary.rootSpanName,
    kind: 'SERVER' as const,
    startTimeMs: 1000,
    endTimeMs: 1245.5,
    durationMs: summary.durationMs,
    statusCode: summary.hasError ? ('ERROR' as const) : ('OK' as const),
    statusMessage: summary.hasError ? 'Upstream failed' : undefined,
    attributes: { 'http.status_code': 201 },
    events: [{ name: 'retry', timestampMs: 1060 }],
    depth: 0,
    offsetMs: 0,
    durationPercent: 100,
    children: [] as unknown[],
  };
  if (summary.spanCount > 1) {
    root.children.push({
      id: 'b2b2b2b2b2b2b2b2',
      traceId: summary.id,
      parentSpanId: root.id,
      serviceName: 'payment-service',
      name: 'stripe.charges.create',
      kind: 'CLIENT' as const,
      startTimeMs: 1050,
      endTimeMs: 1240,
      durationMs: 190,
      statusCode: 'OK' as const,
      attributes: { 'payment.provider': 'stripe' },
      depth: 1,
      offsetMs: 50,
      durationPercent: 77.4,
      isBottleneck: true,
      children: [],
    });
  }
  return { summary, rootSpan: root, rawSpans: [] };
}

const services = [
  { serviceName: 'api-gateway', requestCount: 42, errorCount: 1, errorRate: 2.38, avgDurationMs: 130.5, p50Ms: 120, p90Ms: 160, p95Ms: 185, p99Ms: 210 },
  { serviceName: 'payment-service', requestCount: 10, errorCount: 4, errorRate: 40, avgDurationMs: 300, p50Ms: 250, p90Ms: 600, p95Ms: 720, p99Ms: 800 },
];

const topology = {
  nodes: [
    { id: 'api-gateway', name: 'api-gateway', callCount: 42, errorRate: 2.38, avgDurationMs: 130.5 },
    { id: 'payment-service', name: 'payment-service', callCount: 10, errorRate: 40, avgDurationMs: 300 },
  ],
  edges: [{ id: 'api-gateway->payment-service', source: 'api-gateway', target: 'payment-service', callCount: 9, avgDurationMs: 190, errorCount: 2 }],
};

type Handler = (url: string, init?: RequestInit) => unknown;
let calls: string[];
let overrides: Record<string, Handler>;

function respond(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) });
}

function ok(data: unknown) {
  return { success: true, data };
}

beforeEach(() => {
  calls = [];
  overrides = {};
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      for (const [fragment, handler] of Object.entries(overrides)) {
        if (url.includes(fragment)) return respond(handler(url, init));
      }
      if (url.includes(`/api/traces/${ID_A}`)) return respond(ok(detailFor(traceA)));
      if (url.includes(`/api/traces/${ID_B}`)) return respond(ok(detailFor(traceB)));
      if (url.includes('/api/traces')) return respond(ok([traceA, traceB]));
      if (url.includes('/api/services/graph')) return respond(ok(topology));
      if (url.includes('/api/services')) return respond(ok(services));
      return respond(ok({}));
    })
  );
});



async function renderLoadedIn() {
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole('heading', { name: 'POST /api/v1/checkout', level: 2 });
  return { ...view, user };
}

describe('Accessibility', () => {
  it('has no violations on the trace list with the waterfall and inspector', async () => {
    const { container } = await renderLoadedIn();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no violations with a span selected and an error trace open', async () => {
    const { container, user } = await renderLoadedIn();
    await user.click(screen.getByRole('button', { name: /stripe\.charges\.create/ }));
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: /POST \/api\/v1\/login/ }));
    await screen.findByRole('heading', { name: 'POST /api/v1/login', level: 2 });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no violations on the Services tab', async () => {
    const { container, user } = await renderLoadedIn();
    await user.click(screen.getByRole('button', { name: 'Services' }));
    await screen.findByRole('table', { name: 'Latency and errors per service' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no violations on the Service calls tab', async () => {
    const { container, user } = await renderLoadedIn();
    await user.click(screen.getByRole('button', { name: 'Service calls' }));
    await screen.findByRole('table', { name: /Calls from one service to another/ });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no violations with the traceparent dialog open and a result shown', async () => {
    const { user } = await renderLoadedIn();
    overrides['/api/w3c/parse'] = () =>
      ok({
        parsed: { version: '00', traceId: ID_A, parentSpanId: 'c3c3c3c3c3c3c3c3', traceFlags: '01' },
        propagatedHeader: `00-${ID_A}-d4d4d4d4d4d4d4d4-01`,
        childSpanId: 'd4d4d4d4d4d4d4d4',
      });
    await user.click(screen.getByRole('button', { name: 'Inspect traceparent' }));
    const dialog = screen.getByRole('dialog', { name: 'Inspect a traceparent header' });
    await user.click(within(dialog).getByRole('button', { name: 'Parse header' }));
    await within(dialog).findByText('01 (sampled)');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('has no violations with the traffic dialog open', async () => {
    const { user } = await renderLoadedIn();
    await user.click(screen.getByRole('button', { name: 'Generate traffic' }));
    screen.getByRole('dialog');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('Scrollable regions', () => {
  const SCROLLERS = '.table-wrapper, .table-scroll, [class*="scroll"], [class*="overflow"]';

  function expectNamedRegions(root: ParentNode) {
    const found = Array.from(root.querySelectorAll(SCROLLERS));
    expect(found.length).toBeGreaterThan(0);
    for (const el of found) {
      expect(el).toHaveAttribute('role', 'region');
      expect(el).toHaveAttribute('tabindex', '0');
      expect(el.getAttribute('aria-label')?.trim()).toBeTruthy();
    }
  }

  it('names and focuses every sideways scroller on each main view', async () => {
    const { container, user } = await renderLoadedIn();
    expectNamedRegions(container);
    await user.click(screen.getByRole('button', { name: 'Services' }));
    await screen.findByRole('table', { name: 'Latency and errors per service' });
    expectNamedRegions(container);
    await user.click(screen.getByRole('button', { name: 'Service calls' }));
    await screen.findByRole('table', { name: /Calls from one service to another/ });
    expectNamedRegions(container);
  });
});

describe('Keyboard use', () => {
  it('reaches the filters with Tab', async () => {
    const { user } = await renderLoadedIn();
    const targets = [screen.getByLabelText('Service'), screen.getByLabelText('Duration'), screen.getByLabelText('Search loaded traces')];
    for (const el of targets) {
      let guard = 0;
      while (document.activeElement !== el && guard++ < 40) await user.tab();
      expect(el).toHaveFocus();
    }
  });

  it('operates trace rows with Enter and Space', async () => {
    const { user } = await renderLoadedIn();
    const row = screen.getByRole('button', { name: /POST \/api\/v1\/login/ });
    row.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'POST /api/v1/login', level: 2 })).toBeInTheDocument();
    const other = screen.getByRole('button', { name: /POST \/api\/v1\/checkout/ });
    other.focus();
    await user.keyboard(' ');
    expect(await screen.findByRole('heading', { name: 'POST /api/v1/checkout', level: 2 })).toBeInTheDocument();
  });

  it('selects a span from the waterfall with the keyboard and shows it in the inspector', async () => {
    const { user } = await renderLoadedIn();
    const span = screen.getByRole('button', { name: /stripe\.charges\.create/ });
    span.focus();
    await user.keyboard('{Enter}');
    expect(span).toHaveAttribute('aria-pressed', 'true');
    const inspector = screen.getByRole('complementary', { name: 'Span inspector' });
    expect(within(inspector).getByText('stripe.charges.create')).toBeInTheDocument();
    expect(within(inspector).getByText('payment.provider')).toBeInTheDocument();
  });

  it('opens and closes the traceparent dialog by keyboard and returns focus', async () => {
    const { user } = await renderLoadedIn();
    const opener = screen.getByRole('button', { name: 'Inspect traceparent' });
    opener.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Inspect a traceparent header' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
