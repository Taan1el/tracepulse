// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build, resolveConfig } from 'vite';
import { LOCAL_CSP } from '../../localBuild.js';

const clientRoot = fileURLToPath(new URL('../../', import.meta.url));
let output: string;
let html: string;
let worker: string;
let files: string[];

class FakeRequest {
  constructor(public url: string, public init?: Record<string, unknown>) {}
}

/** Runs the generated worker against fake caches and a fake network, returning what it registered. */
function startWorker(options: { online: boolean; cached?: Record<string, unknown>; keys?: string[] }) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const cached = options.cached ?? {};
  const added: FakeRequest[][] = [];
  const deleted: string[] = [];
  const fetched: Array<{ url: string; init?: Record<string, unknown> }> = [];
  const skipWaiting = vi.fn(async () => undefined);
  const cache = {
    addAll: async (requests: FakeRequest[]) => { added.push(requests); },
    match: async (request: string | { url: string }) => cached[typeof request === 'string' ? request : new URL(request.url).pathname],
  };
  const context: Record<string, unknown> = {
    URL, Request: FakeRequest,
    caches: { open: async () => cache, keys: async () => options.keys ?? [], delete: async (key: string) => { deleted.push(key); } },
    fetch: async (target: string | { url: string }, init?: Record<string, unknown>) => {
      fetched.push({ url: typeof target === 'string' ? target : target.url, init });
      if (!options.online) throw new Error('Server is off.');
      return { body: 'network' };
    },
    self: { location: { origin: 'https://local.test' }, addEventListener: (name: string, callback: (event: unknown) => void) => { handlers[name] = callback; }, skipWaiting, clients: { claim: async () => undefined } },
  };
  vm.runInNewContext(worker, context);
  const request = (url: string, mode = 'cors', method = 'GET') => {
    let response: Promise<unknown> | undefined;
    handlers.fetch({ request: { method, url, mode }, respondWith: (result: Promise<unknown>) => { response = result; } });
    return response;
  };
  return { handlers, added, deleted, fetched, skipWaiting, request, context };
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? listFiles(path.join(directory, entry.name), `${prefix}${entry.name}/`)
    : [`${prefix}${entry.name}`]));
  return results.flat();
}

beforeAll(async () => {
  output = await mkdtemp(path.join(tmpdir(), 'tracepulse-local-build-'));
  await build({ root: clientRoot, mode: 'pages', logLevel: 'silent', build: { outDir: output, emptyOutDir: true } });
  html = await readFile(path.join(output, 'index.html'), 'utf8');
  worker = await readFile(path.join(output, 'sw.js'), 'utf8');
  files = await listFiles(output);
}, 30_000);

afterAll(async () => {
  if (!output) return;
  const resolved = path.resolve(output);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('tracepulse-local-build-')) {
    throw new Error('Build test output is outside its temporary directory.');
  }
  await rm(resolved, { recursive: true, force: true });
});

