import { useEffect, useState } from 'react';
import { Download, Upload, Trash2 } from 'lucide-react';
import { Modal } from '../components/Modal.js';
import { downloadFile } from './files.js';
import { importTraceFileAsync, exportTraceFile, describeImport, type ImportReport, type ImportResult } from './traceFiles.js';
import { SavedWorkspaceError } from './workspace.js';
import { initializeWorkspace, subscribeWorkspace, workspaceMode, workspaceTraces,
  chooseWorkspaceMode, replaceWorkspace, removeWorkspace, type WorkspaceMode } from './traceWorkspace.js';
import * as sample from '../services/demoApi.js';
import { formatCount } from '../utils/pluralize.js';

const spanTotal = (traces: Array<{ rawSpans: unknown[] }>) => traces.reduce((total, trace) => total + trace.rawSpans.length, 0);

export function WorkspaceBar() {
  const [mode, setMode] = useState<WorkspaceMode>(workspaceMode());
  const [count, setCount] = useState(workspaceTraces().length);
  const [dialog, setDialog] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const [nudged, setNudged] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [pending, setPending] = useState<{ result: ImportResult; fileName: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [install, setInstall] = useState<(Event & { prompt(): Promise<void> }) | null>(null);

  useEffect(() => {
    const update = () => { setMode(workspaceMode()); setCount(workspaceTraces().length); };
    const unsubscribe = subscribeWorkspace(update);
    void initializeWorkspace().then(update).catch((reason: unknown) => {
      if (reason instanceof SavedWorkspaceError) { setUnreadable(true); setError(reason.message); }
      else setError('Browser storage is unavailable. Check storage permissions and keep exported backups.');
    });
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as Event & { prompt(): Promise<void> });
    };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    return () => { unsubscribe(); window.removeEventListener('beforeinstallprompt', beforeInstall); };
  }, []);

  async function run(action: () => Promise<void>) {
    setError(''); setBusy(true);
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The operation failed. Your current data was kept.'); }
    finally { setBusy(false); }
  }

  async function exportData() {
    const data = mode === 'workspace' ? workspaceTraces()
      : await Promise.all((await sample.fetchTraces({ limit: 100 })).map((trace) => sample.fetchTraceById(trace.id)));
    if (!data.length) throw new Error('No traces to export. Import a Jaeger or OpenTelemetry JSON file first.');
    downloadFile('traces-jaeger.json', exportTraceFile(data), 'application/json');
    setChanged(false); setNudged(true);
  }

  async function commit(result: ImportResult) {
    await replaceWorkspace(result.traces);
    setReport(result.report); setUnreadable(false);
    setChanged(true); setPending(null); setDialog(false);
  }

  function cancelImport() { setPending(null); setDialog(false); }

  const hasSaved = count > 0 || unreadable;
  const summary = report ? describeImport(report) : null;

  return (
    <section className="workspace-bar" aria-label="Local trace workspace">
      <div className="workspace-controls">
        <div className="field workspace-mode">
          <label className="field-label" htmlFor="workspace-data-source">Data source</label>
          <select id="workspace-data-source" value={mode} disabled={busy} onChange={(event) => void run(() => chooseWorkspaceMode(event.target.value as WorkspaceMode))}>
            <option value="sample">Sample data</option><option value="workspace">Your workspace</option>
          </select>
        </div>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => { setError(''); setFile(null); setDialog(true); }}>
          <Upload size={16} strokeWidth={1.75} aria-hidden="true" />Import traces
        </button>
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void run(exportData)}>
          <Download size={16} strokeWidth={1.75} aria-hidden="true" />Export traces
        </button>
        {(unreadable || (mode === 'workspace' && count > 0)) && <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => {
          const message = unreadable ? 'Clear the saved workspace from this browser? It cannot be read, so it cannot be exported first.' : 'Clear all imported traces from this browser? Export a backup first.';
          if (window.confirm(message)) {
            void run(async () => { await removeWorkspace(); setUnreadable(false); setReport(null); setChanged(true); });
          }
        }}><Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />Clear workspace</button>}
        {install && <button className="btn btn-secondary" type="button" onClick={() => void run(async () => { await install.prompt(); setInstall(null); })}>Install TracePulse</button>}
      </div>
      <p className="workspace-note">Your data stays in this browser. No requests to other hosts. {changed && 'Changes saved. Export a backup.'}</p>
      <p className="workspace-note">Trace file viewer. Import recorded spans; this page does not collect live traces. {mode === 'workspace' && `${count} imported ${count === 1 ? 'trace' : 'traces'}.`}</p>
      <div role="status">
        {summary && <>
          <p className="workspace-note">{summary.headline}</p>
          {summary.details.length > 0 && <ul className="import-notes">{summary.details.map((line) => <li key={line}>{line}</li>)}</ul>}
        </>}
      </div>
      {!nudged && <p><button type="button" className="link-btn" disabled={busy} onClick={() => void run(exportData)}>Keep a backup outside this browser</button></p>}
      {error && !dialog && <p role="alert" className="is-bad">{error}</p>}
      {dialog && !pending && <Modal title="Import trace file" onClose={() => { if (!busy) setDialog(false); }} footer={<>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDialog(false)}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={() => void run(async () => {
          if (!file) return;
          const result = await importTraceFileAsync(file);
          if (hasSaved) setPending({ result, fileName: file.name });
          else await commit(result);
        })}>{busy ? 'Reading trace file' : hasSaved ? 'Replace workspace' : 'Import into workspace'}</button>
      </>}>
        <p>Choose a Jaeger JSON, OpenTelemetry JSON or Tempo file, or an OpenTelemetry file with one JSON object per line. Files can be up to 32 MiB and 100,000 spans. Spans that repeat an ID or sit more than 128 parents deep are skipped and listed after the import. Import replaces your workspace; sample traces stay separate.</p>
        <label className="field import-file"><span className="field-label">Trace JSON file</span>
          <input type="file" accept=".json,.jsonl,.ndjson,application/json" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        {file && <p className="mono wrap-text">{file.name}</p>}
        {error && <p role="alert" className="is-bad">{error}</p>}
      </Modal>}
      {pending && <Modal title="Replace your workspace" onClose={() => { if (!busy) cancelImport(); }} footer={<>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={cancelImport}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => commit(pending.result))}>{busy ? 'Saving workspace' : 'Replace workspace'}</button>
      </>}>
        <p>{unreadable
          ? 'This replaces the saved workspace in this browser, which cannot be read.'
          : `This replaces your workspace of ${formatCount(count, 'trace')} and ${formatCount(spanTotal(workspaceTraces()), 'span')}.`}</p>
        <p>{`It will hold ${formatCount(pending.result.traces.length, 'trace')} and ${formatCount(pending.result.report.importedSpans, 'span')} from ${pending.fileName}. Sample traces are not affected. Export a backup first if you still need the current traces.`}</p>
        {error && <p role="alert" className="is-bad">{error}</p>}
      </Modal>}
    </section>
  );
}
