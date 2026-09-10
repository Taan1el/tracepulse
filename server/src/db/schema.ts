import { DatabaseSync } from 'node:sqlite';

export function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      root_span_name TEXT NOT NULL,
      root_service_name TEXT NOT NULL,
      start_time_ms INTEGER NOT NULL,
      duration_ms REAL NOT NULL,
      span_count INTEGER NOT NULL,
      services_json TEXT NOT NULL,
      has_error INTEGER NOT NULL,
      http_status INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spans (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      parent_span_id TEXT,
      service_name TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      start_time_ms INTEGER NOT NULL,
      end_time_ms INTEGER NOT NULL,
      duration_ms REAL NOT NULL,
      status_code TEXT NOT NULL,
      status_message TEXT,
      attributes_json TEXT NOT NULL,
      events_json TEXT,
      FOREIGN KEY(trace_id) REFERENCES traces(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
    CREATE INDEX IF NOT EXISTS idx_spans_service ON spans(service_name);
    CREATE INDEX IF NOT EXISTS idx_spans_start ON spans(start_time_ms);
    CREATE INDEX IF NOT EXISTS idx_traces_start ON traces(start_time_ms);
    CREATE INDEX IF NOT EXISTS idx_traces_service ON traces(root_service_name);
    CREATE INDEX IF NOT EXISTS idx_traces_has_error ON traces(has_error);
  `);
}
