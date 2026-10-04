import { useEffect, useState } from 'react';
import { Download, Upload, Trash2 } from 'lucide-react';
import { Modal } from '../components/Modal.js';
import { downloadFile } from './files.js';
import { parseTraceFileAsync, exportTraceFile } from './traceFiles.js';
import { initializeWorkspace, subscribeWorkspace, workspaceMode, workspaceTraces,
  chooseWorkspaceMode, replaceWorkspace, removeWorkspace, type WorkspaceMode } from './traceWorkspace.js';
import * as sample from '../services/demoApi.js';

export function WorkspaceBar() {
  const [mode, setMode] = useState<WorkspaceMode>(workspaceMode());
  const [count, setCount] = useState(workspaceTraces().length);
  const [dialog, setDialog] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const [nudged, setNudged] = useState(false);
  const [install, setInstall] = useState<(Event & { prompt(): Promise<void> }) | null>(null);

  useEffect(() => {
    const update = () => { setMode(workspaceMode()); setCount(workspaceTraces().length); };
    const unsubscribe = subscribeWorkspace(update);
    void initializeWorkspace().then(update).catch(() => setError('Browser storage is unavailable. Check storage permissions and keep exported backups.'));
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
        {mode === 'workspace' && count > 0 && <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => {
          if (window.confirm('Clear all imported traces from this browser? Export a backup first.')) {
            void run(async () => { await removeWorkspace(); setChanged(true); });
          }
        }}><Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />Clear workspace</button>}
        {install && <button className="btn btn-secondary" type="button" onClick={() => void run(async () => { await install.prompt(); setInstall(null); })}>Install TracePulse</button>}
      </div>
      <p className="workspace-note">Your data stays in this browser. No requests to other hosts. {changed && 'Changes saved. Export a backup.'}</p>
      <p className="workspace-note">Trace file viewer. Import recorded spans; this page does not collect live traces. {mode === 'workspace' && `${count} imported ${count === 1 ? 'trace' : 'traces'}.`}</p>
      {!nudged && <p><button type="button" className="link-btn" disabled={busy} onClick={() => void run(exportData)}>Keep a backup outside this browser</button></p>}
      {error && !dialog && <p role="alert" className="is-bad">{error}</p>}
      {dialog && <Modal title="Import trace file" onClose={() => { if (!busy) setDialog(false); }} footer={<>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDialog(false)}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={() => void run(async () => {
          if (!file) return;
          const parsed = await parseTraceFileAsync(file);
          await replaceWorkspace(parsed);
          setChanged(true); setDialog(false);
        })}>{busy ? 'Reading trace file' : count ? 'Replace workspace' : 'Import into workspace'}</button>
      </>}>
        <p>Choose Jaeger JSON or OpenTelemetry JSON, up to 32 MiB and 100,000 spans. All traces are validated before saving. Import replaces your workspace; sample traces stay separate.</p>
        <label className="field import-file"><span className="field-label">Trace JSON file</span>
          <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        {file && <p className="mono wrap-text">{file.name}</p>}
        {error && <p role="alert" className="is-bad">{error}</p>}
      </Modal>}
    </section>
  );
}
