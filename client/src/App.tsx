import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import type {
  TraceSummary,
  TraceDetail,
  ServiceMetric,
  ServiceTopology,
} from '../../shared/types.js';
import {
  fetchTraces,
  fetchTraceById,
  fetchServices,
  fetchTopology,
} from './services/api.js';
import { Header } from './components/Header.js';
import { MetricsRibbon } from './components/MetricsRibbon.js';
import { TraceFilterBar } from './components/TraceFilterBar.js';
import { TraceListTable } from './components/TraceListTable.js';
import { TraceWaterfallView } from './components/TraceWaterfallView.js';
import { ServiceMetricsTable } from './components/ServiceMetricsTable.js';
import { ServiceTopologyGraph } from './components/ServiceTopologyGraph.js';
import { W3CModal } from './components/W3CModal.js';
import { TrafficSimModal } from './components/TrafficSimModal.js';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'explorer' | 'metrics' | 'topology'>('explorer');

  // Traces & Selected Detail
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedTraceDetail, setSelectedTraceDetail] = useState<TraceDetail | null>(null);

  // Metrics & Topology
  const [services, setServices] = useState<ServiceMetric[]>([]);
  const [topology, setTopology] = useState<ServiceTopology | null>(null);

  // Filters
  const [selectedService, setSelectedService] = useState('');
  const [minDuration, setMinDuration] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & Loaders
  const [loadingTraces, setLoadingTraces] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isTrafficModalOpen, setIsTrafficModalOpen] = useState(false);
  const [isW3CModalOpen, setIsW3CModalOpen] = useState(false);

  // Load trace list
  const loadTraces = useCallback(async () => {
    try {
      setLoadingTraces(true);
      const data = await fetchTraces({
        service: selectedService || undefined,
        minDuration: minDuration ? parseFloat(minDuration) : undefined,
        hasError: errorsOnly ? true : undefined,
      });
      setTraces(data);

      // Auto-select first trace if none selected or previous is gone
      if (data.length > 0 && (!selectedTraceId || !data.some((t) => t.id === selectedTraceId))) {
        setSelectedTraceId(data[0].id);
      } else if (data.length === 0) {
        setSelectedTraceId(null);
        setSelectedTraceDetail(null);
      }
    } catch (err) {
      console.error('Failed to load traces:', err);
    } finally {
      setLoadingTraces(false);
    }
  }, [selectedService, minDuration, errorsOnly, selectedTraceId]);

  // Load auxiliary APM metrics and topology
  const loadMetricsAndTopology = useCallback(async () => {
    try {
      const [svcData, topoData] = await Promise.all([fetchServices(), fetchTopology()]);
      setServices(svcData);
      setTopology(topoData);
    } catch (err) {
      console.error('Failed to load APM metrics/topology:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadTraces();
    loadMetricsAndTopology();
  }, [loadTraces, loadMetricsAndTopology]);

  // Load selected trace details
  useEffect(() => {
    if (!selectedTraceId) {
      setSelectedTraceDetail(null);
      return;
    }

    let isMounted = true;
    const fetchDetail = async () => {
      try {
        setLoadingDetail(true);
        const detail = await fetchTraceById(selectedTraceId);
        if (isMounted) setSelectedTraceDetail(detail);
      } catch (err) {
        console.error('Failed to fetch trace detail:', err);
      } finally {
        if (isMounted) setLoadingDetail(false);
      }
    };

    fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [selectedTraceId]);

  // Refresh all
  const handleRefresh = () => {
    loadTraces();
    loadMetricsAndTopology();
  };

  // Filter traces by search query
  const filteredTraces = traces.filter((t) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.id.toLowerCase().includes(q) ||
      t.rootSpanName.toLowerCase().includes(q) ||
      t.services.some((s) => s.toLowerCase().includes(q))
    );
  });

  const availableServiceNames = services.map((s) => s.serviceName);

  return (
    <div className="app-container">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenTrafficModal={() => setIsTrafficModalOpen(true)}
        onOpenW3CModal={() => setIsW3CModalOpen(true)}
        totalTraces={traces.length}
      />

      <main className="main-content">
        <MetricsRibbon traces={traces} services={services} />

        {activeTab === 'explorer' && (
          <>
            <TraceFilterBar
              services={availableServiceNames}
              selectedService={selectedService}
              onSelectService={setSelectedService}
              minDuration={minDuration}
              onMinDurationChange={setMinDuration}
              errorsOnly={errorsOnly}
              onToggleErrorsOnly={setErrorsOnly}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onRefresh={handleRefresh}
            />

            <div className="split-layout">
              <TraceListTable
                traces={filteredTraces}
                selectedTraceId={selectedTraceId}
                onSelectTrace={setSelectedTraceId}
                loading={loadingTraces}
              />
              <TraceWaterfallView
                trace={selectedTraceDetail}
                loading={loadingDetail}
              />
            </div>
          </>
        )}

        {activeTab === 'metrics' && (
          <ServiceMetricsTable metrics={services} loading={false} />
        )}

        {activeTab === 'topology' && (
          <ServiceTopologyGraph topology={topology} loading={false} />
        )}
      </main>

      <W3CModal
        isOpen={isW3CModalOpen}
        onClose={() => setIsW3CModalOpen(false)}
      />

      <TrafficSimModal
        isOpen={isTrafficModalOpen}
        onClose={() => setIsTrafficModalOpen(false)}
        onTrafficGenerated={handleRefresh}
      />
    </div>
  );
};

export default App;
