import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { buildTraceFromInput } from '../../../shared/trace-builder.js';
import type { TraceDetail } from '../../../shared/types.js';

function trace(traceId: string, source = 'gateway', target = 'worker'): TraceDetail {
  return buildTraceFromInput([
    { id: '1'.repeat(16), traceId, parentSpanId: null, serviceName: source,
      name: 'Recorded request', kind: 'SERVER', startTimeMs: 1000, endTimeMs: 1100,
      statusCode: 'OK', attributes: { 'http.status_code': 200 } },
    { id: '2'.repeat(16), traceId, parentSpanId: '1'.repeat(16), serviceName: target,
      name: 'Recorded child', kind: 'CLIENT', startTimeMs: 1010, endTimeMs: 1040,
      statusCode: 'ERROR', attributes: { detail: '<img src=x onerror=alert(1)>' } },
  ]);
}

function expectRecordedSpans(actual: TraceDetail['rawSpans'], expected: TraceDetail['rawSpans']) {
  expect(actual).toHaveLength(expected.length);
  // Imported spans may add exact source timestamps and empty optional event lists.
  expect(actual).toEqual(expect.arrayContaining(expected.map(span => expect.objectContaining(span))));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
});

describe('Imported trace workspace', () => {
  it('restores validated trace data and the chosen mode after a fresh module load', async () => {
    let workspace = await import('../local/traceWorkspace.js');
    const recorded = trace('a'.repeat(32));
    await workspace.replaceWorkspace([recorded]);
    expect(workspace.workspaceMode()).toBe('workspace');

    await workspace.chooseWorkspaceMode('sample');
    vi.resetModules();
    workspace = await import('../local/traceWorkspace.js');
    await workspace.initializeWorkspace();
    expect(workspace.workspaceMode()).toBe('sample');
    expect(workspace.workspaceTraces()).toHaveLength(1);
    expectRecordedSpans((await workspace.localTraceDetail(recorded.summary.id)).rawSpans, recorded.rawSpans);

    await workspace.chooseWorkspaceMode('workspace');
    vi.resetModules();
    workspace = await import('../local/traceWorkspace.js');
    await workspace.initializeWorkspace();
    expect(workspace.workspaceMode()).toBe('workspace');
    expect((await workspace.localTraceSummaries()).map(item => item.id)).toEqual([recorded.summary.id]);
  });

  it('keeps imported data separate when sample traffic is generated or reset', async () => {
    const workspace = await import('../local/traceWorkspace.js');
    const samples = await import('../services/demoApi.js');
    const recorded = trace('b'.repeat(32));
    await workspace.replaceWorkspace([recorded]);
    await workspace.chooseWorkspaceMode('sample');
    await samples.simulateTraffic({ flowType: 'batch', batchCount: 3 });
    samples.resetDemoData();

    expect(await samples.fetchTraces({ limit: 100 })).toHaveLength(15);
    expect(workspace.workspaceMode()).toBe('sample');
    expectRecordedSpans((await workspace.localTraceDetail(recorded.summary.id)).rawSpans, recorded.rawSpans);
    vi.resetModules();
    const restored = await import('../local/traceWorkspace.js');
    await restored.initializeWorkspace();
    expect(restored.workspaceTraces().map(item => item.summary.id)).toEqual([recorded.summary.id]);
  });

  it('rejects malformed import text before replacing memory or stored data', async () => {
    const workspace = await import('../local/traceWorkspace.js');
    const files = await import('../local/traceFiles.js');
    const storage = await import('../local/workspace.js');
    await workspace.replaceWorkspace([trace('c'.repeat(32))]);
    const before = workspace.workspaceTraces();
    const saved = await storage.loadWorkspace();

    expect(() => files.parseTraceFile('{broken JSON', 'broken.json')).toThrow();
    expect(workspace.workspaceTraces()).toBe(before);
    expect(await storage.loadWorkspace()).toEqual(saved);
  });

  it('exports all imported spans and can import that backup into a fresh workspace', async () => {
    let workspace = await import('../local/traceWorkspace.js');
    const files = await import('../local/traceFiles.js');
    const recorded = [trace('d'.repeat(32)), trace('e'.repeat(32), 'api', 'database')];
    await workspace.replaceWorkspace(recorded);
    const exported = files.exportTraceFile(workspace.workspaceTraces());
    const imported = files.parseTraceFile(exported, 'backup.json');
    expect(imported.map(item => item.summary.id).sort()).toEqual(recorded.map(item => item.summary.id).sort());
    for (const original of recorded) {
      expectRecordedSpans(imported.find(item => item.summary.id === original.summary.id)!.rawSpans, original.rawSpans);
    }

    await workspace.removeWorkspace();
    vi.resetModules();
    workspace = await import('../local/traceWorkspace.js');
    await workspace.replaceWorkspace(imported);
    expect(await workspace.localTraceSummaries()).toHaveLength(2);
    expectRecordedSpans((await workspace.localTraceDetail(recorded[0].summary.id)).rawSpans, recorded[0].rawSpans);
  });

  it('preserves the active data and backup when a replacement storage write fails', async () => {
    const workspace = await import('../local/traceWorkspace.js');
    const storage = await import('../local/workspace.js');
    await workspace.replaceWorkspace([trace('a'.repeat(32))]);
    const before = workspace.workspaceTraces();
    const backup = await storage.loadWorkspace();
    const save = vi.spyOn(storage, 'saveWorkspace').mockRejectedValueOnce(new Error('Storage quota exceeded'));

    await expect(workspace.replaceWorkspace([trace('f'.repeat(32))])).rejects.toThrow('Storage quota exceeded');
    expect(workspace.workspaceMode()).toBe('workspace');
    expect(workspace.workspaceTraces()).toBe(before);
    expect(await storage.loadWorkspace()).toEqual(backup);
    save.mockRestore();
    vi.resetModules();
    const restored = await import('../local/traceWorkspace.js');
    await restored.initializeWorkspace();
    expect(restored.workspaceTraces().map(item => item.summary.id)).toEqual(before.map(item => item.summary.id));
  });

  it('keeps the current source selected when saving a mode change fails', async () => {
    const workspace = await import('../local/traceWorkspace.js');
    const storage = await import('../local/workspace.js');
    await workspace.replaceWorkspace([trace('a'.repeat(32))]);
    vi.spyOn(storage, 'saveMode').mockRejectedValueOnce(new Error('Storage write failed'));
    await expect(workspace.chooseWorkspaceMode('sample')).rejects.toThrow('Storage write failed');
    expect(workspace.workspaceMode()).toBe('workspace');
    expect(await storage.loadMode()).toBe('workspace');
  });

  it('rejects corrupt saved data and recovers through an explicit valid import', async () => {
    const storage = await import('../local/workspace.js');
    await storage.saveWorkspace({ version: 1, source: '{broken JSON' });
    await storage.saveMode('workspace');
    const workspace = await import('../local/traceWorkspace.js');
    await expect(workspace.initializeWorkspace()).rejects.toThrow();
    expect(workspace.workspaceTraces()).toEqual([]);
    await workspace.replaceWorkspace([trace('b'.repeat(32))]);
    vi.resetModules();
    const restored = await import('../local/traceWorkspace.js');
    await restored.initializeWorkspace();
    expect(restored.workspaceMode()).toBe('workspace');
    expect(restored.workspaceTraces().map(item => item.summary.id)).toEqual(['b'.repeat(32)]);
  });

  it('scopes parent links to each trace and keeps service names containing arrows distinct', async () => {
    const workspace = await import('../local/traceWorkspace.js');
    // Every trace intentionally reuses the same span IDs; those IDs are trace-scoped.
    await workspace.replaceWorkspace([
      trace('a'.repeat(32), 'a->b', 'c'),
      trace('b'.repeat(32), 'a', 'b->c'),
      trace('c'.repeat(32), 'a->b', 'c'),
    ]);
    const topology = await workspace.localServiceTopology();
    expect(topology.edges).toHaveLength(2);
    expect(topology.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'a->b', target: 'c', callCount: 2, avgDurationMs: 30, errorCount: 2 }),
      expect.objectContaining({ source: 'a', target: 'b->c', callCount: 1, avgDurationMs: 30, errorCount: 1 }),
    ]));
    expect(new Set(topology.edges.map(item => item.id)).size).toBe(2);
    expect(topology.nodes.map(item => item.name).sort()).toEqual(['a', 'a->b', 'b->c', 'c']);
  });
});
