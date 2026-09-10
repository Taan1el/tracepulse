import type { SpanRecord, TraceDetail } from '../../../shared/types.js';
import { TraceService } from './trace.service.js';
import { generateTraceId, generateSpanId } from './traceparent.js';

export class SimulatorService {
  constructor(private traceService: TraceService) {}

  simulateFlow(
    flowType: 'checkout' | 'auth' | 'search' = 'checkout',
    injectAnomaly = false
  ): TraceDetail {
    const traceId = generateTraceId();
    const now = Date.now() - Math.floor(Math.random() * 5000);

    if (flowType === 'checkout') {
      return this.generateCheckoutTrace(traceId, now, injectAnomaly);
    } else if (flowType === 'auth') {
      return this.generateAuthTrace(traceId, now, injectAnomaly);
    } else {
      return this.generateSearchTrace(traceId, now, injectAnomaly);
    }
  }

  simulateBatch(count = 5): TraceDetail[] {
    const types: Array<'checkout' | 'auth' | 'search'> = ['checkout', 'auth', 'search'];
    const results: TraceDetail[] = [];

    for (let i = 0; i < count; i++) {
      const type = types[i % types.length];
      const anomaly = Math.random() < 0.25; // 25% error rate for realism
      results.push(this.simulateFlow(type, anomaly));
    }

    return results;
  }

  private generateCheckoutTrace(traceId: string, baseTime: number, anomaly: boolean): TraceDetail {
    const spans: Array<Omit<SpanRecord, 'durationMs'>> = [];

    // Root Span: api-gateway
    const rootSpanId = generateSpanId();
    const authSpanId = generateSpanId();
    const invSpanId = generateSpanId();
    const paySpanId = generateSpanId();
    const notifSpanId = generateSpanId();

    const rootDuration = anomaly ? 820 + Math.floor(Math.random() * 300) : 180 + Math.floor(Math.random() * 70);

    spans.push({
      id: rootSpanId,
      traceId,
      parentSpanId: null,
      serviceName: 'api-gateway',
      name: 'POST /api/v1/checkout',
      kind: 'SERVER',
      startTimeMs: baseTime,
      endTimeMs: baseTime + rootDuration,
      statusCode: anomaly ? 'ERROR' : 'OK',
      statusMessage: anomaly ? 'Downstream payment gateway timeout' : undefined,
      attributes: {
        'http.method': 'POST',
        'http.route': '/api/v1/checkout',
        'http.status_code': anomaly ? 504 : 201,
        'user.id': 'usr_984102',
        'cart.total_cents': 14950,
      },
    });

    // Step 1: Auth check
    const authDuration = 22 + Math.floor(Math.random() * 15);
    spans.push({
      id: authSpanId,
      traceId,
      parentSpanId: rootSpanId,
      serviceName: 'auth-service',
      name: 'verify_jwt_claims',
      kind: 'INTERNAL',
      startTimeMs: baseTime + 5,
      endTimeMs: baseTime + 5 + authDuration,
      statusCode: 'OK',
      attributes: {
        'auth.strategy': 'jwt-rs256',
        'tenant.id': 'org_nordic_fin',
      },
    });

    // Step 2: Inventory reservation
    const invDuration = 35 + Math.floor(Math.random() * 20);
    spans.push({
      id: invSpanId,
      traceId,
      parentSpanId: rootSpanId,
      serviceName: 'inventory-service',
      name: 'reserve_warehouse_stock',
      kind: 'SERVER',
      startTimeMs: baseTime + 30,
      endTimeMs: baseTime + 30 + invDuration,
      statusCode: 'OK',
      attributes: {
        'sku.count': 3,
        'warehouse.id': 'wh_tallinn_central',
        'db.system': 'postgresql',
        'db.statement': 'SELECT * FROM inventory WHERE sku IN (...) FOR UPDATE',
      },
    });

    // Step 3: Payment
    const payStart = baseTime + 70;
    const payDuration = anomaly ? 720 : 65 + Math.floor(Math.random() * 30);
    spans.push({
      id: paySpanId,
      traceId,
      parentSpanId: rootSpanId,
      serviceName: 'payment-service',
      name: 'stripe.charges.create',
      kind: 'CLIENT',
      startTimeMs: payStart,
      endTimeMs: payStart + payDuration,
      statusCode: anomaly ? 'ERROR' : 'OK',
      statusMessage: anomaly ? 'Stripe Gateway Connection Timeout (ETIMEDOUT)' : undefined,
      attributes: {
        'payment.provider': 'stripe',
        'currency': 'EUR',
        'retry.count': anomaly ? 3 : 0,
      },
      events: anomaly
        ? [
            {
              name: 'network.timeout',
              timestampMs: payStart + 600,
              attributes: { 'retry.attempt': 2 },
            },
          ]
        : undefined,
    });

    // Step 4: Notification (only if not anomaly)
    if (!anomaly) {
      const notifStart = baseTime + 140;
      spans.push({
        id: notifSpanId,
        traceId,
        parentSpanId: rootSpanId,
        serviceName: 'notification-worker',
        name: 'dispatch_order_confirmation',
        kind: 'PRODUCER',
        startTimeMs: notifStart,
        endTimeMs: notifStart + 28,
        statusCode: 'OK',
        attributes: {
          'channel': 'email',
          'template': 'order_confirmed_v2',
        },
      });
    }

    return this.traceService.ingestSpans(spans);
  }