describe('Pages local app build', () => {
  it('places the exact CSP before resources and uses no remote resources', () => {
    const content = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    expect(content?.replaceAll('&#39;', "'")).toBe(LOCAL_CSP);
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'));
    expect(html).not.toMatch(/(?:src|href|content)\s*=\s*["'](?:https?:)?\/\//i);
    expect(html).not.toContain('og:url');
    expect(html).toContain('data:image/svg+xml,');
  });

  it('keeps the Pages CSP plugin out of development', async () => {
    const config = await resolveConfig({ root: clientRoot, mode: 'development' }, 'serve');
    expect(config.plugins.some((plugin) => plugin.name === 'local-first-build')).toBe(false);
  });

  it('emits a standalone manifest and full-size PNG icons', async () => {
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.webmanifest'), 'utf8'));
    expect(manifest).toMatchObject({ start_url: '/tracepulse/', scope: '/tracepulse/', display: 'standalone', theme_color: '#0e1012', background_color: '#0e1012' });
    for (const size of [192, 512]) {
      expect(manifest.icons).toContainEqual({ src: `/tracepulse/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' });
      const icon = await readFile(path.join(output, `icon-${size}.png`));
      expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(icon.readUInt32BE(16)).toBe(size);
      expect(icon.readUInt32BE(20)).toBe(size);
    }
  });

  it('precaches every emitted file, fonts, its worker and the base page', () => {
    const match = worker.match(/const PRECACHE = (\[[^;]+\]);/);
    expect(match).not.toBeNull();
    const precache: string[] = JSON.parse(match![1]);
    expect(precache).toContain('/tracepulse/');
    for (const file of files) expect(precache).toContain(`/tracepulse/${file}`);
    expect(precache.some((file) => file.endsWith('.woff2'))).toBe(true);
    expect(precache.some((file) => file.includes('trace.worker') && file.endsWith('.js'))).toBe(true);
    expect(precache).toContain('/tracepulse/manifest.webmanifest');
    expect(precache).toContain('/tracepulse/sw.js');
    expect(worker).toMatch(/const CACHE_NAME = CACHE_PREFIX \+ "[0-9a-f]{16}";/);
  });

  it('emits every font as a file allowed by the policy', async () => {
    for (const file of files.filter((name) => name.endsWith('.css'))) {
      expect(await readFile(path.join(output, file), 'utf8')).not.toMatch(/url\(["']?data:/i);
    }
  });

  it('chooses a strategy per request: the page goes to the network first, built files to the cache', () => {
    const { context } = startWorker({ online: true });
    const choose = context.strategyFor as (request: unknown, url: URL) => string;
    const url = (path: string) => new URL(`https://local.test${path}`);
    expect(choose({ method: 'GET', mode: 'navigate' }, url('/tracepulse/'))).toBe('network-first');
    expect(choose({ method: 'GET', mode: 'cors' }, url('/tracepulse/assets/index-abc.js'))).toBe('cache-first');
    expect(choose({ method: 'POST', mode: 'cors' }, url('/tracepulse/'))).toBe('pass');
    expect(choose({ method: 'GET', mode: 'navigate' }, url('/elsewhere/'))).toBe('pass');
    expect(choose({ method: 'GET', mode: 'navigate' }, new URL('https://other.test/tracepulse/'))).toBe('pass');
  });

  it('serves the page from the network when online, bypassing the HTTP cache, and falls back to the cached page offline', async () => {
    const page = { body: 'cached page' };
    const online = startWorker({ online: true, cached: { '/tracepulse/index.html': page } });
    expect(await online.request('https://local.test/tracepulse/', 'navigate')).toEqual({ body: 'network' });
    expect(online.fetched).toEqual([{ url: 'https://local.test/tracepulse/', init: expect.objectContaining({ cache: 'no-cache' }) }]);
    const offline = startWorker({ online: false, cached: { '/tracepulse/index.html': page } });
    expect(await offline.request('https://local.test/tracepulse/', 'navigate')).toBe(page);
    const empty = startWorker({ online: false });
    await expect(empty.request('https://local.test/tracepulse/', 'navigate')).rejects.toThrow('Server is off.');
  });

  it('keeps serving built files from the cache before the network', async () => {
    const asset = { body: 'cached asset' };
    const { request, fetched } = startWorker({ online: true, cached: { '/tracepulse/assets/index-abc.js': asset } });
    expect(await request('https://local.test/tracepulse/assets/index-abc.js?v=1')).toBe(asset);
    expect(fetched).toEqual([]);
    expect(await request('https://local.test/tracepulse/assets/new.js')).toEqual({ body: 'network' });
  });

  it('precaches with reload requests and waits for the page before taking over', async () => {
    const { handlers, added, skipWaiting } = startWorker({ online: true });
    let installation: Promise<void> | undefined;
    handlers.install({ waitUntil: (result: Promise<void>) => { installation = result; } });
    await installation;
    expect(added).toHaveLength(1);
    expect(added[0].length).toBeGreaterThan(5);
    expect(added[0].every((entry) => entry.init?.cache === 'reload')).toBe(true);
    expect(skipWaiting).not.toHaveBeenCalled();
    handlers.message({ data: { type: 'SOMETHING_ELSE' } });
    handlers.message({ data: null });
    expect(skipWaiting).not.toHaveBeenCalled();
    handlers.message({ data: { type: 'SKIP_WAITING' } });
    expect(skipWaiting).toHaveBeenCalledOnce();
  });

  it('names its cache from the build version and deletes older versions of its own caches on activate', async () => {
    const prefix: string = JSON.parse(worker.match(/const CACHE_PREFIX = ("[^;]+);/)![1]);
    const version = worker.match(/const CACHE_NAME = CACHE_PREFIX \+ "([0-9a-f]{16})";/)![1];
    const { handlers, deleted } = startWorker({ online: true, keys: [`${prefix}${version}`, `${prefix}0000000000000000`, 'tracepulse-other'] });
    let activation: Promise<void> | undefined;
    handlers.activate({ waitUntil: (result: Promise<void>) => { activation = result; } });
    await activation;
    expect(deleted).toEqual([`${prefix}0000000000000000`]);
  });

  it('serves cached pages offline and deletes only this app\'s older caches', async () => {
    const handlers: Record<string, (event: unknown) => void> = {};
    const cachedResponse = { body: 'cached page' };
    const deleted: string[] = [];
    const match = worker.match(/const CACHE_PREFIX = ("[^;]+);/);
    const prefix: string = JSON.parse(match![1]);
    const cache = { addAll: vi.fn(async () => undefined), match: async () => cachedResponse };
    const skipWaiting = vi.fn(async () => undefined);
    const context = {
      URL, Request: FakeRequest,
      caches: { open: async () => cache, keys: async () => [`${prefix}old`, 'another-app-cache'], delete: async (key: string) => { deleted.push(key); } },
      fetch: async () => { throw new Error('Server is off.'); },
      self: { location: { origin: 'https://local.test' }, addEventListener: (name: string, callback: (event: unknown) => void) => { handlers[name] = callback; }, skipWaiting, clients: { claim: async () => undefined } },
    };
    vm.runInNewContext(worker, context);
    let installation: Promise<void> | undefined;
    handlers.install({ waitUntil: (result: Promise<void>) => { installation = result; } });
    await installation;
    expect(cache.addAll).toHaveBeenCalled();
    expect(skipWaiting).not.toHaveBeenCalled();
    let response: Promise<unknown> | undefined;
    handlers.fetch({ request: { method: 'GET', url: 'https://local.test/tracepulse/', mode: 'navigate' }, respondWith: (result: Promise<unknown>) => { response = result; } });
    expect(await response).toBe(cachedResponse);
    const forbiddenResponse = vi.fn();
    for (const url of ['https://outside.test/tracepulse/', 'https://local.test/another-app/']) {
      handlers.fetch({ request: { method: 'GET', url, mode: 'navigate' }, respondWith: forbiddenResponse });
    }
    expect(forbiddenResponse).not.toHaveBeenCalled();
    let activation: Promise<void> | undefined;
    handlers.activate({ waitUntil: (result: Promise<void>) => { activation = result; } });
    await activation;
    expect(deleted).toEqual([`${prefix}old`]);
  });
});
