import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceBar } from '../local/WorkspaceBar.js';
import { SavedWorkspaceError } from '../local/workspace.js';
import type { TraceDetail } from '../../../shared/types.js';
import { buildTraceFromInput } from '../../../shared/trace-builder.js';
import { axe } from './axe.js';

const mocks = vi.hoisted(() => ({
  mode: 'sample' as 'sample' | 'workspace', traces: [] as TraceDetail[], listeners: new Set<() => void>(),
  initialize: vi.fn(), choose: vi.fn(), replace: vi.fn(), remove: vi.fn(),
  parse: vi.fn(), export: vi.fn(), download: vi.fn(), sampleTraces: vi.fn(), sampleDetail: vi.fn(),
}));
vi.mock('../local/traceWorkspace.js', () => ({
  workspaceMode: () => mocks.mode, workspaceTraces: () => mocks.traces,
  initializeWorkspace: mocks.initialize, chooseWorkspaceMode: mocks.choose,
  replaceWorkspace: mocks.replace, removeWorkspace: mocks.remove,
  subscribeWorkspace: (listener: () => void) => { mocks.listeners.add(listener); return () => { mocks.listeners.delete(listener); }; },
}));
vi.mock('../local/traceFiles.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../local/traceFiles.js')>(), importTraceFileAsync: mocks.parse, exportTraceFile: mocks.export }));
vi.mock('../local/files.js', () => ({ downloadFile: mocks.download }));
vi.mock('../services/demoApi.js', () => ({ fetchTraces: mocks.sampleTraces, fetchTraceById: mocks.sampleDetail }));

const recorded = buildTraceFromInput([{ id: '1'.repeat(16), traceId: 'a'.repeat(32), parentSpanId: null,
  serviceName: 'gateway', name: 'Imported request', kind: 'SERVER', statusCode: 'OK',
  startTimeMs: 1000, endTimeMs: 1100, attributes: {} }]);
const notify = () => mocks.listeners.forEach(listener => listener());

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.mode = 'sample'; mocks.traces = [];
  mocks.initialize.mockResolvedValue(undefined);
  mocks.choose.mockImplementation(async (mode: 'sample' | 'workspace') => { mocks.mode = mode; notify(); });
  mocks.replace.mockImplementation(async (traces: TraceDetail[]) => { mocks.traces = traces; mocks.mode = 'workspace'; notify(); });
  mocks.remove.mockImplementation(async () => { mocks.traces = []; notify(); });
  mocks.parse.mockResolvedValue({ traces: [recorded], report: { importedSpans: 1, skippedSpans: 0, skipped: [], adjusted: [] } });
  mocks.export.mockReturnValue('{"data":[]}');
  mocks.sampleTraces.mockResolvedValue([recorded.summary]);
  mocks.sampleDetail.mockResolvedValue(recorded);
});

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Import traces' }));
  const dialog = screen.getByRole('dialog', { name: 'Import trace file' });
  await user.upload(within(dialog).getByLabelText('Trace JSON file'), new File(['{}'], 'traces.json', { type: 'application/json' }));
  return dialog;
}

