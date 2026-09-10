import { Router } from 'express';
import { TraceController } from '../controllers/trace.controller.js';

export function createApiRouter(controller: TraceController): Router {
  const router = Router();

  // System & Health
  router.get('/health', controller.health);

  // Traces & Spans
  router.post('/traces', controller.ingest);
  router.get('/traces', controller.queryTraces);
  router.get('/traces/:id', controller.getTraceById);

  // Services & APM Metrics
  router.get('/services', controller.getServices);
  router.get('/services/graph', controller.getServiceTopology);

  // Traffic Simulation
  router.post('/simulate', controller.simulate);

  // W3C TraceContext Tooling
  router.get('/w3c/parse', controller.parseTraceparentHeader);
  router.get('/w3c/context', controller.generateContext);

  return router;
}
