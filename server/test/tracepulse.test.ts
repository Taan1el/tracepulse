import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { parseTraceparent, formatTraceparent, isValidTraceId, isValidSpanId } from '../../shared/traceparent.js';
import { computeLatencyStats, calculatePercentile } from '../../shared/percentile.js';
import { buildSpanTree } from '../../shared/trace-tree.js';
import type { SpanRecord } from '../../shared/types.js';

describe('TracePulse Engine Test Suite', () => {
  describe('W3C TraceContext Standard Parsing & Generation', () => {
    it('parses valid W3C traceparent header correctly', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const parsed = parseTraceparent(header);

      expect(parsed).not.toBeNull();
      expect(parsed?.version).toBe('00');
      expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(parsed?.parentSpanId).toBe('00f067aa0ba902b7');
      expect(parsed?.traceFlags).toBe('01');
    });

    it('formats W3C traceparent header correctly', () => {
      const tp = {
        version: '00',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        parentSpanId: '00f067aa0ba902b7',
        traceFlags: '01',
      };
      expect(formatTraceparent(tp)).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
    });

    it('rejects invalid traceparent formats', () => {
      expect(parseTraceparent('')).toBeNull();
      expect(parseTraceparent('invalid-header')).toBeNull();
      expect(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull(); // version ff
      expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull(); // all zeros traceId
      expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01')).toBeNull(); // all zeros spanId
    });

    it('validates 32-hex traceId and 16-hex spanId', () => {
      expect(isValidTraceId('4bf92f3577b34da6a3ce929d0e0e4736')).toBe(true);
      expect(isValidTraceId('too-short')).toBe(false);
      expect(isValidSpanId('00f067aa0ba902b7')).toBe(true);
      expect(isValidSpanId('12345')).toBe(false);
    });
  });

  describe('Latency Percentile Computation Engine', () => {
    it('calculates p50, p90, p95, and p99 accurately', () => {
      // 100 values from 1 to 100
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const stats = computeLatencyStats(values);

      expect(stats.count).toBe(100);
      expect(stats.avgMs).toBe(50.5);
      expect(stats.minMs).toBe(1);
      expect(stats.maxMs).toBe(100);
      expect(stats.p50Ms).toBe(50.5);
      expect(stats.p90Ms).toBe(90.1);
      expect(stats.p95Ms).toBe(95.05);
      expect(stats.p99Ms).toBe(99.01);
    });

    it('handles empty and single element edge cases', () => {
      const emptyStats = computeLatencyStats([]);
      expect(emptyStats.count).toBe(0);
      expect(emptyStats.avgMs).toBe(0);

      const single = [42];
      expect(calculatePercentile(single, 50)).toBe(42);
      expect(calculatePercentile(single, 99)).toBe(42);
    });
  });

  describe('Hierarchical Span Tree & Bottleneck Profiling', () => {
    it('reconstructs span DAG hierarchy and identifies bottleneck span', () => {
      const spans: SpanRecord[] = [
        {
          id: '1111111111111111',
          traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          parentSpanId: null,
          serviceName: 'gateway',
          name: 'GET /checkout',
          kind: 'SERVER',
          startTimeMs: 1000,
          endTimeMs: 1500,
          durationMs: 500,
          statusCode: 'OK',
          attributes: {},
        },
        {
          id: '2222222222222222',
          traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          parentSpanId: '1111111111111111',
          serviceName: 'auth',
          name: 'verify_token',
          kind: 'INTERNAL',
          startTimeMs: 1020,
          endTimeMs: 1080,
          durationMs: 60,
          statusCode: 'OK',
          attributes: {},
        },
        {
          id: '3333333333333333',
          traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          parentSpanId: '1111111111111111',
          serviceName: 'payment',
          name: 'charge_card',
          kind: 'CLIENT',
          startTimeMs: 1100,
          endTimeMs: 1480,
          durationMs: 380,
          statusCode: 'OK',
          attributes: {},
        },
      ];

      const result = buildSpanTree(spans);
      expect(result.rootNode).not.toBeNull();
      expect(result.rootNode?.name).toBe('GET /checkout');
      expect(result.rootNode?.children.length).toBe(2);
      expect(result.totalDurationMs).toBe(500);

      // Verify bottleneck was identified as payment (380ms)
      expect(result.bottleneckSpanId).toBe('3333333333333333');
      const paymentNode = result.rootNode?.children.find((c) => c.id === '3333333333333333');
      expect(paymentNode?.isBottleneck).toBe(true);
      expect(paymentNode?.offsetMs).toBe(100);
    });
  });

  describe('REST API Endpoints Integration', () => {
    let app: any;

    beforeEach(() => {
      // Use in-memory SQLite database without initial seeding for isolated tests
      const ctx = createApp(':memory:', false);
      app = ctx.app;
    });

    it('returns healthy status on /api/health', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.service).toBe('tracepulse-engine');
    });

    it('ingests distributed spans and queries them back', async () => {
      const payload = {
        spans: [
          {
            id: 'aaaaaaaaaaaaaaaa',
            traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            parentSpanId: null,
            serviceName: 'order-service',
            name: 'POST /orders',
            kind: 'SERVER',
            startTimeMs: 1700000000000,
            endTimeMs: 1700000000200,
            statusCode: 'OK',
            attributes: { 'http.status_code': 201 },
          },
          {
            id: 'cccccccccccccccc',
            traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            parentSpanId: 'aaaaaaaaaaaaaaaa',
            serviceName: 'warehouse-service',
            name: 'allocate_stock',
            kind: 'CLIENT',
            startTimeMs: 1700000000050,
            endTimeMs: 1700000000180,
            statusCode: 'OK',
            attributes: {},
          },
        ],
      };

      const ingestRes = await request(app)
        .post('/api/traces')
        .send(payload);

      expect(ingestRes.status).toBe(201);
      expect(ingestRes.body.success).toBe(true);
      expect(ingestRes.body.data.summary.id).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      expect(ingestRes.body.data.summary.services).toContain('order-service');
      expect(ingestRes.body.data.summary.services).toContain('warehouse-service');

      // Query traces
      const listRes = await request(app).get('/api/traces');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].id).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

      // Get trace by ID
      const detailRes = await request(app).get('/api/traces/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.rootSpan.name).toBe('POST /orders');
      expect(detailRes.body.data.rootSpan.children.length).toBe(1);
    });

    it('derives service metrics and dependency topology graph', async () => {
      // Ingest test trace crossing boundaries
      await request(app)
        .post('/api/traces')
        .send({
          spans: [
            {
              id: '1000000000000001',
              traceId: '20000000000000000000000000000002',
              parentSpanId: null,
              serviceName: 'api-gateway',
              name: 'GET /api',
              kind: 'SERVER',
              startTimeMs: 1000,
              endTimeMs: 1100,
              statusCode: 'OK',
              attributes: {},
            },
            {
              id: '1000000000000002',
              traceId: '20000000000000000000000000000002',
              parentSpanId: '1000000000000001',
              serviceName: 'user-service',
              name: 'fetch_user',
              kind: 'CLIENT',
              startTimeMs: 1020,
              endTimeMs: 1080,
              statusCode: 'OK',
              attributes: {},
            },
          ],
        });

      // Get metrics
      const metricsRes = await request(app).get('/api/services');
      expect(metricsRes.status).toBe(200);
      expect(metricsRes.body.data.length).toBe(2);
      const gatewayMetric = metricsRes.body.data.find((m: any) => m.serviceName === 'api-gateway');
      expect(gatewayMetric).toBeDefined();
      expect(gatewayMetric.requestCount).toBe(1);

      // Get topology graph
      const topoRes = await request(app).get('/api/services/graph');
      expect(topoRes.status).toBe(200);
      expect(topoRes.body.data.edges.length).toBe(1);
      expect(topoRes.body.data.edges[0].source).toBe('api-gateway');
      expect(topoRes.body.data.edges[0].target).toBe('user-service');
    });

    it('simulates synthetic trace traffic with /api/simulate', async () => {
      const res = await request(app)
        .post('/api/simulate')
        .send({ flowType: 'checkout', injectAnomaly: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary.rootServiceName).toBe('api-gateway');
      expect(res.body.data.rawSpans.length).toBeGreaterThanOrEqual(4);
    });

    it('parses W3C traceparent header and propagates next context', async () => {
      const res = await request(app)
        .get('/api/w3c/parse')
        .set('traceparent', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');

      expect(res.status).toBe(200);
      expect(res.body.data.parsed.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(res.body.data.propagatedHeader).toContain('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(res.body.data.childSpanId).toBeDefined();
    });
  });
});