describe('Local workspace controls', () => {
  it('has accessible controls and an accessible file import dialog', async () => {
    const user = userEvent.setup();
    const { container } = render(<WorkspaceBar />);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Data source')).toHaveValue('sample');
    expect(await axe(container)).toHaveNoViolations();
    const dialog = await openImport(user);
    expect(await axe(document.body)).toHaveNoViolations();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import traces' })).toHaveFocus();
  });

  it('switches sources through the persisted-mode operation without replacing imported traces', async () => {
    mocks.traces = [recorded];
    const user = userEvent.setup();
    render(<WorkspaceBar />);
    await user.selectOptions(screen.getByLabelText('Data source'), 'workspace');
    await waitFor(() => expect(mocks.choose).toHaveBeenCalledWith('workspace'));
    expect(screen.getByText(/1 imported trace\./)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Data source'), 'sample');
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.traces).toEqual([recorded]);
  });

  it('validates the selected file before replacing the workspace and reports the imported count', async () => {
    const user = userEvent.setup();
    render(<WorkspaceBar />);
    const dialog = await openImport(user);
    await user.click(within(dialog).getByRole('button', { name: 'Import into workspace' }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith([recorded]));
    expect(mocks.parse.mock.calls[0][0]).toBeInstanceOf(File);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Data source')).toHaveValue('workspace');
    expect(screen.getByText(/1 imported trace\./)).toBeInTheDocument();
    expect(screen.getByText(/Changes saved\. Export a backup\./)).toBeInTheDocument();
  });

  it('keeps the existing workspace and import dialog open when parsing fails', async () => {
    mocks.mode = 'workspace'; mocks.traces = [recorded];
    mocks.parse.mockRejectedValueOnce(new Error('Invalid trace JSON'));
    const user = userEvent.setup();
    render(<WorkspaceBar />);
    const dialog = await openImport(user);
    await user.click(within(dialog).getByRole('button', { name: 'Replace workspace' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Invalid trace JSON');
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.traces).toEqual([recorded]);
    expect(screen.getByLabelText('Data source')).toHaveValue('workspace');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('preserves the current data and reports failed storage writes', async () => {
    mocks.mode = 'workspace'; mocks.traces = [recorded];
    mocks.replace.mockRejectedValueOnce(new Error('Storage quota exceeded'));
    const user = userEvent.setup();
    render(<WorkspaceBar />);
    const dialog = await openImport(user);
    await user.click(within(dialog).getByRole('button', { name: 'Replace workspace' }));
    const confirm = await screen.findByRole('dialog', { name: 'Replace your workspace' });
    await user.click(within(confirm).getByRole('button', { name: 'Replace workspace' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Storage quota exceeded');
    expect(mocks.traces).toEqual([recorded]);
    expect(screen.getByText(/1 imported trace\./)).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: 'Replace workspace' })).toBeEnabled();
  });

  it('asks before replacing a saved workspace, naming what is replaced, and leaves it alone on cancel', async () => {
    mocks.mode = 'workspace'; mocks.traces = [recorded, recorded];
    const user = userEvent.setup();
    render(<WorkspaceBar />);
    const dialog = await openImport(user);
    await user.click(within(dialog).getByRole('button', { name: 'Replace workspace' }));
    const confirm = await screen.findByRole('dialog', { name: 'Replace your workspace' });
    expect(screen.queryByRole('dialog', { name: 'Import trace file' })).not.toBeInTheDocument();
    expect(confirm).toHaveTextContent('This replaces your workspace of 2 traces and 2 spans.');
    expect(confirm).toHaveTextContent('It will hold 1 trace and 1 span from traces.json.');
    expect(confirm).toContainElement(document.activeElement as HTMLElement);
    expect(await axe(document.body)).toHaveNoViolations();
    expect(mocks.replace).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.traces).toEqual([recorded, recorded]);
    expect(screen.getByRole('button', { name: 'Import traces' })).toHaveFocus();
  });

  it('replaces the saved workspace after the confirmation and shows what was imported or skipped', async () => {
    mocks.mode = 'workspace'; mocks.traces = [recorded];
    mocks.parse.mockResolvedValueOnce({ traces: [recorded], report: { importedSpans: 5, skippedSpans: 2, adjusted: [
      { reason: 'empty event name replaced with "unnamed event"', count: 1, example: 'resourceSpans[0].scopeSpans[0].spans[3].events[0].name' }],
    skipped: [{ reason: 'duplicate span ID in the same trace', count: 2, example: 'resourceSpans[0].scopeSpans[0].spans[4]' }] } });
    const user = userEvent.setup();
    render(<WorkspaceBar />);
    const dialog = await openImport(user);
    await user.click(within(dialog).getByRole('button', { name: 'Replace workspace' }));
    const confirm = await screen.findByRole('dialog', { name: 'Replace your workspace' });
    await user.click(within(confirm).getByRole('button', { name: 'Replace workspace' }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith([recorded]));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Imported 5 spans, skipped 2: duplicate span ID in the same trace (2).');
    expect(status).toHaveTextContent('Duplicate span ID in the same trace: 2, first at resourceSpans[0].scopeSpans[0].spans[4].');
    expect(status).toHaveTextContent('Empty event name replaced with "unnamed event": 1');
  });

  it('exports the selected imported data as a JSON backup', async () => {
    mocks.mode = 'workspace'; mocks.traces = [recorded];
    const user = userEvent.setup();
    render(<WorkspaceBar />);
    await user.click(screen.getByRole('button', { name: 'Export traces' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith('traces-jaeger.json', '{"data":[]}', 'application/json'));
    expect(mocks.export).toHaveBeenCalledWith([recorded]);
    expect(mocks.sampleTraces).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Keep a backup outside this browser' })).not.toBeInTheDocument();
  });

  it('requires the clear confirmation and clears only the imported workspace', async () => {
    mocks.mode = 'workspace'; mocks.traces = [recorded];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<WorkspaceBar />);
    await user.click(screen.getByRole('button', { name: 'Clear workspace' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.traces).toEqual([recorded]);
    await user.click(screen.getByRole('button', { name: 'Clear workspace' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith('Clear all imported traces from this browser? Export a backup first.');
    expect(screen.getByLabelText('Data source')).toHaveValue('workspace');
    expect(mocks.choose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Clear workspace' })).not.toBeInTheDocument();
    expect(screen.getByText(/0 imported traces\./)).toBeInTheDocument();
  });

  it('keeps recovery import available when opening browser storage fails', async () => {
    mocks.initialize.mockRejectedValueOnce(new Error('Storage unavailable'));
    const user = userEvent.setup();
    render(<WorkspaceBar />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Browser storage is unavailable');
    expect(screen.queryByRole('button', { name: 'Clear workspace' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import traces' }));
    expect(screen.getByRole('dialog', { name: 'Import trace file' })).toBeInTheDocument();
    expect(screen.getByLabelText('Trace JSON file')).toBeEnabled();
  });

  it('reports an unreadable saved workspace as such and always offers to clear it', async () => {
    mocks.initialize.mockRejectedValueOnce(new SavedWorkspaceError('The saved workspace in this browser cannot be read (bad file). Clear it to start again, or import a backup file to replace it.'));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<WorkspaceBar />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('cannot be read');
    expect(alert).not.toHaveTextContent('Browser storage is unavailable');
    await user.click(screen.getByRole('button', { name: 'Clear workspace' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('cannot be read'));
    expect(screen.queryByRole('button', { name: 'Clear workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
