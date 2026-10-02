import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.js';

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

async function renderLoaded() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: 'POST /api/v1/checkout', level: 2 });
  return user;
}

function postedBody(): unknown {
  const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([, init]) => init?.method === 'POST');
  return JSON.parse(call![1].body);
}

describe('TracePulse dashboard', () => {
  it('shows the header, actions and a stats strip built from the loaded data', async () => {
    await renderLoaded();

    expect(screen.getByRole('heading', { name: 'TracePulse', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate traffic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect traceparent' })).toBeInTheDocument();

    expect(screen.getByText('Traces loaded')).toBeInTheDocument();
    expect(screen.getByText('50.0%')).toBeInTheDocument(); // 1 of 2 traces has an error
    expect(screen.getByText('442.8 ms')).toBeInTheDocument(); // mean of 245.5 and 640
    expect(screen.getByText('720.0 ms')).toBeInTheDocument(); // highest P95
    expect(screen.getByText('2 services')).toBeInTheDocument();
  });

  it('lists traces in a table and opens the newest one in the waterfall', async () => {
    await renderLoaded();

    const table = screen.getByRole('table', { name: /Traces, newest first/ });
    expect(within(table).getByText('POST /api/v1/login')).toBeInTheDocument();
    expect(within(table).getByText('Error')).toBeInTheDocument();
    expect(within(table).getByText('245.5 ms')).toBeInTheDocument();
    expect(screen.getByText(ID_A)).toBeInTheDocument();
    expect(screen.getByText(/Longest child span: stripe\.charges\.create in payment-service, 190 ms \(77% of the trace\)/)).toBeInTheDocument();
  });

  it('loads the clicked trace without reloading the list', async () => {
    const user = await renderLoaded();
    const listCalls = () => calls.filter((c) => c.includes('/api/traces?')).length;
    const before = listCalls();

    await user.click(screen.getByRole('button', { name: /POST \/api\/v1\/login/ }));

    expect(await screen.findByRole('heading', { name: 'POST /api/v1/login', level: 2 })).toBeInTheDocument();
    expect(screen.getByText(ID_B)).toBeInTheDocument();
    expect(listCalls()).toBe(before);
  });

  it('expands a span to show ids, attributes and events', async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole('button', { name: /POST \/api\/v1\/checkout.*api-gateway/ }));

    expect(screen.getByText('a1a1a1a1a1a1a1a1')).toBeInTheDocument();
    expect(screen.getByText('none (root)')).toBeInTheDocument();
    expect(screen.getByText('http.status_code')).toBeInTheDocument();
    expect(screen.getByText('retry at +60 ms')).toBeInTheDocument();
  });

  it('sends the selected filters to the API', async () => {
    const user = await renderLoaded();

    await user.selectOptions(screen.getByLabelText('Service'), 'payment-service');
    await user.selectOptions(screen.getByLabelText('Duration'), '150');
    await user.click(screen.getByLabelText('Only traces with an error span'));

    await waitFor(() => {
      expect(calls.some((c) => c.includes('service=payment-service') && c.includes('minDuration=150') && c.includes('hasError=true'))).toBe(true);
    });
  });

  it('filters the loaded traces by search text and reports the match count', async () => {
    const user = await renderLoaded();
    await user.type(screen.getByLabelText('Search loaded traces'), 'login');

    const table = screen.getByRole('table', { name: /Traces, newest first \(1 trace\)/ });
    expect(within(table).queryByText('POST /api/v1/checkout')).not.toBeInTheDocument();
    expect(screen.getByText('1 match among 2 loaded traces.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search loaded traces'));
    await user.type(screen.getByLabelText('Search loaded traces'), 'zzz');
    expect(screen.getByText('No traces match the current filters.')).toBeInTheDocument();
  });

  it('shows service latency and flags services by error rate and P95', async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole('button', { name: 'Services' }));

    const table = screen.getByRole('table', { name: 'Latency and errors per service' });
    const gateway = within(table).getByRole('row', { name: /api-gateway/ });
    expect(within(gateway).getByText('Healthy')).toBeInTheDocument();
    expect(within(gateway).getByText('185 ms')).toBeInTheDocument();
    const payment = within(table).getByRole('row', { name: /payment-service/ });
    expect(within(payment).getByText('High errors')).toBeInTheDocument();
    expect(within(table).queryByText('throughput')).not.toBeInTheDocument();
  });

  it('lists calls between services with a text summary', async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole('button', { name: 'Service calls' }));

    expect(screen.getByText(/2 services and 1 call path\. Busiest path: api-gateway to payment-service, 9 calls\./)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /Calls from one service to another/ });
    expect(within(table).getByText('190 ms')).toBeInTheDocument();
    expect(screen.getByText('Services that call no one else: payment-service.')).toBeInTheDocument();
  });

  it('shows an empty state when no calls were recorded', async () => {
    overrides['/api/services/graph'] = () => ok({ nodes: [], edges: [] });
    const user = await renderLoaded();
    await user.click(screen.getByRole('button', { name: 'Service calls' }));
    expect(screen.getByText('No calls between services have been recorded yet.')).toBeInTheDocument();
  });

  it('shows an error with a retry button when the API fails', async () => {
    overrides['/api/traces?'] = () => ({ success: false, error: 'Parameter limit is invalid' });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Parameter limit is invalid');

    delete overrides['/api/traces?'];
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'POST /api/v1/checkout', level: 2 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('Dialogs', () => {
  it('parses a traceparent and shows the header for the next call', async () => {
    const user = await renderLoaded();
    overrides['/api/w3c/parse'] = () =>
      ok({
        parsed: { version: '00', traceId: ID_A, parentSpanId: 'c3c3c3c3c3c3c3c3', traceFlags: '01' },
        propagatedHeader: `00-${ID_A}-d4d4d4d4d4d4d4d4-01`,
        childSpanId: 'd4d4d4d4d4d4d4d4',
      });

    await user.click(screen.getByRole('button', { name: 'Inspect traceparent' }));
    const dialog = screen.getByRole('dialog', { name: 'Inspect a traceparent header' });
    await user.click(within(dialog).getByRole('button', { name: 'Parse header' }));

    expect(await within(dialog).findByText('01 (sampled)')).toBeInTheDocument();
    expect(within(dialog).getByText(`00-${ID_A}-d4d4d4d4d4d4d4d4-01`)).toBeInTheDocument();
    expect(calls.some((c) => c.includes('traceparent=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'))).toBe(true);
  });

  it('parses the freshly generated header, not the previous input', async () => {
    const user = await renderLoaded();
    const fresh = `00-${ID_B}-e5e5e5e5e5e5e5e5-01`;
    overrides['/api/w3c/context'] = () => ok({ traceId: ID_B, spanId: 'e5e5e5e5e5e5e5e5', traceparent: fresh });
    overrides['/api/w3c/parse'] = () =>
      ok({
        parsed: { version: '00', traceId: ID_B, parentSpanId: 'e5e5e5e5e5e5e5e5', traceFlags: '01' },
        propagatedHeader: fresh,
        childSpanId: 'f6f6f6f6f6f6f6f6',
      });

    await user.click(screen.getByRole('button', { name: 'Inspect traceparent' }));
    await user.click(screen.getByRole('button', { name: 'Generate new context' }));

    await screen.findByText('01 (sampled)');
    expect(screen.getByLabelText('Header value')).toHaveValue(fresh);
    expect(calls.some((c) => c.includes(`traceparent=${encodeURIComponent(fresh)}`))).toBe(true);
    expect(calls.some((c) => c.includes('4bf92f3577b34da6a3ce929d0e0e4736'))).toBe(false);
  });

  it('shows the API message for an invalid traceparent', async () => {
    const user = await renderLoaded();
    overrides['/api/w3c/parse'] = () => ({ success: false, error: 'Invalid W3C traceparent header format' });

    await user.click(screen.getByRole('button', { name: 'Inspect traceparent' }));
    await user.clear(screen.getByLabelText('Header value'));
    await user.type(screen.getByLabelText('Header value'), 'not-a-header');
    await user.click(screen.getByRole('button', { name: 'Parse header' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid W3C traceparent header format');
  });

  it('closes with the close button and with Escape, and returns focus', async () => {
    const user = await renderLoaded();
    const opener = screen.getByRole('button', { name: 'Inspect traceparent' });

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await user.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('generates one failing trace of the chosen flow and refreshes the list', async () => {
    const user = await renderLoaded();
    const before = calls.filter((c) => c.includes('/api/traces?')).length;

    await user.click(screen.getByRole('button', { name: 'Generate traffic' }));
    await user.click(screen.getByLabelText(/Search and rank/));
    await user.click(screen.getByLabelText(/Make this trace fail/));
    await user.click(screen.getByRole('button', { name: 'Generate trace' }));

    expect(await screen.findByText('Generated one search and rank trace with a failure.')).toBeInTheDocument();
    expect(postedBody()).toEqual({ flowType: 'search', injectAnomaly: true });
    await waitFor(() => expect(calls.filter((c) => c.includes('/api/traces?')).length).toBeGreaterThan(before));
  });

  it('generates a batch of ten traces', async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole('button', { name: 'Generate traffic' }));
    await user.click(screen.getByRole('button', { name: 'Generate 10 mixed traces' }));

    expect(await screen.findByText('Generated 10 traces.')).toBeInTheDocument();
    expect(postedBody()).toEqual({ flowType: 'batch', batchCount: 10 });
  });

  it('reports a simulation failure in the dialog', async () => {
    const user = await renderLoaded();
    overrides['/api/simulate'] = () => ({ success: false, error: 'flowType is invalid' });

    await user.click(screen.getByRole('button', { name: 'Generate traffic' }));
    await user.click(screen.getByRole('button', { name: 'Generate trace' }));

    expect(await screen.findByText('Error: flowType is invalid')).toBeInTheDocument();
  });
});
