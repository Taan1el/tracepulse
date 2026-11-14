import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from '../local/files.js';

describe('download helper', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('keeps the object URL alive for at least a second after the click', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:local/1');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadFile('traces.json', '{}', 'application/json');
    expect(create).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(999);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:local/1');
  });
});
