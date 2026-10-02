import { DatabaseSync } from 'node:sqlite';
import type {
  SpanRecord,
  TraceSummary,
  ServiceMetric,
  ServiceDependencyEdge,
} from '../../../shared/types.js';
import { computeDependencies, computeServiceMetrics } from '../../../shared/analytics.js';

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
      sql += ` AND (root_service_name = ? OR EXISTS (
        SELECT 1 FROM json_each(traces.services_json) AS service
        WHERE service.value = ?
      ))`;
      params.push(filter.serviceName, filter.serviceName);
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

  getServiceMetrics(): ServiceMetric[] {
    const rows = this.db
      .prepare('SELECT service_name, duration_ms, status_code FROM spans')
      .all() as any[];

    return computeServiceMetrics(
      rows.map((r) => ({ serviceName: r.service_name, durationMs: r.duration_ms, statusCode: r.status_code }))
    );
  }

  getServiceDependencies(): ServiceDependencyEdge[] {
    const rows = this.db
      .prepare('SELECT id, parent_span_id, service_name, duration_ms, status_code FROM spans')
      .all() as any[];

    return computeDependencies(
      rows.map((r) => ({
        id: r.id,
        parentSpanId: r.parent_span_id,
        serviceName: r.service_name,
        durationMs: r.duration_ms,
        statusCode: r.status_code,
      }))
    );
  }
}
