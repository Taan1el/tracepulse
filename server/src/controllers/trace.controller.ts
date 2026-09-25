import { Request, Response } from 'express';
import { TraceService } from '../services/trace.service.js';
import { SimulatorService } from '../services/simulator.service.js';
import { parseTraceQuery, TraceQueryError } from './trace-query.js';
import { parseTraceparent, formatTraceparent, generateTraceId, generateSpanId } from '../services/traceparent.js';

export class TraceController {
  constructor(
    private traceService: TraceService,
    private simulatorService: SimulatorService
  ) {}

  health = (_req: Request, res: Response): void => {
    res.json({
      status: 'healthy',
      service: 'tracepulse-engine',
      timestamp: new Date().toISOString(),
    });
  };

  ingest = (req: Request, res: Response): void => {
    try {
      const { spans } = req.body;
      if (!spans || !Array.isArray(spans)) {
        res.status(400).json({ success: false, error: 'Expected { spans: [] } in request body' });
        return;
      }

      const result = this.traceService.ingestSpans(spans);
      res.status(201).json({ success: true, data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || 'Ingestion failed' });
    }
  };

  queryTraces = (req: Request, res: Response): void => {
    try {
      const traces = this.traceService.queryTraces(parseTraceQuery(req.query));

      res.json({ success: true, data: traces });
    } catch (err: any) {
      res.status(err instanceof TraceQueryError ? 400 : 500)
        .json({ success: false, error: err.message || 'Query failed' });
    }
  };

  getTraceById = (req: Request, res: Response): void => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const trace = this.traceService.getTraceById(id);

      if (!trace) {
        res.status(404).json({ success: false, error: `Trace not found: ${id}` });
        return;
      }

      res.json({ success: true, data: trace });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to retrieve trace' });
    }
  };

  getServices = (_req: Request, res: Response): void => {
    try {
      const metrics = this.traceService.getServiceMetrics();
      res.json({ success: true, data: metrics });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to retrieve services' });
    }
  };

  getServiceTopology = (_req: Request, res: Response): void => {
    try {
      const topology = this.traceService.getServiceTopology();
      res.json({ success: true, data: topology });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to retrieve topology' });
    }
  };

  simulate = (req: Request, res: Response): void => {
    try {
      const { flowType = 'checkout', injectAnomaly = false, batchCount } = req.body;

      if (flowType === 'batch' || (batchCount && batchCount > 1)) {
        const count = Math.min(20, Math.max(1, batchCount || 5));
        const traces = this.simulatorService.simulateBatch(count);
        res.json({ success: true, count: traces.length, data: traces.map((t) => t.summary) });
      } else {
        const trace = this.simulatorService.simulateFlow(flowType, injectAnomaly);
        res.json({ success: true, data: trace });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Simulation failed' });
    }
  };

  parseTraceparentHeader = (req: Request, res: Response): void => {
    try {
      const header = (req.headers['traceparent'] as string) || (req.query.traceparent as string);
      if (!header) {
        res.status(400).json({ success: false, error: 'Missing traceparent header or query parameter' });
        return;
      }

      const parsed = parseTraceparent(header);
      if (!parsed) {
        res.status(400).json({ success: false, error: 'Invalid W3C traceparent header format' });
        return;
      }

      // Generate next child span context for propagation demo
      const childSpanId = generateSpanId();
      const propagatedHeader = formatTraceparent({
        ...parsed,
        parentSpanId: childSpanId,
      });

      res.json({
        success: true,
        data: {
          parsed,
          propagatedHeader,
          childSpanId,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  };

  generateContext = (_req: Request, res: Response): void => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    const traceparent = formatTraceparent({
      version: '00',
      traceId,
      parentSpanId: spanId,
      traceFlags: '01',
    });

    res.json({
      success: true,
      data: {
        traceId,
        spanId,
        traceparent,
      },
    });
  };
}
