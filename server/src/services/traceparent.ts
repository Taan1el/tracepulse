import crypto from 'node:crypto';
import type { W3CTraceparent } from '../../../shared/types.js';

const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const ALL_ZEROS_32 = '00000000000000000000000000000000';
const ALL_ZEROS_16 = '0000000000000000';

export function parseTraceparent(header: string): W3CTraceparent | null {
  if (!header || typeof header !== 'string') return null;
  const match = header.trim().match(TRACEPARENT_REGEX);
  if (!match) return null;

  const [, version, traceId, parentSpanId, traceFlags] = match;

  // W3C spec: version 'ff' is invalid, version '00' must be exactly 4 parts
  if (version.toLowerCase() === 'ff') return null;
  if (traceId === ALL_ZEROS_32) return null;
  if (parentSpanId === ALL_ZEROS_16) return null;

  return {
    version: version.toLowerCase(),
    traceId: traceId.toLowerCase(),
    parentSpanId: parentSpanId.toLowerCase(),
    traceFlags: traceFlags.toLowerCase(),
  };
}

export function formatTraceparent(tp: W3CTraceparent): string {
  return `${tp.version.padStart(2, '0')}-${tp.traceId.padStart(32, '0')}-${tp.parentSpanId.padStart(16, '0')}-${tp.traceFlags.padStart(2, '0')}`;
}

export function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function isValidTraceId(traceId: string): boolean {
  return /^[0-9a-f]{32}$/i.test(traceId) && traceId !== ALL_ZEROS_32;
}

export function isValidSpanId(spanId: string): boolean {
  return /^[0-9a-f]{16}$/i.test(spanId) && spanId !== ALL_ZEROS_16;
}
