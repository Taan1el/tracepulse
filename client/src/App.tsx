import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import type { TraceSummary, TraceDetail, ServiceMetric, ServiceTopology } from '../../shared/types.js';
import { fetchTraces, fetchTraceById, fetchServices, fetchTopology } from './services/index.js';
import { DemoBanner } from './components/DemoBanner.js';
import { Header } from './components/Header.js';
import { StatsStrip } from './components/StatsStrip.js';
import { TraceFilters } from './components/TraceFilters.js';
import { TraceTable } from './components/TraceTable.js';
import { Waterfall, SpanInspector } from './components/Waterfall.js';
import { ServicesTable } from './components/ServicesTable.js';
import { ServiceCalls } from './components/ServiceCalls.js';
import { TrafficDialog } from './components/TrafficDialog.js';
import { TraceparentDialog } from './components/TraceparentDialog.js';
import { formatCount } from './utils/pluralize.js';
import './App.css';

type View = 'services' | 'calls';

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'services', label: 'Services' },
  { id: 'calls', label: 'Service calls' },
];

export const App: React.FC = () => {
  const [view, setView] = useState<View>('services');

  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedTraceDetail, setSelectedTraceDetail] = useState<TraceDetail | null>(null);

  const [services, setServices] = useState<ServiceMetric[]>([]);
  const [topology, setTopology] = useState<ServiceTopology | null>(null);

  const [selectedService, setSelectedService] = useState('');
  const [minDuration, setMinDuration] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  const [loadingTraces, setLoadingTraces] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'traffic' | 'traceparent' | null>(null);

  const loadTraces = useCallback(async () => {
    try {
      setLoadingTraces(true);
      const data = await fetchTraces({
        service: selectedService || undefined,
        minDuration: minDuration ? parseFloat(minDuration) : undefined,
        hasError: errorsOnly ? true : undefined,
      });
      setTraces(data);
      setError(null);
      // Keep the current selection while it is still listed, otherwise open the newest trace.
      setSelectedTraceId((current) =>
        data.length === 0 ? null : current && data.some((t) => t.id === current) ? current : data[0].id
      );
    } catch (err) {
      console.error('Failed to load traces:', err);
      setError(err instanceof Error ? err.message : 'Failed to load traces');
    } finally {
      setLoadingTraces(false);
    }
  }, [selectedService, minDuration, errorsOnly]);

  const loadMetricsAndTopology = useCallback(async () => {
    try {
      const [svcData, topoData] = await Promise.all([fetchServices(), fetchTopology()]);
      setServices(svcData);
      setTopology(topoData);
    } catch (err) {
      console.error('Failed to load service metrics:', err);
      setError(err instanceof Error ? err.message : 'Failed to load service metrics');
    }
  }, []);

  useEffect(() => {
    loadTraces();
  }, [loadTraces]);

  useEffect(() => {
    loadMetricsAndTopology();
  }, [loadMetricsAndTopology]);

  useEffect(() => {
    setSelectedSpanId(null);
  }, [selectedTraceId]);

  useEffect(() => {
    if (!selectedTraceId) {
      setSelectedTraceDetail(null);
      return;
    }

    let current = true;
    setLoadingDetail(true);
    fetchTraceById(selectedTraceId)
      .then((detail) => {
        if (current) setSelectedTraceDetail(detail);
      })
      .catch((err) => {
        console.error('Failed to fetch trace detail:', err);
        if (current) setSelectedTraceDetail(null);
      })
      .finally(() => {
        if (current) setLoadingDetail(false);
      });

    return () => {
      current = false;
    };
  }, [selectedTraceId]);

  const handleRefresh = () => {
    loadTraces();
    loadMetricsAndTopology();
  };

  const query = searchQuery.trim().toLowerCase();
  const visibleTraces = traces.filter(
    (t) =>
      !query ||
      t.id.toLowerCase().includes(query) ||
      t.rootSpanName.toLowerCase().includes(query) ||
      t.services.some((s) => s.toLowerCase().includes(query))
  );

  return (
    <div className="app">
      <DemoBanner onReset={handleRefresh} />
      <Header onOpenTraffic={() => setDialog('traffic')} onOpenTraceparent={() => setDialog('traceparent')} />
      <StatsStrip traces={traces} services={services} />

      <main className="workbench">
        {error && (
          <div className="alert" role="alert">
            <span className="alert-message">
              <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" /> {error}
            </span>
            <button type="button" className="btn btn-secondary" onClick={handleRefresh}>
              Retry
            </button>
          </div>
        )}

        <aside className="col-list" aria-label="Trace list and filters">
          <TraceFilters
            services={services.map((s) => s.serviceName)}
            selectedService={selectedService}
            onSelectService={setSelectedService}
            minDuration={minDuration}
            onMinDurationChange={setMinDuration}
            errorsOnly={errorsOnly}
            onToggleErrorsOnly={setErrorsOnly}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
          <div className="list-head">
            <div className="list-title">
              <h2 className="panel-heading">Traces</h2>
              <button type="button" className="btn btn-secondary btn-compact" onClick={handleRefresh}>
                <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
                Refresh
              </button>
            </div>
            <p className="list-note">
              {query
                ? `${formatCount(visibleTraces.length, 'match', 'matches')} among ${formatCount(traces.length, 'loaded trace')}.`
                : `${traces.length} loaded, newest first.`}
            </p>
          </div>
          <TraceTable
            traces={visibleTraces}
            selectedTraceId={selectedTraceId}
            onSelectTrace={setSelectedTraceId}
            loading={loadingTraces}
          />
        </aside>

        <div className="col-main">
          <Waterfall
            key={selectedTraceDetail?.summary.id ?? 'none'}
            trace={selectedTraceDetail}
            loading={loadingDetail}
            selectedSpanId={selectedSpanId}
            onSelectSpan={setSelectedSpanId}
          />

          <section className="tabs-panel">
            <nav className="tab-bar" aria-label="Service views">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="tab-btn"
                  aria-current={view === v.id ? 'page' : undefined}
                  onClick={() => setView(v.id)}
                >
                  {v.label}
                </button>
              ))}
            </nav>

            {view === 'services' && (
              <div className="tab-body">
                <h2 className="panel-heading">Service latency</h2>
                <p className="section-description">Percentiles and error rate for the spans each service recorded.</p>
                <ServicesTable metrics={services} />
              </div>
            )}

            {view === 'calls' && (
              <div className="tab-body">
                <h2 className="panel-heading">Service calls</h2>
                <p className="section-description">Which service calls which, found from parent and child spans in different services.</p>
                <ServiceCalls topology={topology} />
              </div>
            )}
          </section>
        </div>

        <aside className="col-inspector" aria-label="Span inspector">
          <SpanInspector trace={selectedTraceDetail} spanId={selectedSpanId} />
        </aside>
      </main>

      <footer className="app-footer">
        <span>TracePulse 1.0.0, MIT license</span>
        <a href="https://github.com/Taan1el/tracepulse" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>

      {dialog === 'traffic' && <TrafficDialog onClose={() => setDialog(null)} onGenerated={handleRefresh} />}
      {dialog === 'traceparent' && <TraceparentDialog onClose={() => setDialog(null)} />}
    </div>
  );
};

export default App;
