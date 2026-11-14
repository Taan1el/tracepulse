import { importTraceFile, type ImportReport } from './traceFiles.js';
import type { TraceDetail } from '../../../shared/types.js';

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<File>) => void) | null;
  postMessage: (response: { traces?: TraceDetail[]; report?: ImportReport; error?: string }) => void;
};
worker.onmessage = async (event: MessageEvent<File>) => {
  const file = event.data;
  try { worker.postMessage(importTraceFile(await file.text(), file.name)); }
  catch (error) { worker.postMessage({ error: error instanceof Error ? error.message : `${file.name}: could not read the local file` }); }
};
