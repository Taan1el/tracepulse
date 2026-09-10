import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App.js';

const mockTraces = [
  {
    id: '11112222333344445555666677778888',
    rootSpanName: 'POST /api/v1/checkout',
    rootServiceName: 'api-gateway',
    startTimeMs: 1000,
    durationMs: 245.5,
    spanCount: 3,
    services: ['api-gateway', 'payment-service'],
    hasError: false,
    httpStatus: 201,
    createdAt: '2026-09-10T12:00:00.000Z',
  },
];

const mockDetail = {
  summary: mockTraces[0],
  rootSpan: {
    id: 'span_root_000001',
    traceId: '11112222333344445555666677778888',
    parentSpanId: null,
    serviceName: 'api-gateway',
    name: 'POST /api/v1/checkout',
    kind: 'SERVER' as const,
    startTimeMs: 1000,
    endTimeMs: 1245.5,
    durationMs: 245.5,
    statusCode: 'OK' as const,
    attributes: { 'http.status_code': 201 },
    depth: 0,
    offsetMs: 0,
    durationPercent: 100,
    children: [
      {
        id: 'span_child_000002',
        traceId: '11112222333344445555666677778888',
        parentSpanId: 'span_root_000001',
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
      },
    ],
  },
  rawSpans: [],
};

const mockServices = [
  {
    serviceName: 'api-gateway',
    requestCount: 42,
    errorCount: 1,
    errorRate: 2.38,
    avgDurationMs: 130.5,
    p50Ms: 120,
    p90Ms: 160,
    p95Ms: 185,
    p99Ms: 210,
    throughputRps: 1.8,
  },
];

const mockTopology = {
  nodes: [
    {
      id: 'api-gateway',
      name: 'api-gateway',
      callCount: 42,
      errorRate: 2.38,
      avgDurationMs: 130.5,
    },
  ],
  edges: [],
};

describe('TracePulse Client Dashboard Component', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/traces/11112222333344445555666677778888')) {
          return Promise.resolve({
            json: () => Promise.resolve({ success: true, data: mockDetail }),
          });
        }
        if (url.includes('/api/traces')) {
          return Promise.resolve({
            json: () => Promise.resolve({ success: true, data: mockTraces }),
          });
        }
        if (url.includes('/api/services/graph')) {
          return Promise.resolve({
            json: () => Promise.resolve({ success: true, data: mockTopology }),
          });
        }
        if (url.includes('/api/services')) {
          return Promise.resolve({
            json: () => Promise.resolve({ success: true, data: mockServices }),
          });
        }
        if (url.includes('/api/health')) {
          return Promise.resolve({
            json: () => Promise.resolve({ status: 'healthy', service: 'tracepulse-engine' }),
          });
        }
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: {} }),
        });
      })
    );
  });

  it('renders application header title and navigation tabs', async () => {
    render(<App />);

    expect(screen.getByText('TracePulse')).toBeInTheDocument();
    expect(screen.getByText('W3C OpenTelemetry APM Engine')).toBeInTheDocument();
    expect(screen.getByText(/Trace Explorer/i)).toBeInTheDocument();
    expect(screen.getByText('Service APM Matrix')).toBeInTheDocument();
    expect(screen.getByText('Topology Graph')).toBeInTheDocument();
  });

  it('renders KPI ribbon metrics correctly', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Observed Traces')).toBeInTheDocument();
      expect(screen.getByText('Global Error Rate')).toBeInTheDocument();
      expect(screen.getByText('Mean Latency')).toBeInTheDocument();
      expect(screen.getByText('P95 Peak Latency')).toBeInTheDocument();
    });
  });

  it('displays trace list and interactive waterfall timeline', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('POST /api/v1/checkout').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/trace:11112222333344445555666677778888/i)).toBeInTheDocument();
      expect(screen.getByText(/BOTTLENECK/i)).toBeInTheDocument();
    });
  });

  it('switches between tabs: APM matrix and topology graph', async () => {
    render(<App />);

    // Click on Service APM Matrix tab
    const matrixTab = screen.getByText('Service APM Matrix');
    fireEvent.click(matrixTab);

    await waitFor(() => {
      expect(screen.getByText('Service Latency Percentiles & APM Performance Matrix')).toBeInTheDocument();
      expect(screen.getByText('P95 (SLA)')).toBeInTheDocument();
      expect(screen.getByText('P99 (Tail)')).toBeInTheDocument();
    });

    // Click on Topology Graph tab
    const topoTab = screen.getByText('Topology Graph');
    fireEvent.click(topoTab);

    await waitFor(() => {
      expect(screen.getByText('Distributed Service Dependency Topology Graph (DAG)')).toBeInTheDocument();
    });
  });

  it('opens and closes W3C Traceparent modal', async () => {
    render(<App />);

    const w3cBtn = screen.getByText('W3C Traceparent');
    fireEvent.click(w3cBtn);

    expect(screen.getByText('W3C Trace Context Inspector & Propagator')).toBeInTheDocument();

    const closeBtn = screen.getByText('Close');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('W3C Trace Context Inspector & Propagator')).not.toBeInTheDocument();
    });
  });

  it('opens and closes Synthetic Traffic Simulator modal', async () => {
    render(<App />);

    const simBtn = screen.getByText('Simulate Traffic');
    fireEvent.click(simBtn);

    expect(screen.getByText('Synthetic Microservice Traffic Simulator')).toBeInTheDocument();
    expect(screen.getByText('Generate 10 Synthetic Traces')).toBeInTheDocument();

    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText('Synthetic Microservice Traffic Simulator')).not.toBeInTheDocument();
    });
  });
});
