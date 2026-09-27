/**
 * 3D 1090 Fruits - Shared utilities
 */

/**
 * Compact human-readable number formatting.
 * 999 -> "999", 1234 -> "1.2K", 4.5e6 -> "4.5M", 3.2e9 -> "3.2B",
 * up to levels of 100,000,000 -> "100.0M".
 */
export function formatNumber(n) {
  n = Math.floor(n);
  if (n < 1000) return `${n}`;
  if (n < 1000000) return `${(n / 1000).toFixed(n < 100000 ? 1 : 0)}K`;
  if (n < 1000000000) return `${(n / 1000000).toFixed(n < 100000000 ? 2 : 1)}M`;
  if (n < 1000000000000) return `${(n / 1000000000).toFixed(2)}B`;
  return `${(n / 1000000000000).toFixed(2)}T`;
}

/**
 * Full integer with thousands separators (for exact stat values).
 */
export function formatFull(n) {
  return Math.floor(n).toLocaleString('en-US');
}
