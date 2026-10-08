/*
 * Copied from the JustFig app (src/core/model/hash.ts) at its Phase 1 state; keep the two in
 * step by hand when either changes (the plan allows a copy or a workspace
 * package; a copy keeps this repo buildable on its own).
 */
/**
 * Content hashes for assets (note 02): two 53-bit cyrb53 hashes of the
 * canonical JSON, synchronous (unlike crypto.subtle) and collision-safe at
 * the scale of one figure.
 */

export function cyrb53(s: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** `h` + 26 hex digits. */
export function contentHash(text: string): string {
  const a = cyrb53(text, 0).toString(16).padStart(14, '0');
  const b = cyrb53(text, 1).toString(16).padStart(14, '0');
  return `h${a.slice(1)}${b.slice(1)}`;
}