  private generateAuthTrace(traceId: string, baseTime: number, anomaly: boolean): TraceDetail {
    const spans: Array<Omit<SpanRecord, 'durationMs'>> = [];
    const rootSpanId = generateSpanId();
    const redisSpanId = generateSpanId();
    const dbSpanId = generateSpanId();

    const rootDuration = anomaly ? 140 : 42 + Math.floor(Math.random() * 20);

    spans.push({
      id: rootSpanId,
      traceId,
      parentSpanId: null,
      serviceName: 'auth-service',
      name: 'POST /auth/token',
      kind: 'SERVER',
      startTimeMs: baseTime,
      endTimeMs: baseTime + rootDuration,
      statusCode: anomaly ? 'ERROR' : 'OK',
      statusMessage: anomaly ? 'Invalid credentials: Hash mismatch' : undefined,
      attributes: {
        'http.method': 'POST',
        'http.status_code': anomaly ? 401 : 200,
        'client.ip': '193.40.12.8',
      },
    });

    spans.push({
      id: redisSpanId,
      traceId,
      parentSpanId: rootSpanId,
      serviceName: 'redis-cache',
      name: 'GET rate_limit:login:193.40.12.8',
      kind: 'CLIENT',
      startTimeMs: baseTime + 3,
      endTimeMs: baseTime + 8,
      statusCode: 'OK',
      attributes: {
        'db.system': 'redis',
        'redis.command': 'GET',
        'redis.hit': true,
      },
    });

    spans.push({
      id: dbSpanId,
      traceId,
      parentSpanId: rootSpanId,
      serviceName: 'postgres-db',
      name: 'SELECT user FROM users WHERE email = ?',
      kind: 'CLIENT',
      startTimeMs: baseTime + 10,
      endTimeMs: baseTime + 32,
      statusCode: 'OK',
      attributes: {
        'db.system': 'postgresql',
        'db.statement': 'SELECT id, password_hash, mfa_secret FROM users WHERE email = $1',
      },
    });

    return this.traceService.ingestSpans(spans);
  }

  private generateSearchTrace(traceId: string, baseTime: number, anomaly: boolean): TraceDetail {
    const spans: Array<Omit<SpanRecord, 'durationMs'>> = [];
    const rootSpanId = generateSpanId();
    const searchSpanId = generateSpanId();
    const rankSpanId = generateSpanId();

    const rootDuration = 95 + Math.floor(Math.random() * 40);

    spans.push({
      id: rootSpanId,
      traceId,
      parentSpanId: null,
      serviceName: 'api-gateway',
      name: 'GET /catalog/search',
      kind: 'SERVER',
      startTimeMs: baseTime,
      endTimeMs: baseTime + rootDuration,
      statusCode: 'OK',
      attributes: {
        'http.method': 'GET',
        'http.route': '/catalog/search',
        'http.status_code': 200,
        'search.query': 'fintech microservices',
      },
    });

    spans.push({
      id: searchSpanId,
      traceId,
      parentSpanId: rootSpanId,
      serviceName: 'search-service',
      name: 'elasticsearch.search',
      kind: 'CLIENT',
      startTimeMs: baseTime + 12,
      endTimeMs: baseTime + 65,
      statusCode: 'OK',
      attributes: {
        'db.system': 'elasticsearch',
        'search.hits': 42,
        'index.name': 'products_v3',
      },
    });

    spans.push({
      id: rankSpanId,
      traceId,
      parentSpanId: rootSpanId,
      serviceName: 'recommendation-engine',
      name: 'vector_rerank',
      kind: 'INTERNAL',
      startTimeMs: baseTime + 68,
      endTimeMs: baseTime + rootDuration - 4,
      statusCode: anomaly ? 'ERROR' : 'OK',
      statusMessage: anomaly ? 'Inference Model OOM' : undefined,
      attributes: {
        'model.name': 'bert-embed-small',
        'input.tokens': 128,
      },
    });

    return this.traceService.ingestSpans(spans);
  }
}
