import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { Plugin, Rollup } from 'vite';

export const LOCAL_CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; base-uri 'self'; form-action 'none'";

interface LocalBuildOptions {
  base: string;
  name: string;
  id: string;
  description: string;
  themeColor?: string;
}

function checksum(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(checksum(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function insideRoundedRect(x: number, y: number, left: number, top: number, width: number, height: number, radius: number): boolean {
  if (x < left || x > left + width || y < top || y > top + height) return false;
  const centerX = Math.max(left + radius, Math.min(x, left + width - radius));
  const centerY = Math.max(top + radius, Math.min(y, top + height - radius));
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
}

// The favicon's three bars, inset inside the safe area for masked app icons.
function traceIcon(size: number): Buffer {
  const orange = [255, 138, 76];
  const ink = [29, 15, 6];
  const bars = [[6, 9, 14, 4, 1], [10, 14, 14, 4, 0.7], [8, 19, 12, 4, 0.45]];
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceX = ((x + 0.5) / size - 0.2) / 0.6 * 32;
      const sourceY = ((y + 0.5) / size - 0.2) / 0.6 * 32;
      const bar = bars.find(([left, top, width, height]) => insideRoundedRect(sourceX, sourceY, left, top, width, height, 2));
      const opacity = bar?.[4] ?? 0;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(orange[channel] * (1 - opacity) + ink[channel] * opacity);
      }
      pixels[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function assetBytes(asset: Rollup.OutputAsset | Rollup.OutputChunk): string | Uint8Array {
  return asset.type === 'chunk' ? asset.code : asset.source;
}

function serviceWorker(cachePrefix: string, version: string, base: string, files: string[]): string {
  return `const CACHE_PREFIX = ${JSON.stringify(cachePrefix)};
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(version)};
const BASE = ${JSON.stringify(base)};
const PRECACHE = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(async (cache) => {
    try {
      await cache.addAll(PRECACHE);
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  }));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(async (keys) => {
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  }));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    // Built assets are fixed files; server CORS negotiation headers do not change them.
    const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch (error) {
      if (request.mode === 'navigate') {
        const page = await cache.match(BASE + 'index.html');
        if (page) return page;
      }
      throw error;
    }
  }));
});
`;
}

export function localFirstBuild(options: LocalBuildOptions): Plugin {
  const { base, name, id, description, themeColor = '#0e1012' } = options;
  if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('Local app base must begin and end with /.');

  return {
    name: 'local-first-build',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return {
          html: html.replace(/\s*<meta\b(?=[^>]*\bproperty=["']og:url["'])[^>]*>/gi, ''),
          tags: [
            { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: LOCAL_CSP }, injectTo: 'head-prepend' },
            { tag: 'link', attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` }, injectTo: 'head' },
          ],
        };
      },
    },
    generateBundle: {
      order: 'post',
      handler(_outputOptions, bundle) {
        const generated: Record<string, string | Buffer> = {
          'manifest.webmanifest': JSON.stringify({
            id: base,
            name,
            short_name: name,
            description,
            start_url: base,
            scope: base,
            display: 'standalone',
            background_color: themeColor,
            theme_color: themeColor,
            icons: [192, 512].map((size) => ({ src: `${base}icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' })),
          }, null, 2),
          'icon-192.png': traceIcon(192),
          'icon-512.png': traceIcon(512),
        };
        const digest = createHash('sha256');
        for (const [fileName, asset] of Object.entries(bundle).sort(([left], [right]) => left.localeCompare(right))) {
          digest.update(fileName);
          digest.update(assetBytes(asset));
        }
        for (const [fileName, source] of Object.entries(generated)) {
          digest.update(fileName);
          digest.update(source);
          this.emitFile({ type: 'asset', fileName, source });
        }
        const files = [...new Set([base, ...Object.keys(bundle).map((fileName) => `${base}${fileName}`), ...Object.keys(generated).map((fileName) => `${base}${fileName}`), `${base}sw.js`])].sort();
        const prefix = `${id}-offline-${base.replace(/[^a-zA-Z0-9]/g, '_')}-`;
        digest.update(serviceWorker(prefix, '', base, files));
        const version = digest.digest('hex').slice(0, 16);
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(prefix, version, base, files) });
      },
    },
  };
}
