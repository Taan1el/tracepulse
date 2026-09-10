import { DatabaseSync } from 'node:sqlite';
import type {
  SpanRecord,
  TraceSummary,
  ServiceMetric,
  ServiceDependencyEdge,
} from '../../../shared/types.js';
import { computeLatencyStats } from '../services/percentile.js';

export class TraceRepository {
  constructor(private db: DatabaseSync) {}

  saveTraceWithSpans(summary: TraceSummary, spans: SpanRecord[]): void {
    const insertTrace = this.db.prepare(`
      INSERT OR REPLACE INTO traces (
        id, root_span_name, root_service_name, start_time_ms, duration_ms,
        span_count, services_json, has_error, http_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSpan = this.db.prepare(`
      INSERT OR REPLACE INTO spans (
        id, trace_id, parent_span_id, service_name, name, kind,
        start_time_ms, end_time_ms, duration_ms, status_code, status_message,
        attributes_json, events_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Execute within transaction
    this.db.exec('BEGIN TRANSACTION;');
    try {
      insertTrace.run(
        summary.id,
        summary.rootSpanName,
        summary.rootServiceName,
        summary.startTimeMs,
        summary.durationMs,
        summary.spanCount,
        JSON.stringify(summary.services),
        summary.hasError ? 1 : 0,
        summary.httpStatus ?? null,
        summary.createdAt
      );

      for (const span of spans) {
        insertSpan.run(
          span.id,
          span.traceId,
          span.parentSpanId ?? null,
          span.serviceName,
          span.name,
          span.kind,
          span.startTimeMs,
          span.endTimeMs,
          span.durationMs,
          span.statusCode,
          span.statusMessage ?? null,
          JSON.stringify(span.attributes || {}),
          JSON.stringify(span.events || [])
        );
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  getTraceSummaryById(traceId: string): TraceSummary | null {
    const row = this.db.prepare('SELECT * FROM traces WHERE id = ?').get(traceId) as any;
    if (!row) return null;

    return {
      id: row.id,
      rootSpanName: row.root_span_name,
      rootServiceName: row.root_service_name,
      startTimeMs: row.start_time_ms,
      durationMs: row.duration_ms,
      spanCount: row.span_count,
      services: JSON.parse(row.services_json || '[]'),
      hasError: row.has_error === 1,
      httpStatus: row.http_status,
      createdAt: row.created_at,
    };
  }

  getSpansByTraceId(traceId: string): SpanRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time_ms ASC')
      .all(traceId) as any[];

    return rows.map((r) => ({
      id: r.id,
      traceId: r.trace_id,
      parentSpanId: r.parent_span_id,
      serviceName: r.service_name,
      name: r.name,
      kind: r.kind,
      startTimeMs: r.start_time_ms,
      endTimeMs: r.end_time_ms,
      durationMs: r.duration_ms,
      statusCode: r.status_code,
      statusMessage: r.status_message,
      attributes: JSON.parse(r.attributes_json || '{}'),
      events: JSON.parse(r.events_json || '[]'),
    }));
  }

  queryTraces(filter?: {
    serviceName?: string;
    minDurationMs?: number;
    maxDurationMs?: number;
    hasError?: boolean;
    limit?: number;
  }): TraceSummary[] {
    let sql = 'SELECT * FROM traces WHERE 1=1';
    const params: any[] = [];

    if (filter?.serviceName) {
      sql += ' AND (root_service_name = ? OR services_json LIKE ?)';
      params.push(filter.serviceName, `%"${filter.serviceName}"%`);
    }

    if (filter?.minDurationMs !== undefined) {
      sql += ' AND duration_ms >= ?';
      params.push(filter.minDurationMs);
    }

    if (filter?.maxDurationMs !== undefined) {
      sql += ' AND duration_ms <= ?';
      params.push(filter.maxDurationMs);
    }

    if (filter?.hasError !== undefined) {
      sql += ' AND has_error = ?';
      params.push(filter.hasError ? 1 : 0);
    }

    sql += ' ORDER BY start_time_ms DESC LIMIT ?';
    params.push(filter?.limit || 50);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map((row) => ({
      id: row.id,
      rootSpanName: row.root_span_name,
      rootServiceName: row.root_service_name,
      startTimeMs: row.start_time_ms,
      durationMs: row.duration_ms,
      spanCount: row.span_count,
      services: JSON.parse(row.services_json || '[]'),
      hasError: row.has_error === 1,
      httpStatus: row.http_status,
      createdAt: row.created_at,
    }));
  }

  getAllServices(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT service_name FROM spans ORDER BY service_name ASC')
      .all() as any[];
    return rows.map((r) => r.service_name);
  }

  getServiceMetrics(): ServiceMetric[] {
    const services = this.getAllServices();
    const metrics: ServiceMetric[] = [];

    for (const sName of services) {
      const rows = this.db
        .prepare('SELECT duration_ms, status_code FROM spans WHERE service_name = ?')
        .all(sName) as any[];

      const durations = rows.map((r) => r.duration_ms);
      const stats = computeLatencyStats(durations);
      const errorCount = rows.filter((r) => r.status_code === 'ERROR').length;
      const errorRate =
        rows.length > 0 ? Math.round((errorCount / rows.length) * 10000) / 100 : 0;

      // Estimate throughput: request count divided by time window or relative metric
      const throughputRps = Math.round((rows.length / Math.max(1, 60)) * 100) / 100;

      metrics.push({
        serviceName: sName,
        requestCount: rows.length,
        errorCount,
        errorRate,
        avgDurationMs: stats.avgMs,
        p50Ms: stats.p50Ms,
        p90Ms: stats.p90Ms,
        p95Ms: stats.p95Ms,
        p99Ms: stats.p99Ms,
        throughputRps,
      });
    }

    return metrics;
  }

  getServiceDependencies(): ServiceDependencyEdge[] {
    // Find parent-child spans crossing service boundaries
    const rows = this.db
      .prepare(`
        SELECT 
          p.service_name AS source,
          c.service_name AS target,
          c.duration_ms AS duration,
          c.status_code AS status
        FROM spans c
        JOIN spans p ON c.parent_span_id = p.id
        WHERE c.service_name != p.service_name
      `)
      .all() as any[];

    const edgeMap = new Map<
      string,
      { source: string; target: string; durations: number[]; errorCount: number }
    >();

    for (const r of rows) {
      const key = `${r.source}->${r.target}`;
      let entry = edgeMap.get(key);
      if (!entry) {
        entry = { source: r.source, target: r.target, durations: [], errorCount: 0 };
        edgeMap.set(key, entry);
      }
      entry.durations.push(r.duration);
      if (r.status === 'ERROR') {
        entry.errorCount++;
      }
    }

    const edges: ServiceDependencyEdge[] = [];
    for (const [key, entry] of edgeMap.entries()) {
      const sum = entry.durations.reduce((a, b) => a + b, 0);
      const avgDurationMs =
        entry.durations.length > 0
          ? Math.round((sum / entry.durations.length) * 100) / 100
          : 0;

      edges.push({
        id: key,
        source: entry.source,
        target: entry.target,
        callCount: entry.durations.length,
        avgDurationMs,
        errorCount: entry.errorCount,
      });
    }

    return edges;
  }
}
