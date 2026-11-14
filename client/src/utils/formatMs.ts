/** Milliseconds with at most three decimals and no trailing zeros, so 12.345678 reads as "12.346 ms" and 100 as "100 ms". */
export function formatMs(value: number): string {
  if (!Number.isFinite(value)) return '0 ms';
  if (value > 0 && value < 0.001) return '<0.001 ms';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 3, useGrouping: false })} ms`;
}
